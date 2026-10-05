import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { aktiv, db, loesche, speichere, type ElementTyp, type Infrastrukturelement } from '../db/lokal';
import { Feld, Seitenkopf, TYP_NAMEN, TYP_REIHENFOLGE, leerZuNull } from '../komponenten';

export function ElementFormular() {
  const { gaId, id } = useParams();
  const neu = id === 'neu';
  const navigate = useNavigate();
  const zurueck = `/gleisanschluesse/${gaId}`;
  const vorhanden = useLiveQuery(() => (neu ? undefined : db.infrastrukturelement.get(id!)), [id]);
  const [werte, setWerte] = useState({ typ: 'gleis' as ElementTyp, bezeichnung: '', beschreibung: '' });

  useEffect(() => {
    if (vorhanden)
      setWerte({ typ: vorhanden.typ, bezeichnung: vorhanden.bezeichnung, beschreibung: vorhanden.beschreibung ?? '' });
  }, [vorhanden]);

  const absenden = async (e: FormEvent) => {
    e.preventDefault();
    // Neue Elemente ans Ende der Liste stellen.
    const sortierung =
      vorhanden?.sortierung ??
      Math.max(0, ...aktiv(await db.infrastrukturelement.where('gleisanschlussId').equals(gaId!).toArray()).map((x) => x.sortierung)) + 10;
    await speichere<Infrastrukturelement>('infrastrukturelement', {
      ...(vorhanden ?? { aktiv: true }),
      gleisanschlussId: gaId!,
      typ: werte.typ,
      bezeichnung: werte.bezeichnung.trim(),
      beschreibung: leerZuNull(werte.beschreibung),
      sortierung,
    });
    navigate(zurueck, { replace: true });
  };

  if (!neu && vorhanden === undefined) return null;

  return (
    <section>
      <Seitenkopf titel={neu ? 'Neues Element' : 'Element'} zurueck={zurueck} />
      <form className="formular" onSubmit={absenden}>
        <label>
          Typ *
          <select value={werte.typ} onChange={(e) => setWerte({ ...werte, typ: e.target.value as ElementTyp })}>
            {TYP_REIHENFOLGE.map((t) => (
              <option key={t} value={t}>
                {TYP_NAMEN[t]}
              </option>
            ))}
          </select>
        </label>
        <Feld
          label="Bezeichnung *"
          value={werte.bezeichnung}
          onChange={(e) => setWerte({ ...werte, bezeichnung: e.target.value })}
          placeholder="z. B. Gleis 2, W 3, Ls 1"
          required
        />
        <Feld
          label="Beschreibung"
          value={werte.beschreibung}
          onChange={(e) => setWerte({ ...werte, beschreibung: e.target.value })}
        />
        <button type="submit" className="primaer">
          Speichern
        </button>
        {!neu && (
          <button
            type="button"
            className="gefahr"
            onClick={async () => {
              if (!confirm(`„${werte.bezeichnung}“ löschen?`)) return;
              await loesche('infrastrukturelement', id!);
              navigate(zurueck, { replace: true });
            }}
          >
            Löschen
          </button>
        )}
      </form>
    </section>
  );
}
