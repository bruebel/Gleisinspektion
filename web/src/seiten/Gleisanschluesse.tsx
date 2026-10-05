import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { aktiv, db } from '../db/lokal';
import { Leer, Seitenkopf } from '../komponenten';

export function Gleisanschluesse() {
  const anschluesse = useLiveQuery(async () => aktiv(await db.gleisanschluss.orderBy('name').toArray()));
  const elementZahl = useLiveQuery(async () => {
    const zahl = new Map<string, number>();
    for (const e of aktiv(await db.infrastrukturelement.toArray())) {
      zahl.set(e.gleisanschlussId, (zahl.get(e.gleisanschlussId) ?? 0) + 1);
    }
    return zahl;
  });

  if (!anschluesse) return null;

  return (
    <section>
      <Seitenkopf titel="Gleisanschlüsse" />
      <div className="aktionen">
        <Link to="/gleisanschluesse/neu" className="knopf primaer">
          + Neuer Gleisanschluss
        </Link>
        <Link to="/gleisanschluesse/import" className="knopf">
          Excel importieren
        </Link>
      </div>
      {anschluesse.length === 0 ? (
        <Leer>Noch keine Gleisanschlüsse vorhanden. Lege einen an oder importiere die ausgefüllte Excel-Vorlage.</Leer>
      ) : (
        <ul className="liste">
          {anschluesse.map((a) => (
            <li key={a.id}>
              <Link to={`/gleisanschluesse/${a.id}`} className="eintrag">
                <strong>{a.name}</strong>
                <span>
                  {[a.kuerzel, a.firma].filter(Boolean).join(' · ')}
                  {' · '}
                  {elementZahl?.get(a.id) ?? 0} Elemente
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
