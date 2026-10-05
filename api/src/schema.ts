import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Gemeinsame Spalten aller synchronisierten Tabellen. IDs werden auf dem Gerät erzeugt (UUID),
// damit offline angelegte Datensätze ohne Konflikte hochgeladen werden können.
// `serverGeaendertAm` setzt nur der Server; er dient als Cursor für den Abgleich (Pull).
const syncSpalten = {
  id: uuid('id').primaryKey(),
  erstelltAm: timestamp('erstellt_am', { withTimezone: true }).notNull().defaultNow(),
  geaendertAm: timestamp('geaendert_am', { withTimezone: true }).notNull().defaultNow(),
  serverGeaendertAm: timestamp('server_geaendert_am', { withTimezone: true })
    .notNull()
    .default(sql`clock_timestamp()`),
  geloescht: boolean('geloescht').notNull().default(false),
};

export const rolle = pgEnum('rolle', ['admin', 'inspektor', 'empfaenger']);
export const elementTyp = pgEnum('element_typ', ['gleis', 'weiche', 'signal', 'bauwerk', 'sonstiges']);
export const inspektionStatus = pgEnum('inspektion_status', ['entwurf', 'abgeschlossen']);
export const feststellungStatus = pgEnum('feststellung_status', ['offen', 'in_bearbeitung', 'erledigt']);

export const gleisanschluss = pgTable('gleisanschluss', {
  ...syncSpalten,
  // Frei wählbares Kurzzeichen (z. B. HAFEN-N); verknüpft die Blätter der Excel-Vorlage beim Import.
  kuerzel: text('kuerzel').unique(),
  name: text('name').notNull(),
  firma: text('firma'),
  adresse: text('adresse'),
  bemerkung: text('bemerkung'),
  aktiv: boolean('aktiv').notNull().default(true),
});

export const ansprechpartner = pgTable('ansprechpartner', {
  ...syncSpalten,
  gleisanschlussId: uuid('gleisanschluss_id')
    .notNull()
    .references(() => gleisanschluss.id),
  name: text('name').notNull(),
  funktion: text('funktion'),
  telefon: text('telefon'),
  email: text('email'),
  erhaeltBericht: boolean('erhaelt_bericht').notNull().default(false),
});

export const infrastrukturelement = pgTable('infrastrukturelement', {
  ...syncSpalten,
  gleisanschlussId: uuid('gleisanschluss_id')
    .notNull()
    .references(() => gleisanschluss.id),
  typ: elementTyp('typ').notNull(),
  bezeichnung: text('bezeichnung').notNull(),
  beschreibung: text('beschreibung'),
  sortierung: integer('sortierung').notNull().default(0),
  aktiv: boolean('aktiv').notNull().default(true),
});

export const benutzer = pgTable('benutzer', {
  ...syncSpalten,
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  rolle: rolle('rolle').notNull().default('inspektor'),
  passwortHash: text('passwort_hash'),
  // Für Berichtsempfänger: Verknüpfung zum Ansprechpartner eines Gleisanschlusses.
  ansprechpartnerId: uuid('ansprechpartner_id').references(() => ansprechpartner.id),
  aktiv: boolean('aktiv').notNull().default(true),
});

export const sitzung = pgTable('sitzung', {
  tokenHash: text('token_hash').primaryKey(),
  benutzerId: uuid('benutzer_id')
    .notNull()
    .references(() => benutzer.id),
  erstelltAm: timestamp('erstellt_am', { withTimezone: true }).notNull().defaultNow(),
  laeuftAbAm: timestamp('laeuft_ab_am', { withTimezone: true }).notNull(),
});

export const inspektion = pgTable('inspektion', {
  ...syncSpalten,
  gleisanschlussId: uuid('gleisanschluss_id')
    .notNull()
    .references(() => gleisanschluss.id),
  datum: date('datum').notNull(),
  beginn: time('beginn'),
  ende: time('ende'),
  durchfuehrender: text('durchfuehrender').notNull(),
  durchfuehrenderId: uuid('durchfuehrender_id').references(() => benutzer.id),
  teilnehmer: text('teilnehmer'),
  bemerkung: text('bemerkung'),
  status: inspektionStatus('status').notNull().default('entwurf'),
  abgeschlossenAm: timestamp('abgeschlossen_am', { withTimezone: true }),
});

export const feststellung = pgTable('feststellung', {
  ...syncSpalten,
  inspektionId: uuid('inspektion_id')
    .notNull()
    .references(() => inspektion.id),
  lfdNr: integer('lfd_nr').notNull(),
  infrastrukturelementId: uuid('infrastrukturelement_id').references(() => infrastrukturelement.id),
  ort: text('ort'),
  feststellung: text('feststellung').notNull(),
  massnahme: text('massnahme').notNull(),
  frist: date('frist'),
  zustaendig: text('zustaendig'),
  zustaendigKontaktId: uuid('zustaendig_kontakt_id').references(() => ansprechpartner.id),
  status: feststellungStatus('status').notNull().default('offen'),
  erledigtAm: timestamp('erledigt_am', { withTimezone: true }),
  erledigtVonId: uuid('erledigt_von_id').references(() => benutzer.id),
});

export const foto = pgTable('foto', {
  ...syncSpalten,
  feststellungId: uuid('feststellung_id')
    .notNull()
    .references(() => feststellung.id),
  mimeTyp: text('mime_typ').notNull().default('image/jpeg'),
  groesse: integer('groesse'),
  aufgenommenAm: timestamp('aufgenommen_am', { withTimezone: true }),
  reihenfolge: integer('reihenfolge').notNull().default(0),
  // Wird true, sobald die Bilddatei selbst auf dem Server liegt (Metadaten kommen ggf. vorher an).
  dateiVorhanden: boolean('datei_vorhanden').notNull().default(false),
});

export const kommentar = pgTable('kommentar', {
  ...syncSpalten,
  feststellungId: uuid('feststellung_id')
    .notNull()
    .references(() => feststellung.id),
  benutzerId: uuid('benutzer_id')
    .notNull()
    .references(() => benutzer.id),
  text: text('text').notNull(),
});
