import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baueApp } from '../src/app.js';
import { erstelleSitzung, hashPasswort } from '../src/auth.js';
import { migrationsOrdner, type Db } from '../src/db.js';
import * as schema from '../src/schema.js';

let client: PGlite;
let app: ReturnType<typeof baueApp>;
let fotoOrdner: string;
let auth: { authorization: string };

const ga = { id: crypto.randomUUID(), name: 'Hafen Nord', kuerzel: 'HAFEN-N', aktiv: true, geloescht: false };
const zeit = (min: number) => new Date(Date.UTC(2026, 9, 5, 10, min)).toISOString();

beforeAll(async () => {
  client = new PGlite();
  const pglite = drizzle(client, { schema });
  await migrate(pglite, { migrationsFolder: migrationsOrdner });
  const db = pglite as unknown as Db;
  fotoOrdner = await mkdtemp(join(tmpdir(), 'fotos-'));
  app = baueApp(db, { fotoOrdner });

  const [b] = await db
    .insert(schema.benutzer)
    .values({ id: crypto.randomUUID(), name: 'B', email: 'b@x.de', rolle: 'admin', passwortHash: await hashPasswort('x') })
    .returning();
  auth = { authorization: `Bearer ${await erstelleSitzung(db, b.id)}` };
});

afterAll(async () => {
  await client.close();
  await rm(fotoOrdner, { recursive: true, force: true });
});

const push = (aenderungen: unknown[]) =>
  app.inject({ method: 'POST', url: '/api/sync/push', headers: auth, payload: { aenderungen } });
const pull = (seit?: string) =>
  app.inject({ method: 'GET', url: `/api/sync/pull${seit ? `?seit=${encodeURIComponent(seit)}` : ''}`, headers: auth });

describe('Synchronisation', () => {
  it('verlangt eine Anmeldung', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/sync/pull' })).statusCode).toBe(401);
  });

  it('übernimmt Datensätze, auch wenn Kinder vor Eltern geschickt werden', async () => {
    const insp = {
      id: crypto.randomUUID(),
      gleisanschlussId: ga.id,
      datum: '2026-10-05',
      beginn: '09:30',
      durchfuehrender: 'Benjamin',
      status: 'entwurf',
      geloescht: false,
      erstelltAm: zeit(0),
      geaendertAm: zeit(0),
    };
    const res = await push([
      { tabelle: 'inspektion', datensatz: insp },
      { tabelle: 'gleisanschluss', datensatz: { ...ga, erstelltAm: zeit(0), geaendertAm: zeit(0) } },
    ]);
    expect(res.json()).toEqual({ uebernommen: [ga.id, insp.id], veraltet: [], fehler: [] });

    const { daten, cursor } = (await pull()).json();
    expect(daten.gleisanschluss).toEqual([expect.objectContaining({ id: ga.id, name: 'Hafen Nord' })]);
    expect(daten.inspektion[0]).toMatchObject({ id: insp.id, beginn: '09:30:00', datum: '2026-10-05' });
    expect(typeof cursor).toBe('string');

    // Ab dem Cursor kommt nichts doppelt.
    const leer = (await pull(cursor)).json();
    expect(Object.values(leer.daten).flat()).toEqual([]);
    expect(leer.cursor).toBe(cursor);
  });

  it('letzte Änderung gewinnt', async () => {
    const { cursor } = (await pull()).json();
    const neuer = await push([{ tabelle: 'gleisanschluss', datensatz: { ...ga, name: 'Neu', geaendertAm: zeit(10) } }]);
    expect(neuer.json().uebernommen).toEqual([ga.id]);

    const aelter = await push([{ tabelle: 'gleisanschluss', datensatz: { ...ga, name: 'Alt', geaendertAm: zeit(5) } }]);
    expect(aelter.json()).toMatchObject({ uebernommen: [], veraltet: [ga.id] });

    const { daten } = (await pull(cursor)).json();
    expect(daten.gleisanschluss).toEqual([expect.objectContaining({ name: 'Neu' })]);
  });

  it('meldet ungültige Datensätze und fehlende Bezüge einzeln', async () => {
    const res = await push([
      { tabelle: 'benutzer', datensatz: { id: crypto.randomUUID(), geaendertAm: zeit(0) } },
      {
        tabelle: 'ansprechpartner',
        datensatz: { id: crypto.randomUUID(), gleisanschlussId: crypto.randomUUID(), name: 'X', geaendertAm: zeit(0) },
      },
      { tabelle: 'gleisanschluss', datensatz: { ...ga, serverGeaendertAm: zeit(0), geaendertAm: zeit(20) } },
    ]);
    const body = res.json();
    expect(body.fehler).toHaveLength(2);
    expect(body.uebernommen).toEqual([ga.id]);
  });

  it('nimmt Fotos an und liefert sie wieder aus', async () => {
    const feststellung = {
      id: crypto.randomUUID(),
      inspektionId: (await pull()).json().daten.inspektion[0].id,
      lfdNr: 1,
      feststellung: 'Zunge abgenutzt',
      massnahme: 'Schleifen',
      status: 'offen',
      geaendertAm: zeit(0),
    };
    const foto = { id: crypto.randomUUID(), feststellungId: feststellung.id, mimeTyp: 'image/jpeg', reihenfolge: 0, geaendertAm: zeit(0) };
    const bild = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

    const zuFrueh = await app.inject({
      method: 'PUT',
      url: `/api/fotos/${foto.id}`,
      headers: { ...auth, 'content-type': 'image/jpeg' },
      payload: bild,
    });
    expect(zuFrueh.statusCode).toBe(404);

    await push([
      { tabelle: 'feststellung', datensatz: feststellung },
      { tabelle: 'foto', datensatz: foto },
    ]);
    const hoch = await app.inject({
      method: 'PUT',
      url: `/api/fotos/${foto.id}`,
      headers: { ...auth, 'content-type': 'image/jpeg' },
      payload: bild,
    });
    expect(hoch.statusCode).toBe(204);

    const runter = await app.inject({ method: 'GET', url: `/api/fotos/${foto.id}`, headers: auth });
    expect(runter.statusCode).toBe(200);
    expect(runter.headers['content-type']).toBe('image/jpeg');
    expect(runter.rawPayload.equals(bild)).toBe(true);

    const { daten } = (await pull()).json();
    expect(daten.foto[0]).toMatchObject({ id: foto.id, dateiVorhanden: true, groesse: bild.length });
  });
});
