import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baueApp } from '../src/app.js';
import { erstelleSitzung, hashPasswort } from '../src/auth.js';
import { datumDe } from '../src/bericht.js';
import { migrationsOrdner, type Db } from '../src/db.js';
import * as schema from '../src/schema.js';

/** Kleines, gültiges PNG (Farbverlauf), damit pdfmake ein echtes Bild einbetten muss. */
function testPng(b = 320, h = 240) {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const x of buf) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (typ: string, daten: Buffer) => {
    const t = Buffer.concat([Buffer.from(typ), daten]);
    const laenge = Buffer.alloc(4);
    laenge.writeUInt32BE(daten.length);
    const pruef = Buffer.alloc(4);
    pruef.writeUInt32BE(crc(t));
    return Buffer.concat([laenge, t, pruef]);
  };
  const zeilen = [];
  for (let y = 0; y < h; y++) {
    zeilen.push(0);
    for (let x = 0; x < b; x++) zeilen.push((x * 255) / b, (y * 255) / h, 120);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(b, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(zeilen))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let client: PGlite;
let app: ReturnType<typeof baueApp>;
let fotoOrdner: string;
let auth: { authorization: string };

beforeAll(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: migrationsOrdner });
  fotoOrdner = await mkdtemp(join(tmpdir(), 'fotos-'));
  app = baueApp(d as unknown as Db, { fotoOrdner });
  const [b] = await d
    .insert(schema.benutzer)
    .values({ id: crypto.randomUUID(), name: 'B', email: 'b@x.de', rolle: 'admin', passwortHash: await hashPasswort('x') })
    .returning();
  auth = { authorization: `Bearer ${await erstelleSitzung(d as unknown as Db, b.id)}` };
});

afterAll(async () => {
  await client.close();
  await rm(fotoOrdner, { recursive: true, force: true });
});

describe('PDF-Bericht', () => {
  it('formatiert Datumsangaben deutsch', () => {
    expect(datumDe('2026-10-05')).toBe('05.10.2026');
    expect(datumDe(null)).toBe('');
  });

  it('erzeugt einen Bericht mit Feststellungen und Fotos', async () => {
    const jetzt = new Date().toISOString();
    const ga = { id: crypto.randomUUID(), name: 'Anschlussbahn Hafen Nord', kuerzel: 'HAFEN-N', firma: 'Muster Logistik GmbH', aktiv: true, geaendertAm: jetzt };
    const weiche = { id: crypto.randomUUID(), gleisanschlussId: ga.id, typ: 'weiche', bezeichnung: 'W 1', sortierung: 10, aktiv: true, geaendertAm: jetzt };
    const ap = { id: crypto.randomUUID(), gleisanschlussId: ga.id, name: 'Max Mustermann', funktion: 'EBL', email: 'max@example.de', erhaeltBericht: true, geaendertAm: jetzt };
    const insp = { id: crypto.randomUUID(), gleisanschlussId: ga.id, datum: '2026-10-05', beginn: '09:30', ende: '11:15', durchfuehrender: 'Benjamin', status: 'abgeschlossen', geaendertAm: jetzt };
    const f1 = { id: crypto.randomUUID(), inspektionId: insp.id, lfdNr: 1, infrastrukturelementId: weiche.id, feststellung: 'Zungenspitze abgenutzt, Grat sichtbar', massnahme: 'Zunge schleifen', frist: '2026-11-30', zustaendig: 'Max Mustermann', status: 'offen', geaendertAm: jetzt };
    const f2 = { id: crypto.randomUUID(), inspektionId: insp.id, lfdNr: 2, ort: 'Gleis 1, km 0,350', feststellung: 'Schwellen 3–5 lose', massnahme: 'Befestigung nachziehen', status: 'offen', geaendertAm: jetzt };
    const fotos = [0, 1, 2].map((i) => ({ id: crypto.randomUUID(), feststellungId: i < 2 ? f1.id : f2.id, mimeTyp: 'image/png', reihenfolge: i, geaendertAm: jetzt }));

    const push = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: auth,
      payload: {
        aenderungen: [
          ['gleisanschluss', ga], ['infrastrukturelement', weiche], ['ansprechpartner', ap], ['inspektion', insp],
          ['feststellung', f1], ['feststellung', f2], ...fotos.map((f) => ['foto', f]),
        ].map(([tabelle, datensatz]) => ({ tabelle, datensatz })),
      },
    });
    expect(push.json().fehler).toEqual([]);
    // Zwei Fotos hochladen, das dritte fehlt noch (wird im Bericht vermerkt).
    for (const foto of fotos.slice(0, 2)) {
      const res = await app.inject({ method: 'PUT', url: `/api/fotos/${foto.id}`, headers: { ...auth, 'content-type': 'image/png' }, payload: testPng() });
      expect(res.statusCode).toBe(204);
    }

    const res = await app.inject({ method: 'GET', url: `/api/inspektionen/${insp.id}/bericht.pdf`, headers: auth });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('Gleisinspektion_HAFEN-N_2026-10-05.pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.rawPayload.length).toBeGreaterThan(20_000);
    if (process.env.BERICHT_AUSGABE) await writeFile(process.env.BERICHT_AUSGABE, res.rawPayload);
  });

  it('liefert 404 für unbekannte Inspektionen und 401 ohne Anmeldung', async () => {
    const id = crypto.randomUUID();
    expect((await app.inject({ method: 'GET', url: `/api/inspektionen/${id}/bericht.pdf`, headers: auth })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/inspektionen/${id}/bericht.pdf` })).statusCode).toBe(401);
  });
});
