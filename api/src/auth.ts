import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt } from 'drizzle-orm';
import type { Db } from './db.js';
import { benutzer, sitzung } from './schema.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// Sitzungen laufen lange, damit die App auch nach Tagen ohne Netz nicht neu angemeldet werden muss.
export const SITZUNG_TAGE = 180;

export async function hashPasswort(passwort: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(passwort, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function pruefePasswort(passwort: string, gespeichert: string): Promise<boolean> {
  const [verfahren, saltB64, hashB64] = gespeichert.split('$');
  if (verfahren !== 'scrypt' || !saltB64 || !hashB64) return false;
  const erwartet = Buffer.from(hashB64, 'base64');
  const hash = await scrypt(passwort, Buffer.from(saltB64, 'base64'), erwartet.length);
  return timingSafeEqual(hash, erwartet);
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function erstelleSitzung(db: Db, benutzerId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sitzung).values({
    tokenHash: tokenHash(token),
    benutzerId,
    laeuftAbAm: new Date(Date.now() + SITZUNG_TAGE * 24 * 60 * 60 * 1000),
  });
  return token;
}

export async function beendeSitzung(db: Db, token: string): Promise<void> {
  await db.delete(sitzung).where(eq(sitzung.tokenHash, tokenHash(token)));
}

export async function benutzerZuToken(db: Db, token: string) {
  const [treffer] = await db
    .select({ id: benutzer.id, name: benutzer.name, email: benutzer.email, rolle: benutzer.rolle })
    .from(sitzung)
    .innerJoin(benutzer, eq(sitzung.benutzerId, benutzer.id))
    .where(
      and(
        eq(sitzung.tokenHash, tokenHash(token)),
        gt(sitzung.laeuftAbAm, new Date()),
        eq(benutzer.aktiv, true),
        eq(benutzer.geloescht, false),
      ),
    );
  return treffer ?? null;
}

/** Legt beim ersten Start den Admin-Benutzer aus den Umgebungsvariablen an, falls es noch keinen Benutzer gibt. */
export async function legeAdminAn(db: Db, daten: { name: string; email: string; passwort: string }) {
  const vorhanden = await db.select({ id: benutzer.id }).from(benutzer).limit(1);
  if (vorhanden.length > 0) return false;
  await db.insert(benutzer).values({
    id: crypto.randomUUID(),
    name: daten.name,
    email: daten.email.toLowerCase(),
    rolle: 'admin',
    passwortHash: await hashPasswort(daten.passwort),
  });
  return true;
}
