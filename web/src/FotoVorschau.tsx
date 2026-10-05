import { useEffect, useState } from 'react';
import { db } from './db/lokal';

/** Zeigt ein lokal gespeichertes Foto (oder eine noch nicht gespeicherte Datei) als Vorschaubild. */
export function FotoVorschau({ fotoId, datei }: { fotoId?: string; datei?: Blob }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let aktuell: string | null = null;
    let abgebrochen = false;
    (async () => {
      const blob = datei ?? (fotoId ? (await db.fotoDatei.get(fotoId))?.datei : undefined);
      if (!blob || abgebrochen) return;
      aktuell = URL.createObjectURL(blob);
      setUrl(aktuell);
    })();
    return () => {
      abgebrochen = true;
      if (aktuell) URL.revokeObjectURL(aktuell);
    };
  }, [fotoId, datei]);

  return url ? <img className="vorschau" src={url} alt="" /> : <span className="vorschau leer-bild" />;
}
