import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { aktiv, db, loesche, speichere, type Gleisanschluss } from '../db/lokal';
import { Feld, Leer, Seitenkopf, TYP_NAMEN, TYP_REIHENFOLGE, Textfeld, leerZuNull } from '../komponenten';

export function GleisanschlussFormular() {
  const { id } = useParams();
  const neu = id === 'neu';
  const navigate = useNavigate();
  const vorhanden = useLiveQuery(() => (neu ? undefined : db.gleisanschluss.get(id!)), [id]);
  const ansprechpartner = useLiveQuery(
    async () => (neu ? [] : aktiv(await db.ansprechpartner.where('gleisanschlussId').equals(id!).sortBy('name'))),
    [id],
  );
  const elemente = useLiveQuery(
    async () =>
      neu ? [] : aktiv(await db.infrastrukturelement.where('gleisanschlussId').equals(id!).sortBy('sortierung')),
    [id],
  );

  const [werte, setWerte] = useState({ name: '', kuerzel: '', firma: '', adresse: '', bemerkung: '' });
  const [fehler, setFehler] = useState<string | null>(null);
  useEffect(() => {
    if (vorhanden)
      setWerte({
        name: vorhanden.name,
        kuerzel: vorhanden.kuerzel ?? '',
        firma: vorhanden.firma ?? '',
        adresse: vorhanden.adresse ?? '',
        bemerkung: vorhanden.bemerkung ?? '',
      });
  }, [vorhanden]);

  const setze = (feld: keyof typeof werte) => (e: { target: { value: string } }) =>
    setWerte({ ...werte, [feld]: e.target.value });

  const absenden = async (e: FormEvent) => {
    e.preventDefault();
    const kuerzel = leerZuNull(werte.kuerzel);
    if (kuerzel) {
      const doppelt = await db.gleisanschluss
        .filter((g) => !g.geloescht && g.id !== id && g.kuerzel?.toLowerCase() === kuerzel.toLowerCase())
        .first();
      if (doppelt) return setFehler(`Das Kürzel „${kuerzel}“ ist schon an „${doppelt.name}“ vergeben.`);
    }
    const gespeichert = await speichere<Gleisanschluss>('gleisanschluss', {
      ...(vorhanden ?? { aktiv: true }),
      name: werte.name.trim(),
      kuerzel,
      firma: leerZuNull(werte.firma),
      adresse: leerZuNull(werte.adresse),
      bemerkung: leerZuNull(werte.bemerkung),
    });
    navigate(neu ? `/gleisanschluesse/${gespeichert.id}` : '/gleisanschluesse', { replace: neu });
  };

  if (!neu && vorhanden === undefined) return null;

  return (
    <section>
      <Seitenkopf titel={neu ? 'Neuer Gleisanschluss' : werte.name || 'Gleisanschluss'} zurueck="/gleisanschluesse" />
      <form className="formular" onSubmit={absenden}>
        <Feld label="Name *" value={werte.name} onChange={setze('name')} required />
        <Feld label="Kürzel" value={werte.kuerzel} onChange={setze('kuerzel')} placeholder="z. B. HAFEN-N" />
        <Feld label="Firma / Betreiber" value={werte.firma} onChange={setze('firma')} />
        <Feld label="Adresse" value={werte.adresse} onChange={setze('adresse')} />
        <Textfeld label="Bemerkung" value={werte.bemerkung} onChange={setze('bemerkung')} />
        {fehler && <p className="fehler">{fehler}</p>}
        <button type="submit" className="primaer">
          Speichern
        </button>
      </form>

      {!neu && (
        <>
          <h3>Ansprechpartner</h3>
          {ansprechpartner?.length === 0 && <Leer>Noch keine Ansprechpartner.</Leer>}
          <ul className="liste">
            {ansprechpartner?.map((a) => (
              <li key={a.id}>
                <Link to={`/gleisanschluesse/${id}/ansprechpartner/${a.id}`} className="eintrag">
                  <strong>{a.name}</strong>
                  <span>
                    {[a.funktion, a.telefon, a.email].filter(Boolean).join(' · ')}
                    {a.erhaeltBericht && ' · erhält Bericht'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to={`/gleisanschluesse/${id}/ansprechpartner/neu`} className="knopf">
            + Ansprechpartner
          </Link>

          <h3>Infrastrukturelemente</h3>
          {elemente?.length === 0 && <Leer>Noch keine Elemente. Sie stehen bei der Erfassung von Feststellungen zur Auswahl.</Leer>}
          {TYP_REIHENFOLGE.map((typ) => {
            const vomTyp = elemente?.filter((e) => e.typ === typ) ?? [];
            if (vomTyp.length === 0) return null;
            return (
              <div key={typ}>
                <h4>{TYP_NAMEN[typ]}</h4>
                <ul className="liste">
                  {vomTyp.map((e) => (
                    <li key={e.id}>
                      <Link to={`/gleisanschluesse/${id}/elemente/${e.id}`} className="eintrag">
                        <strong>{e.bezeichnung}</strong>
                        {e.beschreibung && <span>{e.beschreibung}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <Link to={`/gleisanschluesse/${id}/elemente/neu`} className="knopf">
            + Element
          </Link>

          <button
            type="button"
            className="gefahr"
            onClick={async () => {
              if (!confirm(`Gleisanschluss „${werte.name}“ löschen?`)) return;
              await loesche('gleisanschluss', id!);
              navigate('/gleisanschluesse', { replace: true });
            }}
          >
            Gleisanschluss löschen
          </button>
        </>
      )}
    </section>
  );
}
