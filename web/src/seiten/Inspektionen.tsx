import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/lokal';

const datumFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

export function Inspektionen() {
  const inspektionen = useLiveQuery(() => db.inspektion.orderBy('datum').reverse().filter((i) => !i.geloescht).toArray());
  const anschluesse = useLiveQuery(() => db.gleisanschluss.toArray());
  const nameVon = (id: string) => anschluesse?.find((a) => a.id === id)?.name ?? '–';

  if (!inspektionen) return null;

  return (
    <section>
      <h2>Inspektionen</h2>
      {inspektionen.length === 0 ? (
        <p className="leer">Noch keine Inspektionen erfasst. Die Erfassung folgt im nächsten Ausbauschritt.</p>
      ) : (
        <ul className="liste">
          {inspektionen.map((i) => (
            <li key={i.id}>
              <strong>{nameVon(i.gleisanschlussId)}</strong>
              <span>
                {datumFormat.format(new Date(i.datum))}
                {i.beginn && `, ${i.beginn}–${i.ende ?? ''}`} · {i.durchfuehrender}
              </span>
              <span className={`marke ${i.status}`}>{i.status === 'entwurf' ? 'Entwurf' : 'Abgeschlossen'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
