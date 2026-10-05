import { gespeicherteAnmeldung } from './api';
import { db as standardDb, SYNC_TABELLEN, type LokaleDatenbank, type SyncTabelle } from './db/lokal';

// Abgleich mit dem Server in drei Schritten:
// 1. Push: alles aus der Outbox hochladen (Eltern vor Kindern).
// 2. Fotos: Bilddateien hochladen, deren Datensatz schon auf dem Server ist.
// 3. Pull: Änderungen seit dem letzten Abgleich abholen; „letzte Änderung gewinnt“.

export interface SyncZustand {
  laeuft: boolean;
  letzterErfolg: string | null;
  fehler: string | null;
}

let zustand: SyncZustand = { laeuft: false, letzterErfolg: null, fehler: null };
const beobachter = new Set<() => void>();
const setze = (neu: Partial<SyncZustand>) => {
  zustand = { ...zustand, ...neu };
  beobachter.forEach((b) => b());
};
export const syncZustand = {
  abonnieren: (b: () => void) => (beobachter.add(b), () => beobachter.delete(b)),
  lesen: () => zustand,
};

export class NichtAngemeldet extends Error {}

const PAKET = 200;
const ZEIT_FELDER = ['beginn', 'ende'];
const NUR_SERVER = ['serverGeaendertAm'];

// Ohne Zeitlimit kann eine Anfrage bei schlechtem Netz (WLAN ohne Internet, Funkloch) ewig hängen
// und blockiert dann jeden weiteren Abgleich, bis die App neu geladen wird.
const ZEITLIMIT = 30_000;
const ZEITLIMIT_FOTO = 120_000;

type Abruf = typeof fetch;
interface Umgebung {
  datenbank?: LokaleDatenbank;
  abruf?: Abruf;
  token?: string;
  /** Zeitlimit je Anfrage in ms (Fotos: das Vierfache). */
  zeitlimit?: number;
}

class ServerFehler extends Error {}

const zeitwert = (iso: unknown) => (typeof iso === 'string' ? Date.parse(iso) : 0);

async function anfrage(abruf: Abruf, token: string, url: string, init: RequestInit = {}, zeitlimit = ZEITLIMIT) {
  // Das Zeitlimit gilt bis einschließlich Lesen der Antwort: Das Signal bricht auch einen stockenden Download ab.
  // Läuft es nach erfolgreicher Anfrage ab, passiert nichts mehr.
  const abbruch = new AbortController();
  setTimeout(() => abbruch.abort(new DOMException('Zeitlimit überschritten', 'TimeoutError')), zeitlimit);
  // Abbruch auch dann wirksam machen, wenn der Abruf das Signal nicht beachtet.
  const abgebrochen = new Promise<never>((_, nein) => abbruch.signal.addEventListener('abort', () => nein(abbruch.signal.reason)));
  abgebrochen.catch(() => undefined);
  // Netzwechsel (z. B. Mobilfunk → WLAN): laufenden Abgleich abbrechen, statt auf tote Verbindungen zu warten.
  const lauf = laufAbbruch?.signal;
  if (lauf?.aborted) abbruch.abort(lauf.reason);
  else lauf?.addEventListener('abort', () => abbruch.abort(lauf.reason), { once: true });
  const res = await Promise.race([
    abruf(url, { ...init, signal: abbruch.signal, headers: { ...init.headers, authorization: `Bearer ${token}` } }),
    abgebrochen,
  ]);
  if (res.status === 401) throw new NichtAngemeldet('Anmeldung abgelaufen. Bitte neu anmelden.');
  return res;
}

async function hochladen(datenbank: LokaleDatenbank, abruf: Abruf, token: string, zeitlimit: number) {
  const eintraege = await datenbank.outbox.toArray();
  let fehler = 0;
  for (let i = 0; i < eintraege.length; i += PAKET) {
    const paket = eintraege.slice(i, i + PAKET);
    const gesendet = new Map<string, { nr: number; geaendertAm: string }>();
    const aenderungen = [];
    for (const e of paket) {
      const datensatz = await datenbank.table(e.tabelle).get(e.datensatzId);
      if (!datensatz) {
        await datenbank.outbox.delete(e.nr!);
        continue;
      }
      gesendet.set(e.datensatzId, { nr: e.nr!, geaendertAm: datensatz.geaendertAm });
      aenderungen.push({ tabelle: e.tabelle, datensatz });
    }
    // Eltern vor Kindern, damit die Fremdschlüssel auf dem Server passen.
    aenderungen.sort((a, b) => SYNC_TABELLEN.indexOf(a.tabelle) - SYNC_TABELLEN.indexOf(b.tabelle));
    if (aenderungen.length === 0) continue;

    const res = await anfrage(abruf, token, '/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ aenderungen }),
    }, zeitlimit);
    if (!res.ok) throw new ServerFehler(`Hochladen fehlgeschlagen (Server meldet ${res.status})`);
    const antwort = (await res.json()) as { uebernommen: string[]; veraltet: string[]; fehler: { id: string }[] };
    fehler += antwort.fehler.length;

    // Outbox-Eintrag nur entfernen, wenn der Datensatz während des Hochladens nicht erneut geändert wurde.
    await datenbank.transaction('rw', [datenbank.outbox, ...SYNC_TABELLEN.map((t) => datenbank.table(t))], async () => {
      for (const id of [...antwort.uebernommen, ...antwort.veraltet]) {
        const g = gesendet.get(id);
        const e = paket.find((x) => x.datensatzId === id);
        if (!g || !e) continue;
        const aktuell = await datenbank.table(e.tabelle).get(id);
        if (!aktuell || aktuell.geaendertAm === g.geaendertAm) await datenbank.outbox.delete(g.nr);
      }
    });
  }
  return fehler;
}

async function fotosHochladen(datenbank: LokaleDatenbank, abruf: Abruf, token: string, zeitlimit: number) {
  const offen = await datenbank.fotoDatei.filter((f) => !f.hochgeladen).toArray();
  for (const datei of offen) {
    const foto = await datenbank.foto.get(datei.fotoId);
    if (!foto || foto.geloescht) {
      await datenbank.fotoDatei.delete(datei.fotoId);
      continue;
    }
    // Erst hochladen, wenn der Foto-Datensatz auf dem Server angekommen ist.
    if (await datenbank.outbox.where({ tabelle: 'foto', datensatzId: foto.id }).count()) continue;
    const res = await anfrage(abruf, token, `/api/fotos/${foto.id}`, {
      method: 'PUT',
      headers: { 'content-type': datei.datei.type || foto.mimeTyp },
      body: datei.datei,
    }, zeitlimit * 4);
    if (res.ok) await datenbank.fotoDatei.update(datei.fotoId, { hochgeladen: true });
  }
}

async function abholen(datenbank: LokaleDatenbank, abruf: Abruf, token: string, zeitlimit: number) {
  const seit = (await datenbank.meta.get('cursor'))?.wert;
  const res = await anfrage(abruf, token, `/api/sync/pull${seit ? `?seit=${encodeURIComponent(seit)}` : ''}`, {}, zeitlimit);
  if (!res.ok) throw new ServerFehler(`Abholen fehlgeschlagen (Server meldet ${res.status})`);
  const { cursor, daten } = (await res.json()) as { cursor: string | null; daten: Record<string, Record<string, unknown>[]> };

  await datenbank.transaction('rw', [datenbank.outbox, datenbank.meta, ...SYNC_TABELLEN.map((t) => datenbank.table(t))], async () => {
    for (const tabelle of SYNC_TABELLEN) {
      const tab = datenbank.table(tabelle);
      for (const zeile of daten[tabelle] ?? []) {
        for (const f of NUR_SERVER) delete zeile[f];
        for (const f of ZEIT_FELDER) if (typeof zeile[f] === 'string') zeile[f] = (zeile[f] as string).slice(0, 5);
        const lokal = await tab.get(zeile.id as string);
        if (lokal && zeitwert(lokal.geaendertAm) > zeitwert(zeile.geaendertAm)) continue; // lokale Änderung ist neuer
        await tab.put(lokal ? { ...lokal, ...zeile } : zeile);
        // Eine ältere, noch nicht hochgeladene lokale Änderung ist damit überholt.
        await datenbank.outbox.where({ tabelle: tabelle as SyncTabelle, datensatzId: zeile.id as string }).delete();
      }
    }
    if (cursor) await datenbank.meta.put({ schluessel: 'cursor', wert: cursor });
  });
}

function fehlermeldung(e: unknown) {
  if (e instanceof NichtAngemeldet || e instanceof ServerFehler) return e.message;
  if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'Keine Antwort vom Server (schwaches Netz?)';
  return 'Server nicht erreichbar';
}

let laufend: Promise<void> | null = null;
let laufAbbruch: AbortController | null = null;

/** Bricht einen laufenden Abgleich ab und startet sofort einen neuen. */
export async function neuSynchronisieren(umgebung: Umgebung = {}) {
  if (laufend) {
    laufAbbruch?.abort(new DOMException('Netzwechsel', 'AbortError'));
    await laufend;
  }
  return synchronisiere(umgebung);
}

/** Führt einen Abgleich aus; parallele Aufrufe teilen sich denselben Lauf. */
export function synchronisiere(umgebung: Umgebung = {}): Promise<void> {
  if (laufend) return laufend;
  const datenbank = umgebung.datenbank ?? standardDb;
  const abruf = umgebung.abruf ?? fetch.bind(window);
  const token = umgebung.token ?? gespeicherteAnmeldung()?.token;
  const zeitlimit = umgebung.zeitlimit ?? ZEITLIMIT;
  if (!token) return Promise.resolve();

  laufAbbruch = new AbortController();
  laufend = (async () => {
    setze({ laeuft: true });
    try {
      const fehler = await hochladen(datenbank, abruf, token, zeitlimit);
      await fotosHochladen(datenbank, abruf, token, zeitlimit);
      await abholen(datenbank, abruf, token, zeitlimit);
      const jetzt = new Date().toISOString();
      await datenbank.meta.put({ schluessel: 'letzterAbgleich', wert: jetzt });
      setze({
        letzterErfolg: jetzt,
        fehler: fehler ? `${fehler} Einträge wurden vom Server abgelehnt` : null,
      });
    } catch (e) {
      setze({ fehler: fehlermeldung(e) });
    } finally {
      setze({ laeuft: false });
      laufend = null;
      laufAbbruch = null;
    }
  })();
  return laufend;
}

/** Holt ein Foto, das auf einem anderen Gerät aufgenommen wurde, vom Server und legt es lokal ab. */
export async function ladeFoto(fotoId: string, datenbank: LokaleDatenbank = standardDb): Promise<Blob | null> {
  const token = gespeicherteAnmeldung()?.token;
  if (!token || !navigator.onLine) return null;
  try {
    const res = await anfrage(fetch.bind(window), token, `/api/fotos/${fotoId}`);
    if (!res.ok) return null;
    const datei = await res.blob();
    await datenbank.fotoDatei.put({ fotoId, datei, hochgeladen: true });
    return datei;
  } catch {
    return null;
  }
}

/** Startet den automatischen Abgleich: beim Start, wenn das Netz zurückkommt, nach Änderungen und jede Minute. */
export function starteAutoSync(datenbank: LokaleDatenbank = standardDb) {
  // Nach einem Fehlschlag bald erneut versuchen (5 s, 15 s, 30 s), danach im Minutentakt.
  const WARTEZEITEN = [5_000, 15_000, 30_000];
  let fehlversuche = 0;
  let wiederholung: ReturnType<typeof setTimeout> | undefined;
  const versuche = (neu = false) => {
    if (!navigator.onLine || document.visibilityState !== 'visible') return;
    clearTimeout(wiederholung);
    void (neu ? neuSynchronisieren : synchronisiere)({ datenbank }).then(() => {
      const { fehler } = syncZustand.lesen();
      if (!fehler || /anmelden|abgelehnt/.test(fehler)) {
        fehlversuche = 0;
        return;
      }
      if (fehlversuche < WARTEZEITEN.length) wiederholung = setTimeout(() => versuche(), WARTEZEITEN[fehlversuche++]);
    });
  };
  let verzoegert: ReturnType<typeof setTimeout> | undefined;
  const baldVersuchen = () => {
    clearTimeout(verzoegert);
    verzoegert = setTimeout(() => versuche(), 3000);
  };

  datenbank.meta.get('letzterAbgleich').then((m) => m && setze({ letzterErfolg: m.wert }));
  const sichtbar = () => versuche();
  const wiederOnline = () => {
    fehlversuche = 0;
    versuche(true);
  };
  window.addEventListener('online', wiederOnline);
  document.addEventListener('visibilitychange', sichtbar);
  datenbank.outbox.hook('creating', baldVersuchen);
  const takt = setInterval(() => versuche(), 60_000);
  versuche();

  return () => {
    window.removeEventListener('online', wiederOnline);
    document.removeEventListener('visibilitychange', sichtbar);
    datenbank.outbox.hook('creating').unsubscribe(baldVersuchen);
    clearInterval(takt);
    clearTimeout(verzoegert);
    clearTimeout(wiederholung);
  };
}
