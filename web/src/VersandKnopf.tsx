import { useEffect, useState } from 'react';
import { gespeicherteAnmeldung } from './api';
import type { Ansprechpartner } from './db/lokal';
import { db } from './db/lokal';
import { Textfeld } from './komponenten';
import { synchronisiere } from './sync';
import { useOnline } from './useOnline';

interface Versand {
  versendetAm: string;
  absender: string;
  empfaenger: string[];
}

const zeitpunkt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

const mitToken = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...init.headers, authorization: `Bearer ${gespeicherteAnmeldung()?.token ?? ''}` },
});

/**
 * Versendet den PDF-Bericht per Mail über das Microsoft-365-Postfach des Servers.
 * Vorausgewählt sind die Ansprechpartner mit „Erhält den Begehungsbericht“; weitere Adressen lassen sich ergänzen.
 */
export function VersandKnopf({ inspektionId, ansprechpartner }: { inspektionId: string; ansprechpartner: Ansprechpartner[] }) {
  const online = useOnline();
  const [status, setStatus] = useState<{ aktiv: boolean; absender: string | null } | null>(null);
  const [verlauf, setVerlauf] = useState<Versand[]>([]);
  const [offen, setOffen] = useState(false);
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set());
  const [weitere, setWeitere] = useState('');
  const [nachricht, setNachricht] = useState('');
  const [sendet, setSendet] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);

  const mitAdresse = ansprechpartner.filter((a) => a.email);

  useEffect(() => {
    if (!online) return;
    let abgebrochen = false;
    (async () => {
      const [s, v] = await Promise.all([
        fetch('/api/mail/status', mitToken()).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/inspektionen/${inspektionId}/versand`, mitToken()).then((r) => (r.ok ? r.json() : [])),
      ]).catch(() => [null, []]);
      if (!abgebrochen) {
        setStatus(s);
        setVerlauf(v);
      }
    })();
    return () => {
      abgebrochen = true;
    };
  }, [online, inspektionId]);

  const oeffnen = () => {
    setAuswahl(new Set(mitAdresse.filter((a) => a.erhaeltBericht).map((a) => a.email!.toLowerCase())));
    setWeitere('');
    setNachricht('');
    setMeldung(null);
    setOffen(true);
  };

  const zusaetzlich = weitere
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const ungueltig = zusaetzlich.filter((e) => !EMAIL.test(e));
  const empfaenger = [...new Set([...auswahl, ...zusaetzlich])];

  const umschalten = (email: string) => {
    const neu = new Set(auswahl);
    if (neu.has(email)) neu.delete(email);
    else neu.add(email);
    setAuswahl(neu);
  };

  const senden = async () => {
    if (!confirm(`Bericht jetzt an ${empfaenger.length} Empfänger senden?\n\n${empfaenger.join('\n')}`)) return;
    setSendet(true);
    setMeldung(null);
    try {
      await synchronisiere();
      const ausstehend = await db.outbox.count();
      if (ausstehend > 0 && !confirm(`${ausstehend} Änderungen sind noch nicht hochgeladen und fehlen im Bericht. Trotzdem senden?`))
        return;
      const res = await fetch(
        `/api/inspektionen/${inspektionId}/versand`,
        mitToken({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ empfaenger, nachricht: nachricht.trim() || undefined }),
        }),
      );
      const daten = await res.json().catch(() => ({}));
      if (res.status === 404) throw new Error('Die Begehung ist noch nicht auf dem Server. Bitte später erneut versuchen.');
      if (!res.ok) throw new Error(daten.fehler ?? 'Der Bericht konnte nicht versendet werden.');
      setVerlauf([daten as Versand, ...verlauf]);
      setOffen(false);
      setMeldung(`Bericht an ${(daten as Versand).empfaenger.length} Empfänger versendet.`);
    } catch (e) {
      setMeldung(e instanceof Error ? e.message : 'Der Bericht konnte nicht versendet werden.');
    } finally {
      setSendet(false);
    }
  };

  if (!online) return <p className="hinweis klein">Für den Versand wird eine Verbindung benötigt.</p>;
  if (!status) return null;
  if (!status.aktiv) return <p className="hinweis klein">Der Mailversand ist auf dem Server noch nicht eingerichtet.</p>;

  return (
    <div className="bericht versand">
      {!offen ? (
        <button type="button" onClick={oeffnen}>
          ✉️ Bericht per Mail versenden
        </button>
      ) : (
        <div className="karte formular">
          <strong>Empfänger</strong>
          {mitAdresse.length === 0 && <p className="klein">Keine Ansprechpartner mit E-Mail-Adresse hinterlegt.</p>}
          {mitAdresse.map((a) => (
            <label key={a.id} className="schalter">
              <input type="checkbox" checked={auswahl.has(a.email!.toLowerCase())} onChange={() => umschalten(a.email!.toLowerCase())} />
              <span>
                {a.name}
                {a.funktion && ` (${a.funktion})`}
                <br />
                <span className="klein">{a.email}</span>
              </span>
            </label>
          ))}
          <Textfeld
            label="Weitere Empfänger"
            rows={2}
            value={weitere}
            onChange={(e) => setWeitere(e.target.value)}
            placeholder="E-Mail-Adressen, durch Komma getrennt"
            inputMode="email"
          />
          {ungueltig.length > 0 && <p className="hinweis klein">Ungültig: {ungueltig.join(', ')}</p>}
          <Textfeld
            label="Persönliche Nachricht (optional)"
            value={nachricht}
            onChange={(e) => setNachricht(e.target.value)}
            placeholder="Erscheint im Anschreiben über dem Gruß"
          />
          <p className="klein">Absender: {status.absender}</p>
          <button type="button" className="primaer" onClick={senden} disabled={sendet || empfaenger.length === 0 || ungueltig.length > 0}>
            {sendet ? 'Wird versendet …' : `An ${empfaenger.length} Empfänger senden`}
          </button>
          <button type="button" onClick={() => setOffen(false)} disabled={sendet}>
            Abbrechen
          </button>
        </div>
      )}
      {meldung && <p className="hinweis klein">{meldung}</p>}
      {verlauf.length > 0 && (
        <ul className="klein verlauf">
          {verlauf.map((v) => (
            <li key={v.versendetAm}>
              Versendet am {zeitpunkt.format(new Date(v.versendetAm))} an {v.empfaenger.join(', ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
