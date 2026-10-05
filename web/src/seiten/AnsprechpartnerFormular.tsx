import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { db, loesche, speichere, type Ansprechpartner } from '../db/lokal';
import { Feld, Seitenkopf, leerZuNull } from '../komponenten';

export function AnsprechpartnerFormular() {
  const { gaId, id } = useParams();
  const neu = id === 'neu';
  const navigate = useNavigate();
  const zurueck = `/gleisanschluesse/${gaId}`;
  const vorhanden = useLiveQuery(() => (neu ? undefined : db.ansprechpartner.get(id!)), [id]);
  const [werte, setWerte] = useState({ name: '', funktion: '', telefon: '', email: '', erhaeltBericht: false });

  useEffect(() => {
    if (vorhanden)
      setWerte({
        name: vorhanden.name,
        funktion: vorhanden.funktion ?? '',
        telefon: vorhanden.telefon ?? '',
        email: vorhanden.email ?? '',
        erhaeltBericht: vorhanden.erhaeltBericht,
      });
  }, [vorhanden]);

  const setze = (feld: 'name' | 'funktion' | 'telefon' | 'email') => (e: { target: { value: string } }) =>
    setWerte({ ...werte, [feld]: e.target.value });

  const absenden = async (e: FormEvent) => {
    e.preventDefault();
    await speichere<Ansprechpartner>('ansprechpartner', {
      ...(vorhanden ?? {}),
      gleisanschlussId: gaId!,
      name: werte.name.trim(),
      funktion: leerZuNull(werte.funktion),
      telefon: leerZuNull(werte.telefon),
      email: leerZuNull(werte.email),
      erhaeltBericht: werte.erhaeltBericht,
    });
    navigate(zurueck, { replace: true });
  };

  if (!neu && vorhanden === undefined) return null;

  return (
    <section>
      <Seitenkopf titel={neu ? 'Neuer Ansprechpartner' : 'Ansprechpartner'} zurueck={zurueck} />
      <form className="formular" onSubmit={absenden}>
        <Feld label="Name *" value={werte.name} onChange={setze('name')} required />
        <Feld label="Funktion" value={werte.funktion} onChange={setze('funktion')} placeholder="z. B. Eisenbahnbetriebsleiter" />
        <Feld label="Telefon" type="tel" value={werte.telefon} onChange={setze('telefon')} />
        <Feld label="E-Mail" type="email" value={werte.email} onChange={setze('email')} />
        <label className="schalter">
          <input
            type="checkbox"
            checked={werte.erhaeltBericht}
            onChange={(e) => setWerte({ ...werte, erhaeltBericht: e.target.checked })}
          />
          Erhält den Inspektionsbericht
        </label>
        <button type="submit" className="primaer">
          Speichern
        </button>
        {!neu && (
          <button
            type="button"
            className="gefahr"
            onClick={async () => {
              if (!confirm(`„${werte.name}“ löschen?`)) return;
              await loesche('ansprechpartner', id!);
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
