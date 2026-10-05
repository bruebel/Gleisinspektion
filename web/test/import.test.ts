import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import readXlsxFile from 'read-excel-file/node';
import { beforeEach, describe, expect, it } from 'vitest';
import { LokaleDatenbank } from '../src/db/lokal';
import { fuehreImportAus, ladeBestand, planeImport, type Blatt } from '../src/import/excel';

let db: LokaleDatenbank;

beforeEach(async () => {
  db = new LokaleDatenbank(`test-${crypto.randomUUID()}`);
  await db.open();
});

const vorlage = async () =>
  (await readXlsxFile(readFileSync(new URL('../../docs/stammdaten-vorlage.xlsx', import.meta.url)))) as Blatt[];

describe('Excel-Import', () => {
  it('liest die Stammdaten-Vorlage', async () => {
    const plan = planeImport(await vorlage(), await ladeBestand(db));

    expect(plan.fehler).toEqual([]);
    expect(plan.zaehler).toEqual({
      gleisanschluesse: { neu: 2, geaendert: 0 },
      ansprechpartner: { neu: 2, geaendert: 0 },
      elemente: { neu: 4, geaendert: 0 },
    });
    expect(plan.hinweise.length).toBeGreaterThan(0); // Beispielzeilen werden erkannt
  });

  it('verknüpft über das Kürzel und erkennt beim zweiten Import vorhandene Daten', async () => {
    await fuehreImportAus(planeImport(await vorlage(), await ladeBestand(db)), db);

    const hafen = await db.gleisanschluss.where('kuerzel').equals('HAFEN-N').first();
    expect(await db.infrastrukturelement.where('gleisanschlussId').equals(hafen!.id).count()).toBe(4);
    const max = await db.ansprechpartner.filter((a) => a.name === 'Max Mustermann').first();
    expect(max).toMatchObject({ gleisanschlussId: hafen!.id, erhaeltBericht: true });
    expect(await db.outbox.count()).toBe(8);

    const zweiter = planeImport(await vorlage(), await ladeBestand(db));
    expect(zweiter.aenderungen).toEqual([]);
  });

  it('aktualisiert geänderte Zeilen und meldet unbekannte Kürzel', async () => {
    await fuehreImportAus(planeImport(await vorlage(), await ladeBestand(db)), db);
    const blaetter = await vorlage();
    blaetter[1].data[1][1] = 'Hafen Nord (neu)';
    blaetter[3].data[1][0] = 'GIBTSNICHT';

    const plan = planeImport(blaetter, await ladeBestand(db));
    expect(plan.zaehler.gleisanschluesse).toEqual({ neu: 0, geaendert: 1 });
    expect(plan.fehler).toEqual(['Infrastrukturelemente, Zeile 2: Gleisanschluss „GIBTSNICHT“ unbekannt.']);
  });

  it('meldet eine falsche Datei', () => {
    const plan = planeImport([{ sheet: 'Tabelle1', data: [['a']] }], { gleisanschluesse: [], ansprechpartner: [], elemente: [] });
    expect(plan.fehler[0]).toMatch(/Gleisanschlüsse.*nicht gefunden/);
  });
});
