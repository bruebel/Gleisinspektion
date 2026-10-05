import {
  db,
  speichere,
  type Ansprechpartner,
  type ElementTyp,
  type Gleisanschluss,
  type Infrastrukturelement,
  type LokaleDatenbank,
  type SyncTabelle,
} from '../db/lokal';

// Liest die Stammdaten-Vorlage (docs/stammdaten-vorlage.xlsx) und plant den Import.
// Die Blätter sind über das Kürzel des Gleisanschlusses verknüpft. Vorhandene Datensätze werden
// wiedererkannt und aktualisiert, sodass die Datei beliebig oft erneut importiert werden kann.

type Zelle = string | number | boolean | Date | null | undefined;
export interface Blatt {
  sheet: string;
  data: Zelle[][];
}

export interface Bestand {
  gleisanschluesse: Gleisanschluss[];
  ansprechpartner: Ansprechpartner[];
  elemente: Infrastrukturelement[];
}

export interface Aenderung {
  tabelle: SyncTabelle;
  datensatz: Record<string, unknown> & { id: string };
  neu: boolean;
}

export interface ImportPlan {
  aenderungen: Aenderung[];
  zaehler: Record<'gleisanschluesse' | 'ansprechpartner' | 'elemente', { neu: number; geaendert: number }>;
  fehler: string[];
  hinweise: string[];
}

const BEISPIEL_NAMEN = ['anschlussbahn hafen nord', 'werksgleis werk 2', 'max mustermann', 'erika beispiel'];

const TYPEN: Record<string, ElementTyp> = {
  gleis: 'gleis',
  weiche: 'weiche',
  signal: 'signal',
  bauwerk: 'bauwerk',
  sonstiges: 'sonstiges',
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const text = (z: Zelle): string | null => {
  if (z === null || z === undefined) return null;
  const s = (z instanceof Date ? z.toISOString().slice(0, 10) : String(z)).trim();
  return s === '' ? null : s;
};

/** Spaltenindex je Überschrift; erkennt Überschriften am Anfang („Name *“ → „name“). */
function spalten(kopf: Zelle[], erwartet: Record<string, string>) {
  const index: Record<string, number> = {};
  const normiert = kopf.map((k) => norm(String(k ?? '')));
  for (const [schluessel, anfang] of Object.entries(erwartet)) {
    index[schluessel] = normiert.findIndex((k) => k.startsWith(anfang));
  }
  return index;
}

function zeilen(blatt: Blatt | undefined, erwartet: Record<string, string>, pflicht: string[], fehler: string[]) {
  if (!blatt || blatt.data.length === 0) return [];
  const idx = spalten(blatt.data[0], erwartet);
  const fehlend = pflicht.filter((p) => idx[p] < 0);
  if (fehlend.length) {
    fehler.push(`Blatt „${blatt.sheet}“: Spalte(n) ${fehlend.map((f) => `„${erwartet[f]}“`).join(', ')} fehlen.`);
    return [];
  }
  return blatt.data.slice(1).flatMap((zeile, i) => {
    const werte = Object.fromEntries(
      Object.entries(idx).map(([k, j]) => [k, j >= 0 ? text(zeile[j]) : null]),
    ) as Record<string, string | null>;
    if (Object.values(werte).every((w) => w === null)) return [];
    return [{ nr: i + 2, werte }];
  });
}

const findeBlatt = (blaetter: Blatt[], name: string) => blaetter.find((b) => norm(b.sheet).startsWith(name));

export function planeImport(blaetter: Blatt[], bestand: Bestand): ImportPlan {
  const fehler: string[] = [];
  const hinweise: string[] = [];
  const aenderungen: Aenderung[] = [];
  const zaehler: ImportPlan['zaehler'] = {
    gleisanschluesse: { neu: 0, geaendert: 0 },
    ansprechpartner: { neu: 0, geaendert: 0 },
    elemente: { neu: 0, geaendert: 0 },
  };

  const gaBlatt = findeBlatt(blaetter, 'gleisanschl');
  if (!gaBlatt) {
    fehler.push('Blatt „Gleisanschlüsse“ nicht gefunden. Bitte die Stammdaten-Vorlage verwenden.');
    return { aenderungen, zaehler, fehler, hinweise };
  }

  const vermerke = (tabelle: SyncTabelle, alt: object | undefined, neu: Aenderung['datensatz'], z: keyof typeof zaehler) => {
    if (alt && Object.entries(neu).every(([k, v]) => ((alt as Record<string, unknown>)[k] ?? null) === (v ?? null))) return;
    aenderungen.push({ tabelle, datensatz: neu, neu: !alt });
    zaehler[z][alt ? 'geaendert' : 'neu']++;
  };

  // Gleisanschlüsse
  const idZuKuerzel = new Map<string, string>();
  for (const ga of bestand.gleisanschluesse) {
    if (ga.kuerzel && !ga.geloescht) idZuKuerzel.set(norm(ga.kuerzel), ga.id);
  }
  const imBlatt = new Set<string>();
  for (const { nr, werte } of zeilen(
    gaBlatt,
    { kuerzel: 'kürzel', name: 'name', firma: 'firma', adresse: 'adresse', bemerkung: 'bemerkung' },
    ['kuerzel', 'name'],
    fehler,
  )) {
    if (!werte.kuerzel || !werte.name) {
      fehler.push(`Gleisanschlüsse, Zeile ${nr}: Kürzel und Name sind Pflicht.`);
      continue;
    }
    const k = norm(werte.kuerzel);
    if (imBlatt.has(k)) {
      fehler.push(`Gleisanschlüsse, Zeile ${nr}: Kürzel „${werte.kuerzel}“ kommt doppelt vor.`);
      continue;
    }
    imBlatt.add(k);
    if (BEISPIEL_NAMEN.includes(norm(werte.name))) hinweise.push(`Gleisanschlüsse, Zeile ${nr}: sieht nach einer Beispielzeile aus.`);
    const alt = bestand.gleisanschluesse.find((g) => g.id === idZuKuerzel.get(k));
    const id = alt?.id ?? crypto.randomUUID();
    idZuKuerzel.set(k, id);
    vermerke(
      'gleisanschluss',
      alt,
      { id, kuerzel: werte.kuerzel, name: werte.name, firma: werte.firma, adresse: werte.adresse, bemerkung: werte.bemerkung, aktiv: true },
      'gleisanschluesse',
    );
  }

  const anschlussId = (blatt: string, nr: number, kuerzel: string | null) => {
    const id = kuerzel ? idZuKuerzel.get(norm(kuerzel)) : undefined;
    if (!id) fehler.push(`${blatt}, Zeile ${nr}: Gleisanschluss „${kuerzel ?? ''}“ unbekannt.`);
    return id;
  };

  // Ansprechpartner
  for (const { nr, werte } of zeilen(
    findeBlatt(blaetter, 'ansprechpartner'),
    { ga: 'gleisanschluss', name: 'name', funktion: 'funktion', telefon: 'telefon', email: 'e-mail', bericht: 'erhält bericht' },
    ['ga', 'name'],
    fehler,
  )) {
    const gaId = anschlussId('Ansprechpartner', nr, werte.ga);
    if (!gaId) continue;
    if (!werte.name) {
      fehler.push(`Ansprechpartner, Zeile ${nr}: Name fehlt.`);
      continue;
    }
    if (BEISPIEL_NAMEN.includes(norm(werte.name))) hinweise.push(`Ansprechpartner, Zeile ${nr}: sieht nach einer Beispielzeile aus.`);
    const alt = bestand.ansprechpartner.find(
      (a) => !a.geloescht && a.gleisanschlussId === gaId && norm(a.name) === norm(werte.name!),
    );
    vermerke(
      'ansprechpartner',
      alt,
      {
        id: alt?.id ?? crypto.randomUUID(),
        gleisanschlussId: gaId,
        name: werte.name,
        funktion: werte.funktion,
        telefon: werte.telefon,
        email: werte.email,
        erhaeltBericht: ['ja', 'j', 'x', 'true', '1'].includes(norm(werte.bericht ?? '')),
      },
      'ansprechpartner',
    );
  }

  // Infrastrukturelemente
  for (const { nr, werte } of zeilen(
    findeBlatt(blaetter, 'infrastruktur'),
    { ga: 'gleisanschluss', typ: 'typ', bezeichnung: 'bezeichnung', beschreibung: 'beschreibung', reihenfolge: 'reihenfolge' },
    ['ga', 'typ', 'bezeichnung'],
    fehler,
  )) {
    const gaId = anschlussId('Infrastrukturelemente', nr, werte.ga);
    if (!gaId) continue;
    const typ = TYPEN[norm(werte.typ ?? '')];
    if (!typ || !werte.bezeichnung) {
      fehler.push(`Infrastrukturelemente, Zeile ${nr}: Typ (Gleis, Weiche, Signal, Bauwerk, Sonstiges) und Bezeichnung sind Pflicht.`);
      continue;
    }
    const alt = bestand.elemente.find(
      (e) => !e.geloescht && e.gleisanschlussId === gaId && e.typ === typ && norm(e.bezeichnung) === norm(werte.bezeichnung!),
    );
    const reihenfolge = Number(werte.reihenfolge);
    vermerke(
      'infrastrukturelement',
      alt,
      {
        id: alt?.id ?? crypto.randomUUID(),
        gleisanschlussId: gaId,
        typ,
        bezeichnung: werte.bezeichnung,
        beschreibung: werte.beschreibung,
        sortierung: Number.isFinite(reihenfolge) && werte.reihenfolge !== null ? reihenfolge : nr * 10,
        aktiv: true,
      },
      'elemente',
    );
  }

  return { aenderungen, zaehler, fehler, hinweise };
}

export async function ladeBestand(datenbank: LokaleDatenbank = db): Promise<Bestand> {
  const [gleisanschluesse, ansprechpartner, elemente] = await Promise.all([
    datenbank.gleisanschluss.toArray(),
    datenbank.ansprechpartner.toArray(),
    datenbank.infrastrukturelement.toArray(),
  ]);
  return { gleisanschluesse, ansprechpartner, elemente };
}

/** Schreibt alle geplanten Änderungen in einer Transaktion: ganz oder gar nicht. */
export async function fuehreImportAus(plan: ImportPlan, datenbank: LokaleDatenbank = db) {
  await datenbank.transaction(
    'rw',
    [datenbank.gleisanschluss, datenbank.ansprechpartner, datenbank.infrastrukturelement, datenbank.outbox],
    async () => {
      for (const { tabelle, datensatz } of plan.aenderungen) {
        await speichere(tabelle, datensatz as never, datenbank);
      }
    },
  );
}
