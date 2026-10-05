import Dexie, { type EntityTable } from 'dexie';

// Lokale Datenbank auf dem Gerät (IndexedDB). Spiegelt die Tabellen des Servers;
// jede Änderung wird zusätzlich in die Outbox geschrieben und später hochgeladen.

export type ElementTyp = 'gleis' | 'weiche' | 'signal' | 'bauwerk' | 'sonstiges';
export type InspektionStatus = 'entwurf' | 'abgeschlossen';
export type FeststellungStatus = 'offen' | 'in_bearbeitung' | 'erledigt';

interface SyncFelder {
  id: string;
  erstelltAm: string;
  geaendertAm: string;
  geloescht: boolean;
}

export interface Gleisanschluss extends SyncFelder {
  kuerzel?: string | null;
  name: string;
  firma?: string | null;
  adresse?: string | null;
  bemerkung?: string | null;
  aktiv: boolean;
}

export interface Ansprechpartner extends SyncFelder {
  gleisanschlussId: string;
  name: string;
  funktion?: string | null;
  telefon?: string | null;
  email?: string | null;
  erhaeltBericht: boolean;
}

export interface Infrastrukturelement extends SyncFelder {
  gleisanschlussId: string;
  typ: ElementTyp;
  bezeichnung: string;
  beschreibung?: string | null;
  sortierung: number;
  aktiv: boolean;
}

export interface Inspektion extends SyncFelder {
  gleisanschlussId: string;
  datum: string; // JJJJ-MM-TT
  beginn?: string | null; // HH:MM
  ende?: string | null;
  durchfuehrender: string;
  teilnehmer?: string | null;
  bemerkung?: string | null;
  status: InspektionStatus;
}

export interface Feststellung extends SyncFelder {
  inspektionId: string;
  lfdNr: number;
  infrastrukturelementId?: string | null;
  ort?: string | null;
  feststellung: string;
  massnahme: string;
  frist?: string | null;
  zustaendig?: string | null;
  status: FeststellungStatus;
}

export interface Foto extends SyncFelder {
  feststellungId: string;
  mimeTyp: string;
  groesse?: number;
  aufgenommenAm?: string;
  reihenfolge: number;
}

/** Die Bilddatei selbst, getrennt von den Metadaten, damit Listen schnell bleiben. */
export interface FotoDatei {
  fotoId: string;
  datei: Blob;
  hochgeladen: boolean;
}

export const SYNC_TABELLEN = [
  'gleisanschluss',
  'ansprechpartner',
  'infrastrukturelement',
  'inspektion',
  'feststellung',
  'foto',
] as const;
export type SyncTabelle = (typeof SYNC_TABELLEN)[number];

export interface OutboxEintrag {
  nr?: number;
  tabelle: SyncTabelle;
  datensatzId: string;
  zeitpunkt: string;
}

export class LokaleDatenbank extends Dexie {
  gleisanschluss!: EntityTable<Gleisanschluss, 'id'>;
  ansprechpartner!: EntityTable<Ansprechpartner, 'id'>;
  infrastrukturelement!: EntityTable<Infrastrukturelement, 'id'>;
  inspektion!: EntityTable<Inspektion, 'id'>;
  feststellung!: EntityTable<Feststellung, 'id'>;
  foto!: EntityTable<Foto, 'id'>;
  fotoDatei!: EntityTable<FotoDatei, 'fotoId'>;
  outbox!: EntityTable<OutboxEintrag, 'nr'>;
  meta!: EntityTable<{ schluessel: string; wert: string }, 'schluessel'>;

  constructor(name = 'gleisinspektion') {
    super(name);
    this.version(1).stores({
      gleisanschluss: 'id, name',
      ansprechpartner: 'id, gleisanschlussId',
      infrastrukturelement: 'id, gleisanschlussId, [gleisanschlussId+sortierung]',
      inspektion: 'id, gleisanschlussId, datum, status',
      feststellung: 'id, inspektionId, [inspektionId+lfdNr], status',
      foto: 'id, feststellungId',
      fotoDatei: 'fotoId, hochgeladen',
      outbox: '++nr, [tabelle+datensatzId]',
      meta: 'schluessel',
    });
    this.version(2).stores({
      gleisanschluss: 'id, name, kuerzel',
    });
  }
}

export const db = new LokaleDatenbank();

type Neu<T extends SyncFelder> = Omit<T, keyof SyncFelder> & Partial<Pick<T, 'id' | 'geloescht'>>;

/**
 * Speichert einen Datensatz lokal und vermerkt ihn in der Outbox – in einer Transaktion,
 * damit keine Änderung verloren geht, die noch nicht hochgeladen wurde.
 */
export async function speichere<T extends SyncFelder>(
  tabelle: SyncTabelle,
  datensatz: Neu<T> | T,
  datenbank: LokaleDatenbank = db,
): Promise<T> {
  const jetzt = new Date().toISOString();
  const tab = datenbank.table<T, string>(tabelle);
  return datenbank.transaction('rw', tab, datenbank.outbox, async () => {
    const id = datensatz.id ?? crypto.randomUUID();
    const bisher = await tab.get(id);
    const gespeichert = {
      ...bisher,
      ...datensatz,
      id,
      erstelltAm: bisher?.erstelltAm ?? jetzt,
      geaendertAm: jetzt,
      geloescht: datensatz.geloescht ?? bisher?.geloescht ?? false,
    } as T;
    await tab.put(gespeichert);
    // Pro Datensatz genügt ein Outbox-Eintrag; beim Hochladen wird der aktuelle Stand gelesen.
    const offen = await datenbank.outbox.where({ tabelle, datensatzId: id }).first();
    if (!offen) await datenbank.outbox.add({ tabelle, datensatzId: id, zeitpunkt: jetzt });
    return gespeichert;
  });
}

/** Markiert einen Datensatz als gelöscht; er wird so auch auf dem Server gelöscht. */
export async function loesche(tabelle: SyncTabelle, id: string, datenbank: LokaleDatenbank = db) {
  const vorhanden = await datenbank.table(tabelle).get(id);
  if (vorhanden) await speichere(tabelle, { ...vorhanden, geloescht: true }, datenbank);
}

export const aktiv = <T extends { geloescht: boolean }>(liste: T[]) => liste.filter((x) => !x.geloescht);

/** Nächste laufende Nummer für eine neue Feststellung innerhalb einer Inspektion. */
export async function naechsteLfdNr(inspektionId: string, datenbank: LokaleDatenbank = db): Promise<number> {
  const letzte = await datenbank.feststellung
    .where('[inspektionId+lfdNr]')
    .between([inspektionId, -Infinity], [inspektionId, Infinity])
    .last();
  return (letzte?.lfdNr ?? 0) + 1;
}

/** Legt ein Foto (Metadaten + Bilddatei) zu einer Feststellung an. */
export async function speichereFoto(
  feststellungId: string,
  datei: Blob,
  reihenfolge: number,
  datenbank: LokaleDatenbank = db,
): Promise<Foto> {
  return datenbank.transaction('rw', datenbank.foto, datenbank.fotoDatei, datenbank.outbox, async () => {
    const foto = await speichere<Foto>(
      'foto',
      {
        feststellungId,
        mimeTyp: datei.type || 'image/jpeg',
        groesse: datei.size,
        aufgenommenAm: new Date().toISOString(),
        reihenfolge,
      },
      datenbank,
    );
    await datenbank.fotoDatei.put({ fotoId: foto.id, datei, hochgeladen: false });
    return foto;
  });
}

/** Bittet den Browser, die lokalen Daten nicht bei Speicherknappheit zu löschen. */
export async function dauerhaftenSpeicherAnfordern(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
}
