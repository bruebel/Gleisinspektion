import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq, getTableColumns, gt, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Db } from './db.js';
import * as s from './schema.js';

// Abgleich zwischen Gerät und Server.
// Push: das Gerät schickt geänderte Datensätze; es gilt „letzte Änderung gewinnt“ (nach geaendertAm).
// Pull: das Gerät holt alles, was sich seit seinem letzten Abgleich auf dem Server geändert hat.
// Der Cursor ist der Zeitstempel server_geaendert_am in voller Genauigkeit (als Text).

/** Reihenfolge = Abhängigkeiten (Fremdschlüssel): Eltern vor Kindern. */
export const SYNC_TABELLEN = {
  gleisanschluss: s.gleisanschluss,
  ansprechpartner: s.ansprechpartner,
  infrastrukturelement: s.infrastrukturelement,
  inspektion: s.inspektion,
  feststellung: s.feststellung,
  foto: s.foto,
} as const;
type TabellenName = keyof typeof SYNC_TABELLEN;
type SyncTabelle = (typeof SYNC_TABELLEN)[TabellenName];

// Felder, die nur der Server setzt.
const NUR_SERVER = new Set(['serverGeaendertAm', 'dateiVorhanden']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Übernimmt nur bekannte Spalten und wandelt Zeitstempel-Texte in Date-Objekte. */
function zeileAusClient(tabelle: SyncTabelle, daten: Record<string, unknown>) {
  const zeile: Record<string, unknown> = {};
  for (const [name, spalte] of Object.entries(getTableColumns(tabelle as PgTable))) {
    if (NUR_SERVER.has(name) || !(name in daten)) continue;
    const wert = daten[name];
    zeile[name] = spalte.dataType === 'date' && typeof wert === 'string' ? new Date(wert) : wert;
  }
  return zeile;
}

interface PushBody {
  aenderungen: { tabelle: string; datensatz: Record<string, unknown> }[];
}

export function registriereSync(
  app: FastifyInstance,
  db: Db,
  optionen: { fotoOrdner: string; nurBerechtigt: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> },
) {
  const { fotoOrdner, nurBerechtigt } = optionen;
  const ordnerBereit = mkdir(fotoOrdner, { recursive: true });

  app.post<{ Body: PushBody }>(
    '/api/sync/push',
    {
      onRequest: nurBerechtigt,
      bodyLimit: 10 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['aenderungen'],
          properties: {
            aenderungen: {
              type: 'array',
              maxItems: 1000,
              items: {
                type: 'object',
                required: ['tabelle', 'datensatz'],
                properties: { tabelle: { type: 'string' }, datensatz: { type: 'object' } },
              },
            },
          },
        },
      },
    },
    async (req) => {
      const uebernommen: string[] = [];
      const veraltet: string[] = [];
      const fehler: { id: string; grund: string }[] = [];

      const reihenfolge = Object.keys(SYNC_TABELLEN);
      const sortiert = [...req.body.aenderungen].sort(
        (a, b) => reihenfolge.indexOf(a.tabelle) - reihenfolge.indexOf(b.tabelle),
      );

      for (const { tabelle: name, datensatz } of sortiert) {
        const id = String(datensatz.id ?? '');
        const tabelle = SYNC_TABELLEN[name as TabellenName];
        if (!tabelle || !UUID.test(id) || typeof datensatz.geaendertAm !== 'string') {
          fehler.push({ id, grund: 'Ungültiger Datensatz' });
          continue;
        }
        const zeile = zeileAusClient(tabelle, datensatz);
        try {
          const t = tabelle as typeof s.gleisanschluss; // gemeinsame Sync-Spalten
          const ergebnis = await db
            .insert(tabelle)
            .values(zeile as never)
            .onConflictDoUpdate({
              target: t.id,
              set: { ...zeile, serverGeaendertAm: sql`clock_timestamp()` } as never,
              setWhere: sql`${t.geaendertAm} <= excluded.geaendert_am`,
            })
            .returning({ id: t.id });
          (ergebnis.length ? uebernommen : veraltet).push(id);
        } catch (e) {
          req.log.warn({ err: e, tabelle: name, id }, 'Datensatz abgelehnt');
          fehler.push({ id, grund: 'Konnte nicht gespeichert werden' });
        }
      }
      return { uebernommen, veraltet, fehler };
    },
  );

  app.get<{ Querystring: { seit?: string } }>('/api/sync/pull', { onRequest: nurBerechtigt }, async (req) => {
    const seit = req.query.seit && !Number.isNaN(Date.parse(req.query.seit)) ? req.query.seit : null;
    let cursor = seit;
    const daten: Record<string, unknown[]> = {};

    for (const [name, tabelle] of Object.entries(SYNC_TABELLEN)) {
      const t = tabelle as typeof s.gleisanschluss;
      const zeilen = await db
        .select({ ...getTableColumns(t), cursor: sql<string>`${t.serverGeaendertAm}::text` })
        .from(t)
        .where(seit ? gt(t.serverGeaendertAm, sql`${seit}::timestamptz`) : undefined)
        .orderBy(t.serverGeaendertAm);
      daten[name] = zeilen.map(({ cursor: c, ...rest }) => {
        // Postgres liefert Zeitstempel in einheitlichem Textformat; der Textvergleich ordnet sie korrekt.
        if (!cursor || c > cursor) cursor = c;
        return rest;
      });
    }
    return { cursor, daten };
  });

  // Fotos: Metadaten kommen per Push, die Bilddatei separat.
  app.addContentTypeParser(/^image\//, { parseAs: 'buffer', bodyLimit: 20 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.put<{ Params: { id: string }; Body: Buffer }>(
    '/api/fotos/:id',
    { onRequest: nurBerechtigt },
    async (req, reply) => {
      const { id } = req.params;
      if (!UUID.test(id) || !Buffer.isBuffer(req.body)) return reply.code(400).send({ fehler: 'Ungültig' });
      const [foto] = await db.select({ id: s.foto.id }).from(s.foto).where(eq(s.foto.id, id));
      if (!foto) return reply.code(404).send({ fehler: 'Foto-Datensatz noch nicht vorhanden' });
      await ordnerBereit;
      await writeFile(join(fotoOrdner, id), req.body);
      await db
        .update(s.foto)
        .set({ dateiVorhanden: true, groesse: req.body.length, serverGeaendertAm: sql`clock_timestamp()` })
        .where(eq(s.foto.id, id));
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>('/api/fotos/:id', { onRequest: nurBerechtigt }, async (req, reply) => {
    const { id } = req.params;
    if (!UUID.test(id)) return reply.code(400).send({ fehler: 'Ungültig' });
    const [foto] = await db.select({ mimeTyp: s.foto.mimeTyp }).from(s.foto).where(eq(s.foto.id, id));
    const pfad = join(fotoOrdner, id);
    if (!foto || !(await stat(pfad).catch(() => null))) return reply.code(404).send({ fehler: 'Nicht gefunden' });
    reply.header('cache-control', 'private, max-age=31536000, immutable');
    return reply.type(foto.mimeTyp).send(createReadStream(pfad));
  });
}
