import { useEffect, useState } from 'react';
import { gespeicherteAnmeldung } from './api';
import { db } from './db/lokal';
import { synchronisiere } from './sync';
import { useOnline } from './useOnline';

/**
 * Erstellt den PDF-Bericht auf dem Server. Vorher wird abgeglichen, damit alle Feststellungen und Fotos drin sind.
 * Öffnen und Teilen sind eigene Knöpfe, weil der Browser das Teilen nur direkt nach einem Fingertipp erlaubt.
 */
export function BerichtKnopf({ inspektionId }: { inspektionId: string }) {
  const online = useOnline();
  const [zustand, setZustand] = useState<'bereit' | 'laedt' | 'fertig'>('bereit');
  const [datei, setDatei] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const erstellen = async () => {
    setMeldung(null);
    setZustand('laedt');
    try {
      await synchronisiere();
      const offen = await db.outbox.count();
      const res = await fetch(`/api/inspektionen/${inspektionId}/bericht.pdf`, {
        headers: { authorization: `Bearer ${gespeicherteAnmeldung()?.token ?? ''}` },
      });
      if (res.status === 404) throw new Error('Die Inspektion ist noch nicht auf dem Server. Bitte später erneut versuchen.');
      if (!res.ok) throw new Error('Der Bericht konnte nicht erstellt werden.');
      const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'Bericht.pdf');
      const pdf = new File([await res.blob()], name, { type: 'application/pdf' });
      setDatei(pdf);
      setUrl(URL.createObjectURL(pdf));
      setZustand('fertig');
      if (offen > 0) setMeldung(`Hinweis: ${offen} Änderungen sind noch nicht hochgeladen und fehlen evtl. im Bericht.`);
    } catch (e) {
      setZustand('bereit');
      setMeldung(e instanceof Error ? e.message : 'Der Bericht konnte nicht erstellt werden.');
    }
  };

  const teilenMoeglich = datei && typeof navigator.canShare === 'function' && navigator.canShare({ files: [datei] });

  return (
    <div className="bericht">
      {zustand !== 'fertig' ? (
        <button type="button" onClick={erstellen} disabled={!online || zustand === 'laedt'}>
          {zustand === 'laedt' ? 'Bericht wird erstellt …' : '📄 PDF-Bericht erstellen'}
        </button>
      ) : (
        <div className="zweispaltig">
          <a className="knopf" href={url!} download={datei!.name} target="_blank" rel="noreferrer">
            Öffnen
          </a>
          {teilenMoeglich ? (
            <button type="button" onClick={() => navigator.share({ files: [datei!], title: datei!.name }).catch(() => undefined)}>
              Teilen …
            </button>
          ) : (
            <button type="button" onClick={erstellen}>
              Neu erstellen
            </button>
          )}
        </div>
      )}
      {!online && <p className="hinweis klein">Für den PDF-Bericht wird eine Verbindung benötigt.</p>}
      {meldung && <p className="hinweis klein">{meldung}</p>}
    </div>
  );
}
