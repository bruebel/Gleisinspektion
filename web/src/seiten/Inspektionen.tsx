import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { aktiv, db } from '../db/lokal';
import { Leer, Seitenkopf, datum } from '../komponenten';

export function Inspektionen() {
  const inspektionen = useLiveQuery(async () => aktiv(await db.inspektion.orderBy('datum').reverse().toArray()));
  const anschluesse = useLiveQuery(() => db.gleisanschluss.toArray());
  const anzahl = useLiveQuery(async () => {
    const zahl = new Map<string, number>();
    for (const f of aktiv(await db.feststellung.toArray())) zahl.set(f.inspektionId, (zahl.get(f.inspektionId) ?? 0) + 1);
    return zahl;
  });
  const nameVon = (id: string) => anschluesse?.find((a) => a.id === id)?.name ?? '–';

  if (!inspektionen) return null;

  return (
    <section>
      <Seitenkopf titel="Begehungen" />
      <div className="aktionen">
        <Link to="/inspektionen/neu" className="knopf primaer">
          + Neue Begehung
        </Link>
      </div>
      {inspektionen.length === 0 ? (
        <Leer>Noch keine Begehungen erfasst.</Leer>
      ) : (
        <ul className="liste">
          {inspektionen.map((i) => (
            <li key={i.id}>
              <Link to={`/inspektionen/${i.id}`} className="eintrag">
                <strong>{nameVon(i.gleisanschlussId)}</strong>
                <span>
                  {i.art && `${i.art} · `}
                  {datum(i.datum)}
                  {i.beginn && `, ${i.beginn}${i.ende ? `–${i.ende}` : ''} Uhr`} · {i.durchfuehrender}
                </span>
                <span>
                  <span className={`marke ${i.status}`}>{i.status === 'entwurf' ? 'In Arbeit' : 'Abgeschlossen'}</span>{' '}
                  {anzahl?.get(i.id) ?? 0} Feststellungen
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
