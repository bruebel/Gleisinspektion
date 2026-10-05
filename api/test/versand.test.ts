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
import { MailFehler, type Mail, type Mailer } from '../src/mail.js';
import * as schema from '../src/schema.js';

let client: PGlite;
let db: Db;
let fotoOrdner: string;
let auth: { authorization: string };
const gesendet: Mail[] = [];
let naechsterFehler: Error | null = null;
const mailer: Mailer = {
  absender: 'absender@example.de',
  async sende(mail) {
    if (naechsterFehler) {
      const f = naechsterFehler;
      naechsterFehler = null;
      throw f;
    }
    gesendet.push(mail);
  },
};

const jetzt = new Date().toISOString();
const ga = { id: crypto.randomUUID(), name: 'Anschlussbahn Hafen Nord', kuerzel: 'HAFEN-N', aktiv: true, geaendertAm: jetzt };
const insp = { id: crypto.randomUUID(), gleisanschlussId: ga.id, art: 'Regelbegehung', datum: '2026-10-05', durchfuehrender: 'Benjamin', status: 'abgeschlossen', geaendertAm: jetzt };
const f1 = { id: crypto.randomUUID(), inspektionId: insp.id, lfdNr: 1, feststellung: 'Schwellen lose', massnahme: 'Nachziehen', status: 'offen', geaendertAm: jetzt };

beforeAll(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: migrationsOrdner });
  db = d as unknown as Db;
  fotoOrdner = await mkdtemp(join(tmpdir(), 'fotos-'));
  const [b] = await d
    .insert(schema.benutzer)
    .values({ id: crypto.randomUUID(), name: 'B', email: 'b@x.de', rolle: 'admin', passwortHash: await hashPasswort('x') })
    .returning();
  auth = { authorization: `Bearer ${await erstelleSitzung(db, b.id)}` };
  const app = baueApp(db, { fotoOrdner, mailer });
  const push = await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    headers: auth,
    payload: { aenderungen: [['gleisanschluss', ga], ['inspektion', insp], ['feststellung', f1]].map(([tabelle, datensatz]) => ({ tabelle, datensatz })) },
  });
  expect(push.json().fehler).toEqual([]);
});

afterAll(async () => {
  await client.close();
  await rm(fotoOrdner, { recursive: true, force: true });
});

describe('Berichtsversand', () => {
  it('meldet, ob der Versand eingerichtet ist', async () => {
    expect((await baueApp(db, { fotoOrdner }).inject({ url: '/api/mail/status', headers: auth })).json()).toEqual({ aktiv: false, absender: null });
    expect((await baueApp(db, { fotoOrdner, mailer }).inject({ url: '/api/mail/status', headers: auth })).json()).toEqual({ aktiv: true, absender: 'absender@example.de' });
  });

  it('lehnt den Versand ohne Einrichtung, ohne Anmeldung und mit falschen Adressen ab', async () => {
    const url = `/api/inspektionen/${insp.id}/versand`;
    const ohne = await baueApp(db, { fotoOrdner }).inject({ method: 'POST', url, headers: auth, payload: { empfaenger: ['a@example.de'] } });
    expect(ohne.statusCode).toBe(503);
    const app = baueApp(db, { fotoOrdner, mailer });
    expect((await app.inject({ method: 'POST', url, payload: { empfaenger: ['a@example.de'] } })).statusCode).toBe(401);
    const falsch = await app.inject({ method: 'POST', url, headers: auth, payload: { empfaenger: ['kein-mail'] } });
    expect(falsch.statusCode).toBe(400);
    expect(falsch.json().fehler).toContain('kein-mail');
    expect((await app.inject({ method: 'POST', url, headers: auth, payload: { empfaenger: [] } })).statusCode).toBe(400);
    const unbekannt = await app.inject({ method: 'POST', url: `/api/inspektionen/${crypto.randomUUID()}/versand`, headers: auth, payload: { empfaenger: ['a@example.de'] } });
    expect(unbekannt.statusCode).toBe(404);
    expect(gesendet).toHaveLength(0);
  });

  it('versendet den Bericht als PDF-Anhang und protokolliert den Versand', async () => {
    const app = baueApp(db, { fotoOrdner, mailer });
    const res = await app.inject({
      method: 'POST',
      url: `/api/inspektionen/${insp.id}/versand`,
      headers: auth,
      payload: { empfaenger: ['A@Example.de', 'a@example.de ', 'b@example.de'], nachricht: 'Bitte <bis Freitag> prüfen.' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().empfaenger).toEqual(['a@example.de', 'b@example.de']);

    expect(gesendet).toHaveLength(1);
    const [mail] = gesendet;
    expect(mail.an).toEqual(['a@example.de', 'b@example.de']);
    expect(mail.betreff).toBe('Regelbegehung Anschlussbahn Hafen Nord am 05.10.2026');
    expect(mail.html).toContain('wurde eine Feststellung dokumentiert');
    expect(mail.html).toContain('Bitte &lt;bis Freitag&gt; prüfen.');
    expect(mail.html).toContain('Benjamin');
    expect(mail.anhaenge[0].name).toBe('Begehung_HAFEN-N_2026-10-05.pdf');
    expect(mail.anhaenge[0].inhalt.subarray(0, 5).toString()).toBe('%PDF-');

    const verlauf = (await app.inject({ url: `/api/inspektionen/${insp.id}/versand`, headers: auth })).json();
    expect(verlauf).toHaveLength(1);
    expect(verlauf[0]).toMatchObject({ absender: 'absender@example.de', empfaenger: ['a@example.de', 'b@example.de'] });
  });

  it('gibt Fehler von Microsoft weiter und protokolliert dann nichts', async () => {
    const app = baueApp(db, { fotoOrdner, mailer });
    naechsterFehler = new MailFehler('Microsoft Graph POST /users/x/messages fehlgeschlagen (403): Access is denied.');
    const res = await app.inject({ method: 'POST', url: `/api/inspektionen/${insp.id}/versand`, headers: auth, payload: { empfaenger: ['a@example.de'] } });
    expect(res.statusCode).toBe(502);
    expect(res.json().fehler).toContain('Access is denied');
    expect((await app.inject({ url: `/api/inspektionen/${insp.id}/versand`, headers: auth })).json()).toHaveLength(1);
  });
});
