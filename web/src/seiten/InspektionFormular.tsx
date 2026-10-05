import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { gespeicherteAnmeldung } from '../api';
import { aktiv, db, loesche, speichere, type Inspektion } from '../db/lokal';
import { Feld, PRUEFARTEN, Seitenkopf, Textfeld, heute, jetztUhrzeit, leerZuNull } from '../komponenten';

export function InspektionFormular() {
  const { id } = useParams();
  const neu = !id;
  const navigate = useNavigate();
  const vorhanden = useLiveQuery(() => (neu ? undefined : db.inspektion.get(id!)), [id]);
  const anschluesse = useLiveQuery(async () => aktiv(await db.gleisanschluss.orderBy('name').toArray()));
  const [werte, setWerte] = useState({
    gleisanschlussId: '',
    art: PRUEFARTEN[0],
    datum: heute(),
    beginn: jetztUhrzeit(),
    ende: '',
    durchfuehrender: gespeicherteAnmeldung()?.benutzer.name ?? '',
    teilnehmer: '',
    bemerkung: '',
  });

  useEffect(() => {
    if (vorhanden)
      setWerte({
        gleisanschlussId: vorhanden.gleisanschlussId,
        art: vorhanden.art ?? '',
        datum: vorhanden.datum,
        beginn: vorhanden.beginn ?? '',
        ende: vorhanden.ende ?? '',
        durchfuehrender: vorhanden.durchfuehrender,
        teilnehmer: vorhanden.teilnehmer ?? '',
        bemerkung: vorhanden.bemerkung ?? '',
      });
  }, [vorhanden]);

  const setze = (feld: keyof typeof werte) => (e: { target: { value: string } }) =>
    setWerte({ ...werte, [feld]: e.target.value });

  const absenden = async (e: FormEvent) => {
    e.preventDefault();
    const gespeichert = await speichere<Inspektion>('inspektion', {
      ...(vorhanden ?? { status: 'entwurf' }),
      gleisanschlussId: werte.gleisanschlussId,
      art: leerZuNull(werte.art),
      datum: werte.datum,
      beginn: leerZuNull(werte.beginn),
      ende: leerZuNull(werte.ende),
      durchfuehrender: werte.durchfuehrender.trim(),
      teilnehmer: leerZuNull(werte.teilnehmer),
      bemerkung: leerZuNull(werte.bemerkung),
    });
    navigate(`/inspektionen/${gespeichert.id}`, { replace: true });
  };

  if ((!neu && vorhanden === undefined) || !anschluesse) return null;

  if (anschluesse.length === 0)
    return (
      <section>
        <Seitenkopf titel="Neue Begehung" zurueck="/" />
        <p className="leer">
          Lege zuerst einen <Link to="/gleisanschluesse">Gleisanschluss</Link> an oder importiere die Excel-Vorlage.
        </p>
      </section>
    );

  return (
    <section>
      <Seitenkopf titel={neu ? 'Neue Begehung' : 'Begehung bearbeiten'} zurueck={neu ? '/' : `/inspektionen/${id}`} />
      <form className="formular" onSubmit={absenden}>
        <label>
          Gleisanschluss *
          <select value={werte.gleisanschlussId} onChange={setze('gleisanschlussId')} required>
            <option value="">Bitte wählen …</option>
            {anschluesse.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Art der Prüfung
          <select value={werte.art} onChange={setze('art')}>
            {!werte.art && <option value="">Keine Angabe</option>}
            {PRUEFARTEN.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <Feld label="Datum *" type="date" value={werte.datum} onChange={setze('datum')} required />
        <div className="zweispaltig">
          <Feld label="Beginn" type="time" value={werte.beginn} onChange={setze('beginn')} />
          <Feld label="Ende" type="time" value={werte.ende} onChange={setze('ende')} />
        </div>
        <Feld label="Durchführender *" value={werte.durchfuehrender} onChange={setze('durchfuehrender')} required />
        <Feld label="Weitere Teilnehmer" value={werte.teilnehmer} onChange={setze('teilnehmer')} />
        <Textfeld label="Bemerkung" value={werte.bemerkung} onChange={setze('bemerkung')} />
        <button type="submit" className="primaer">
          {neu ? 'Begehung beginnen' : 'Speichern'}
        </button>
        {!neu && (
          <button
            type="button"
            className="gefahr"
            onClick={async () => {
              if (!confirm('Begehung mit allen Feststellungen löschen?')) return;
              await loesche('inspektion', id!);
              navigate('/', { replace: true });
            }}
          >
            Begehung löschen
          </button>
        )}
      </form>
    </section>
  );
}
