import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LokaleDatenbank, speichere, type Gleisanschluss } from '../src/db/lokal';

let db: LokaleDatenbank;

beforeEach(async () => {
  db = new LokaleDatenbank(`test-${crypto.randomUUID()}`);
  await db.open();
});

describe('speichere', () => {
  it('legt Datensatz mit UUID an und vermerkt ihn in der Outbox', async () => {
    const a = await speichere<Gleisanschluss>('gleisanschluss', { name: 'Hafen Nord', aktiv: true }, db);

    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.geloescht).toBe(false);
    expect(await db.gleisanschluss.get(a.id)).toMatchObject({ name: 'Hafen Nord' });
    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ tabelle: 'gleisanschluss', datensatzId: a.id }),
    ]);
  });

  it('aktualisiert vorhandene Datensätze ohne doppelten Outbox-Eintrag', async () => {
    const a = await speichere<Gleisanschluss>('gleisanschluss', { name: 'Hafen Nord', aktiv: true }, db);
    const b = await speichere<Gleisanschluss>('gleisanschluss', { ...a, name: 'Hafen Süd' }, db);

    expect(b.erstelltAm).toBe(a.erstelltAm);
    expect((await db.gleisanschluss.get(a.id))?.name).toBe('Hafen Süd');
    expect(await db.outbox.count()).toBe(1);
  });
});
