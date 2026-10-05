import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/lokal';

export function Gleisanschluesse() {
  const anschluesse = useLiveQuery(() => db.gleisanschluss.orderBy('name').filter((a) => !a.geloescht).toArray());

  if (!anschluesse) return null;

  return (
    <section>
      <h2>Gleisanschlüsse</h2>
      {anschluesse.length === 0 ? (
        <p className="leer">
          Noch keine Gleisanschlüsse vorhanden. Sie werden später per Excel-Import oder direkt in der App angelegt.
        </p>
      ) : (
        <ul className="liste">
          {anschluesse.map((a) => (
            <li key={a.id}>
              <strong>{a.name}</strong>
              {a.firma && <span>{a.firma}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
