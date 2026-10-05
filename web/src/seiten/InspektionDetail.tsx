import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { aktiv, db, speichere, type Inspektion } from '../db/lokal';
import { FotoVorschau } from '../FotoVorschau';
import { Leer, Seitenkopf, TYP_NAMEN, datum, jetztUhrzeit } from '../komponenten';

export function InspektionDetail() {
  const { id } = useParams();
  const inspektion = useLiveQuery(() => db.inspektion.get(id!), [id]);
  const anschluss = useLiveQuery(
    () => (inspektion ? db.gleisanschluss.get(inspektion.gleisanschlussId) : undefined),
    [inspektion?.gleisanschlussId],
  );
  const ansprechpartner = useLiveQuery(
    async () =>
      inspektion ? aktiv(await db.ansprechpartner.where('gleisanschlussId').equals(inspektion.gleisanschlussId).toArray()) : [],
    [inspektion?.gleisanschlussId],
  );
  const feststellungen = useLiveQuery(
    async () => aktiv(await db.feststellung.where('inspektionId').equals(id!).sortBy('lfdNr')),
    [id],
  );
  const elemente = useLiveQuery(() => db.infrastrukturelement.toArray());
  const fotos = useLiveQuery(async () => {
    const ids = feststellungen?.map((f) => f.id) ?? [];
    return aktiv(await db.foto.where('feststellungId').anyOf(ids).sortBy('reihenfolge'));
  }, [feststellungen]);

  if (inspektion === undefined) return null;
  if (!inspektion || inspektion.geloescht) return <Leer>Inspektion nicht gefunden.</Leer>;

  const offen = inspektion.status === 'entwurf';
  const elementName = (eid?: string | null) => {
    const e = elemente?.find((x) => x.id === eid);
    return e ? `${TYP_NAMEN[e.typ].split(' ')[0]} ${e.bezeichnung}` : null;
  };

  const setzeStatus = (status: Inspektion['status']) =>
    speichere<Inspektion>('inspektion', {
      ...inspektion,
      status,
      ende: status === 'abgeschlossen' ? (inspektion.ende ?? jetztUhrzeit()) : inspektion.ende,
    });

  return (
    <section>
      <Seitenkopf titel={anschluss?.name ?? 'Inspektion'} zurueck="/">
        <Link to={`/inspektionen/${id}/bearbeiten`} className="knopf klein">
          Bearbeiten
        </Link>
      </Seitenkopf>

      <div className="karte">
        <p>
          <strong>{datum(inspektion.datum)}</strong>
          {inspektion.beginn && `, ${inspektion.beginn}–${inspektion.ende ?? '…'} Uhr`}
        </p>
        <p>Durchführender: {inspektion.durchfuehrender}</p>
        {inspektion.teilnehmer && <p>Teilnehmer: {inspektion.teilnehmer}</p>}
        {ansprechpartner && ansprechpartner.length > 0 && (
          <p>Ansprechpartner: {ansprechpartner.map((a) => a.name + (a.funktion ? ` (${a.funktion})` : '')).join(', ')}</p>
        )}
        {inspektion.bemerkung && <p>{inspektion.bemerkung}</p>}
        <span className={`marke ${inspektion.status}`}>{offen ? 'In Arbeit' : 'Abgeschlossen'}</span>
      </div>

      <h3>Feststellungen ({feststellungen?.length ?? 0})</h3>
      {offen && (
        <Link to={`/inspektionen/${id}/feststellungen/neu`} className="knopf primaer gross">
          + Feststellung erfassen
        </Link>
      )}
      {feststellungen?.length === 0 && <Leer>Noch keine Feststellungen.</Leer>}
      <ul className="liste">
        {feststellungen?.map((f) => {
          const eigeneFotos = fotos?.filter((x) => x.feststellungId === f.id) ?? [];
          return (
            <li key={f.id}>
              <Link to={`/inspektionen/${id}/feststellungen/${f.id}`} className="eintrag">
                <strong>
                  {f.lfdNr}. {[elementName(f.infrastrukturelementId), f.ort].filter(Boolean).join(' – ') || 'Ohne Ortsangabe'}
                </strong>
                <span>{f.feststellung}</span>
                <span className="massnahme">→ {f.massnahme}</span>
                {(f.frist || f.zustaendig) && (
                  <span className="klein">
                    {[f.frist && `Frist ${datum(f.frist)}`, f.zustaendig && `Zuständig: ${f.zustaendig}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
                {eigeneFotos.length > 0 && (
                  <span className="fotoleiste">
                    {eigeneFotos.map((foto) => (
                      <FotoVorschau key={foto.id} fotoId={foto.id} />
                    ))}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {offen ? (
        <button type="button" className="primaer" onClick={() => setzeStatus('abgeschlossen')}>
          Inspektion abschließen
        </button>
      ) : (
        <button type="button" onClick={() => setzeStatus('entwurf')}>
          Wieder öffnen
        </button>
      )}
    </section>
  );
}
