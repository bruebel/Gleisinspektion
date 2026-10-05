import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baueApp } from '../src/app.js';
import { hashPasswort, legeAdminAn, pruefePasswort } from '../src/auth.js';
import { migrationsOrdner, type Db } from '../src/db.js';
import * as schema from '../src/schema.js';

let client: PGlite;
let db: Db;

beforeAll(async () => {
  client = new PGlite();
  const pglite = drizzle(client, { schema });
  await migrate(pglite, { migrationsFolder: migrationsOrdner });
  db = pglite as unknown as Db;
  await legeAdminAn(db, { name: 'Benjamin', email: 'Admin@Example.de', passwort: 'geheim123' });
});

afterAll(async () => {
  await client.close();
});

describe('Passwort-Hashing', () => {
  it('erkennt richtiges und falsches Passwort', async () => {
    const hash = await hashPasswort('gleis');
    expect(await pruefePasswort('gleis', hash)).toBe(true);
    expect(await pruefePasswort('weiche', hash)).toBe(false);
  });
});

describe('API', () => {
  it('meldet Gesundheit', async () => {
    const res = await baueApp(db).inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('legt den Admin nur einmal an', async () => {
    expect(await legeAdminAn(db, { name: 'X', email: 'x@example.de', passwort: 'y' })).toBe(false);
  });

  it('meldet an, liefert den Benutzer und meldet ab', async () => {
    const app = baueApp(db);

    const falsch = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@example.de', passwort: 'falsch' },
    });
    expect(falsch.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ' ADMIN@example.de ', passwort: 'geheim123' },
    });
    expect(login.statusCode).toBe(200);
    const { token, benutzer } = login.json();
    expect(benutzer).toMatchObject({ name: 'Benjamin', email: 'admin@example.de', rolle: 'admin' });

    const auth = { authorization: `Bearer ${token}` };
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe('admin@example.de');

    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth })).statusCode).toBe(401);
  });

  it('weist Anfragen ohne Anmeldung ab', async () => {
    const res = await baueApp(db).inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });
});
