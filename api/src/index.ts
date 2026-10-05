import { baueApp } from './app.js';
import { legeAdminAn } from './auth.js';
import { verbindeDatenbank } from './db.js';
import { graphKonfigurationAusUmgebung, graphMailer } from './mail.js';

const env = (name: string, standard?: string) => {
  const wert = process.env[name] ?? standard;
  if (wert === undefined) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return wert;
};

const { db, schliessen } = await verbindeDatenbank(env('DATABASE_URL'));

if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORT) {
  const angelegt = await legeAdminAn(db, {
    name: env('ADMIN_NAME', 'Administrator'),
    email: process.env.ADMIN_EMAIL,
    passwort: process.env.ADMIN_PASSWORT,
  });
  if (angelegt) console.log(`Admin-Benutzer ${process.env.ADMIN_EMAIL} angelegt`);
}

const graph = graphKonfigurationAusUmgebung();
console.log(graph ? `Mailversand über Microsoft 365 als ${graph.absender}` : 'Mailversand nicht eingerichtet (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_ABSENDER)');

const app = baueApp(db, { logger: true, corsOrigin: process.env.CORS_ORIGIN, mailer: graph && graphMailer(graph) });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await schliessen();
    process.exit(0);
  });
}

await app.listen({ host: '0.0.0.0', port: Number(env('PORT', '3000')) });
