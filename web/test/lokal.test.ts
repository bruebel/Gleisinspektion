import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LokaleDatenbank, speichere, type Feststellung, type Gleisanschluss } from '../src/db/lokal';

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

describe('naechsteLfdNr und speichereFoto', () => {
  it('zählt Feststellungen je Inspektion hoch und legt Fotos mit Datei an', async () => {
    const { naechsteLfdNr, speichereFoto } = await import('../src/db/lokal');
    expect(await naechsteLfdNr('i1', db)).toBe(1);
    await speichere<Feststellung>('feststellung', { inspektionId: 'i1', lfdNr: 1, feststellung: 'a', massnahme: 'b', status: 'offen' }, db);
    await speichere<Feststellung>('feststellung', { inspektionId: 'i2', lfdNr: 5, feststellung: 'a', massnahme: 'b', status: 'offen' }, db);
    expect(await naechsteLfdNr('i1', db)).toBe(2);

    const foto = await speichereFoto('f1', new Blob(['x'], { type: 'image/jpeg' }), 0, db);
    expect(await db.fotoDatei.get(foto.id)).toMatchObject({ hochgeladen: false });
    expect(foto).toMatchObject({ feststellungId: 'f1', mimeTyp: 'image/jpeg', groesse: 1 });
  });
});
