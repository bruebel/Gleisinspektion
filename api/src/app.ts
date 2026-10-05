import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { eq, sql } from 'drizzle-orm';
import type { Db } from './db.js';
import { beendeSitzung, benutzerZuToken, erstelleSitzung, pruefePasswort } from './auth.js';
import { benutzer } from './schema.js';
import { registriereSync } from './sync.js';

export type AngemeldeterBenutzer = NonNullable<Awaited<ReturnType<typeof benutzerZuToken>>>;

declare module 'fastify' {
  interface FastifyRequest {
    benutzer: AngemeldeterBenutzer | null;
  }
}

const bearerToken = (req: FastifyRequest) => {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
};

export function baueApp(
  db: Db,
  optionen: { logger?: boolean; corsOrigin?: string; fotoOrdner?: string } = {},
) {
  const app = Fastify({ logger: optionen.logger ?? false });

  if (optionen.corsOrigin) app.register(cors, { origin: optionen.corsOrigin });

  app.decorateRequest('benutzer', null);
  app.addHook('onRequest', async (req) => {
    const token = bearerToken(req);
    req.benutzer = token ? await benutzerZuToken(db, token) : null;
  });

  const nurAngemeldet = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.benutzer) return reply.code(401).send({ fehler: 'Nicht angemeldet' });
  };

  // Abgleich nur für Admin und Inspektoren; Berichtsempfänger bekommen später eine eigene, eingeschränkte Sicht.
  const nurInspektoren = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.benutzer) return reply.code(401).send({ fehler: 'Nicht angemeldet' });
    if (req.benutzer.rolle === 'empfaenger') return reply.code(403).send({ fehler: 'Keine Berechtigung' });
  };

  registriereSync(app, db, {
    fotoOrdner: optionen.fotoOrdner ?? process.env.FOTO_ORDNER ?? './data/fotos',
    nurBerechtigt: nurInspektoren,
  });

  app.get('/api/health', async () => {
    await db.execute(sql`select 1`);
    return { status: 'ok' };
  });

  app.post<{ Body: { email: string; passwort: string } }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'passwort'],
          properties: { email: { type: 'string', minLength: 1 }, passwort: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (req, reply) => {
      const [b] = await db.select().from(benutzer).where(eq(benutzer.email, req.body.email.trim().toLowerCase()));
      const ok = b?.passwortHash && b.aktiv && !b.geloescht && (await pruefePasswort(req.body.passwort, b.passwortHash));
      if (!b || !ok) return reply.code(401).send({ fehler: 'E-Mail oder Passwort falsch' });
      const token = await erstelleSitzung(db, b.id);
      return { token, benutzer: { id: b.id, name: b.name, email: b.email, rolle: b.rolle } };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const token = bearerToken(req);
    if (token) await beendeSitzung(db, token);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { onRequest: nurAngemeldet }, async (req) => req.benutzer);

  return app;
}
