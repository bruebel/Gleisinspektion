import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const migrationsOrdner = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function verbindeDatenbank(url: string) {
  const client = postgres(url, { max: 10 });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsOrdner });
  return { db: db as unknown as Db, schliessen: () => client.end() };
}
