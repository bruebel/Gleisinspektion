import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import type { Db } from './db.js';
import { FIRMA, datumDe, erstelleBericht } from './bericht.js';
import { MailFehler, type Mailer } from './mail.js';
import { berichtVersand } from './schema.js';

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const UUID = /^[0-9a-f-]{36}$/i;

const html = (text: string) =>
  text.replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[z]!);

type Angaben = NonNullable<Awaited<ReturnType<typeof erstelleBericht>>>['angaben'];

export function betreffFuer(a: Angaben) {
  return `${a.art ?? 'Begehung'} ${a.anschluss} am ${datumDe(a.datum)}`;
}

export function anschreibenFuer(a: Angaben, nachricht: string | undefined) {
  const ergebnis =
    a.feststellungen === 0
      ? 'Bei der Begehung wurden keine Mängel festgestellt.'
      : `Bei der Begehung wurde${a.feststellungen === 1 ? ' eine Feststellung' : `n ${a.feststellungen} Feststellungen`} dokumentiert. Die Einzelheiten mit Maßnahmenvorschlägen und Fotos finden Sie im Bericht.`;
  const absaetze = [
    'Guten Tag,',
    `anbei erhalten Sie den Bericht zur ${a.art ?? 'Begehung'} am ${datumDe(a.datum)} im Gleisanschluss „${a.anschluss}“.`,
    ergebnis,
    ...(nachricht?.trim() ? [nachricht.trim()] : []),
    `Mit freundlichen Grüßen\n${a.durchfuehrender}`,
  ];
  return [
    '<div style="font-family: Arial, sans-serif; font-size: 14px; color: #1d1d1b">',
    ...absaetze.map((p) => `<p>${html(p).replace(/\n/g, '<br>')}</p>`),
    `<p style="font-size: 11px; color: #5b6775">${html(FIRMA)}</p>`,
    '</div>',
  ].join('\n');
}

export function registriereVersand(
  app: FastifyInstance,
  db: Db,
  optionen: {
    mailer: Mailer | null;
    fotoOrdner: string;
    nurBerechtigt: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  },
) {
  const { mailer, fotoOrdner, nurBerechtigt } = optionen;

  app.get('/api/mail/status', { onRequest: nurBerechtigt }, async () => ({
    aktiv: Boolean(mailer),
    absender: mailer?.absender ?? null,
  }));

  app.get<{ Params: { id: string } }>('/api/inspektionen/:id/versand', { onRequest: nurBerechtigt }, async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(400).send({ fehler: 'Ungültig' });
    return db
      .select({ versendetAm: berichtVersand.versendetAm, absender: berichtVersand.absender, empfaenger: berichtVersand.empfaenger })
      .from(berichtVersand)
      .where(eq(berichtVersand.inspektionId, req.params.id))
      .orderBy(desc(berichtVersand.versendetAm));
  });

  app.post<{ Params: { id: string }; Body: { empfaenger: string[]; nachricht?: string } }>(
    '/api/inspektionen/:id/versand',
    {
      onRequest: nurBerechtigt,
      schema: {
        body: {
          type: 'object',
          required: ['empfaenger'],
          properties: {
            empfaenger: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'string', maxLength: 254 } },
            nachricht: { type: 'string', maxLength: 4000 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return reply.code(400).send({ fehler: 'Ungültig' });
      if (!mailer) return reply.code(503).send({ fehler: 'Der Mailversand ist auf dem Server nicht eingerichtet.' });
      const empfaenger = [...new Set(req.body.empfaenger.map((e) => e.trim().toLowerCase()))];
      const ungueltig = empfaenger.filter((e) => !EMAIL.test(e));
      if (ungueltig.length) return reply.code(400).send({ fehler: `Ungültige E-Mail-Adresse: ${ungueltig.join(', ')}` });

      const bericht = await erstelleBericht(db, req.params.id, fotoOrdner);
      if (!bericht) return reply.code(404).send({ fehler: 'Begehung nicht gefunden' });

      try {
        await mailer.sende({
          an: empfaenger,
          betreff: betreffFuer(bericht.angaben),
          html: anschreibenFuer(bericht.angaben, req.body.nachricht),
          anhaenge: [{ name: bericht.dateiname, inhalt: Buffer.from(bericht.pdf), typ: 'application/pdf' }],
        });
      } catch (e) {
        req.log.error(e, 'Mailversand fehlgeschlagen');
        const meldung = e instanceof MailFehler ? e.message : 'Unbekannter Fehler';
        return reply.code(502).send({ fehler: `Versand fehlgeschlagen: ${meldung}` });
      }

      const [eintrag] = await db
        .insert(berichtVersand)
        .values({ inspektionId: req.params.id, absender: mailer.absender, empfaenger, benutzerId: req.benutzer?.id })
        .returning({ versendetAm: berichtVersand.versendetAm, absender: berichtVersand.absender, empfaenger: berichtVersand.empfaenger });
      return eintrag;
    },
  );
}
