// Abgleich gegen den echten Server-Code (Fastify + PGlite statt Postgres), ohne Netzwerk.
import 'fake-indexeddb/auto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { baueApp } from '../../api/src/app';
import { erstelleSitzung, hashPasswort } from '../../api/src/auth';
import { migrationsOrdner, type Db } from '../../api/src/db';
import * as schema from '../../api/src/schema';
import { LokaleDatenbank, speichere, speichereFoto, type Feststellung, type Gleisanschluss, type Inspektion } from '../src/db/lokal';
import { neuSynchronisieren, synchronisiere, syncZustand } from '../src/sync';

let pg: PGlite;
let app: ReturnType<typeof baueApp>;
let token: string;
let fotoOrdner: string;

const abruf = (async (url: string, init: RequestInit = {}) => {
  const body = init.body instanceof Blob ? Buffer.from(await init.body.arrayBuffer()) : (init.body as string | undefined);
  const res = await app.inject({
    method: (init.method ?? 'GET') as 'GET',
    url,
    headers: init.headers as Record<string, string>,
    payload: body,
  });
  return new Response(res.statusCode === 204 ? null : res.rawPayload, {
    status: res.statusCode,
    headers: { 'content-type': String(res.headers['content-type'] ?? '') },
  });
}) as unknown as typeof fetch;

beforeAll(async () => {
  pg = new PGlite();
  const d = drizzle(pg, { schema });
  await migrate(d, { migrationsFolder: migrationsOrdner });
  fotoOrdner = await mkdtemp(join(tmpdir(), 'fotos-'));
  app = baueApp(d as unknown as Db, { fotoOrdner });
  const [b] = await d
    .insert(schema.benutzer)
    .values({ id: crypto.randomUUID(), name: 'B', email: 'b@x.de', rolle: 'admin', passwortHash: await hashPasswort('x') })
    .returning();
  token = await erstelleSitzung(d as unknown as Db, b.id);
});

afterAll(async () => {
  await pg.close();
  await rm(fotoOrdner, { recursive: true, force: true });
});

const neuesGeraet = async () => {
  const g = new LokaleDatenbank(`geraet-${crypto.randomUUID()}`);
  await g.open();
  return g;
};

describe('Abgleich Gerät ↔ Server', () => {
  let handy: LokaleDatenbank;
  beforeEach(async () => {
    handy = await neuesGeraet();
  });

  it('lädt eine offline erfasste Inspektion samt Foto hoch und ein zweites Gerät bekommt sie', async () => {
    const ga = await speichere<Gleisanschluss>('gleisanschluss', { name: 'Hafen Nord', aktiv: true }, handy);
    const insp = await speichere<Inspektion>(
      'inspektion',
      { gleisanschlussId: ga.id, datum: '2026-10-05', beginn: '09:30', durchfuehrender: 'Benjamin', status: 'entwurf' },
      handy,
    );
    const f = await speichere<Feststellung>(
      'feststellung',
      { inspektionId: insp.id, lfdNr: 1, feststellung: 'Zunge abgenutzt', massnahme: 'Schleifen', status: 'offen' },
      handy,
    );
    const foto = await speichereFoto(f.id, new Blob([new Uint8Array([0xff, 0xd8, 1, 2])], { type: 'image/jpeg' }), 0, handy);

    await synchronisiere({ datenbank: handy, abruf, token });
    expect(syncZustand.lesen().fehler).toBeNull();
    expect(await handy.outbox.count()).toBe(0);
    expect((await handy.fotoDatei.get(foto.id))?.hochgeladen).toBe(true);

    const tablet = await neuesGeraet();
    await synchronisiere({ datenbank: tablet, abruf, token });
    expect(await tablet.inspektion.get(insp.id)).toMatchObject({ beginn: '09:30', durchfuehrender: 'Benjamin' });
    expect(await tablet.feststellung.get(f.id)).toMatchObject({ feststellung: 'Zunge abgenutzt' });
    expect(await tablet.foto.get(foto.id)).toMatchObject({ feststellungId: f.id });
    expect(await tablet.outbox.count()).toBe(0);
  });

  it('übernimmt die neuere Änderung, egal von welchem Gerät', async () => {
    const ga = await speichere<Gleisanschluss>('gleisanschluss', { name: 'Werk 2', aktiv: true }, handy);
    await synchronisiere({ datenbank: handy, abruf, token });

    const tablet = await neuesGeraet();
    await synchronisiere({ datenbank: tablet, abruf, token });
    await new Promise((r) => setTimeout(r, 5));
    await speichere<Gleisanschluss>('gleisanschluss', { ...(await tablet.gleisanschluss.get(ga.id))!, name: 'Werk 2 (Tablet)' }, tablet);
    await synchronisiere({ datenbank: tablet, abruf, token });

    await synchronisiere({ datenbank: handy, abruf, token });
    expect((await handy.gleisanschluss.get(ga.id))?.name).toBe('Werk 2 (Tablet)');
  });

  it('behält Änderungen in der Outbox, wenn der Server nicht erreichbar ist', async () => {
    await speichere<Gleisanschluss>('gleisanschluss', { name: 'Offline', aktiv: true }, handy);
    const kaputt = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await synchronisiere({ datenbank: handy, abruf: kaputt, token });
    expect(syncZustand.lesen().fehler).toBe('Server nicht erreichbar');
    expect(await handy.outbox.count()).toBe(1);
  });

  it('bricht eine hängende Anfrage ab, damit der nächste Abgleich wieder durchgeht', async () => {
    await speichere<Gleisanschluss>('gleisanschluss', { name: 'Funkloch', aktiv: true }, handy);
    // WLAN verbunden, aber keine Antwort: die Anfrage kehrt nie zurück und beachtet auch kein Signal.
    const haengt = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    await synchronisiere({ datenbank: handy, abruf: haengt, token, zeitlimit: 50 });
    expect(syncZustand.lesen()).toMatchObject({ laeuft: false, fehler: 'Keine Antwort vom Server (schwaches Netz?)' });
    expect(await handy.outbox.count()).toBeGreaterThan(0);

    await synchronisiere({ datenbank: handy, abruf, token });
    expect(syncZustand.lesen().fehler).toBeNull();
    expect(await handy.outbox.count()).toBe(0);
  });

  it('startet bei Netzwechsel sofort neu, statt auf die hängende Verbindung zu warten', async () => {
    await speichere<Gleisanschluss>('gleisanschluss', { name: 'Netzwechsel', aktiv: true }, handy);
    const haengt = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const alt = synchronisiere({ datenbank: handy, abruf: haengt, token, zeitlimit: 60_000 });
    const start = Date.now();
    await neuSynchronisieren({ datenbank: handy, abruf, token });
    await alt;
    expect(Date.now() - start).toBeLessThan(5_000);
    expect(syncZustand.lesen().fehler).toBeNull();
    expect(await handy.outbox.count()).toBe(0);
  });

  it('meldet eine abgelaufene Anmeldung', async () => {
    await synchronisiere({ datenbank: handy, abruf, token: 'falsch' });
    expect(syncZustand.lesen().fehler).toMatch(/neu anmelden/);
  });
});
