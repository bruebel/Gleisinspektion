import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { aktiv, db, loesche, naechsteLfdNr, speichere, speichereFoto, type Feststellung, type Foto } from '../db/lokal';
import { FotoVorschau } from '../FotoVorschau';
import { komprimiereFoto } from '../fotos';
import { Feld, Seitenkopf, TYP_NAMEN, TYP_REIHENFOLGE, Textfeld, leerZuNull } from '../komponenten';

type FotoEintrag = { foto: Foto; entfernt?: boolean } | { neu: Blob; schluessel: string };

const LEER = { infrastrukturelementId: '', ort: '', feststellung: '', massnahme: '', frist: '', zustaendig: '' };

export function FeststellungFormular() {
  const { id: inspektionId, fid } = useParams();
  const neu = fid === 'neu';
  const navigate = useNavigate();
  const zurueck = `/inspektionen/${inspektionId}`;
  const kameraRef = useRef<HTMLInputElement>(null);
  const galerieRef = useRef<HTMLInputElement>(null);

  const inspektion = useLiveQuery(() => db.inspektion.get(inspektionId!), [inspektionId]);
  const vorhanden = useLiveQuery(() => (neu ? undefined : db.feststellung.get(fid!)), [fid]);
  const gaId = inspektion?.gleisanschlussId;
  const elemente = useLiveQuery(
    async () => (gaId ? aktiv(await db.infrastrukturelement.where('gleisanschlussId').equals(gaId).sortBy('sortierung')) : []),
    [gaId],
  );
  const ansprechpartner = useLiveQuery(
    async () => (gaId ? aktiv(await db.ansprechpartner.where('gleisanschlussId').equals(gaId).toArray()) : []),
    [gaId],
  );

  const [werte, setWerte] = useState(LEER);
  const [fotos, setFotos] = useState<FotoEintrag[]>([]);
  const [verarbeite, setVerarbeite] = useState(0);
  const [speichert, setSpeichert] = useState(false);

  useEffect(() => {
    if (!vorhanden) return;
    setWerte({
      infrastrukturelementId: vorhanden.infrastrukturelementId ?? '',
      ort: vorhanden.ort ?? '',
      feststellung: vorhanden.feststellung,
      massnahme: vorhanden.massnahme,
      frist: vorhanden.frist ?? '',
      zustaendig: vorhanden.zustaendig ?? '',
    });
    db.foto
      .where('feststellungId')
      .equals(vorhanden.id)
      .sortBy('reihenfolge')
      .then((liste) => setFotos(aktiv(liste).map((foto) => ({ foto }))));
  }, [vorhanden?.id]);

  const setze = (feld: keyof typeof werte) => (e: { target: { value: string } }) =>
    setWerte({ ...werte, [feld]: e.target.value });

  const fotosHinzufuegen = async (dateien: FileList | null) => {
    if (!dateien?.length) return;
    const liste = Array.from(dateien);
    setVerarbeite((n) => n + liste.length);
    for (const datei of liste) {
      const blob = await komprimiereFoto(datei);
      setFotos((f) => [...f, { neu: blob, schluessel: crypto.randomUUID() }]);
      setVerarbeite((n) => n - 1);
    }
  };

  const speichern = async (weiter: boolean) => {
    setSpeichert(true);
    try {
      const daten = {
        inspektionId: inspektionId!,
        infrastrukturelementId: leerZuNull(werte.infrastrukturelementId),
        ort: leerZuNull(werte.ort),
        feststellung: werte.feststellung.trim(),
        massnahme: werte.massnahme.trim(),
        frist: leerZuNull(werte.frist),
        zustaendig: leerZuNull(werte.zustaendig),
      };
      const gespeichert = await speichere<Feststellung>(
        'feststellung',
        vorhanden ? { ...vorhanden, ...daten } : { ...daten, lfdNr: await naechsteLfdNr(inspektionId!), status: 'offen' },
      );
      let reihenfolge = 0;
      for (const eintrag of fotos) {
        if ('neu' in eintrag) await speichereFoto(gespeichert.id, eintrag.neu, reihenfolge++);
        else if (eintrag.entfernt) {
          await loesche('foto', eintrag.foto.id);
          await db.fotoDatei.delete(eintrag.foto.id);
        }
        else {
          if (eintrag.foto.reihenfolge !== reihenfolge) await speichere<Foto>('foto', { ...eintrag.foto, reihenfolge });
          reihenfolge++;
        }
      }
      if (weiter) {
        // Element bleibt vorausgewählt: oft folgen mehrere Feststellungen am selben Ort.
        setWerte({ ...LEER, infrastrukturelementId: werte.infrastrukturelementId });
        setFotos([]);
        if (!neu) navigate(`${zurueck}/feststellungen/neu`, { replace: true });
        window.scrollTo(0, 0);
      } else {
        navigate(zurueck, { replace: true });
      }
    } finally {
      setSpeichert(false);
    }
  };

  const absenden = (e: FormEvent) => {
    e.preventDefault();
    const weiter = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'weiter';
    void speichern(weiter);
  };

  if (!inspektion || (!neu && vorhanden === undefined)) return null;

  const sichtbareFotos = fotos.filter((f) => !('foto' in f && f.entfernt));

  return (
    <section>
      <Seitenkopf titel={neu ? 'Neue Feststellung' : `Feststellung ${vorhanden?.lfdNr ?? ''}`} zurueck={zurueck} />
      <form className="formular" onSubmit={absenden}>
        <label>
          Infrastrukturelement
          <select value={werte.infrastrukturelementId} onChange={setze('infrastrukturelementId')}>
            <option value="">– keines / nur Ortsangabe –</option>
            {TYP_REIHENFOLGE.map((typ) => {
              const vomTyp = elemente?.filter((e) => e.typ === typ) ?? [];
              return vomTyp.length ? (
                <optgroup key={typ} label={TYP_NAMEN[typ]}>
                  {vomTyp.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.bezeichnung}
                      {e.beschreibung ? ` – ${e.beschreibung}` : ''}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
        <Feld label="Ort / genauere Lage" value={werte.ort} onChange={setze('ort')} placeholder="z. B. km 0,350, Herzstück" />
        <Textfeld label="Feststellung *" value={werte.feststellung} onChange={setze('feststellung')} required />
        <Textfeld label="Maßnahmenvorschlag *" value={werte.massnahme} onChange={setze('massnahme')} required />
        <Feld label="Frist" type="date" value={werte.frist} onChange={setze('frist')} />
        <Feld label="Zuständig" value={werte.zustaendig} onChange={setze('zustaendig')} list="zustaendig-vorschlaege" />
        <datalist id="zustaendig-vorschlaege">
          {ansprechpartner?.map((a) => (
            <option key={a.id} value={a.name} />
          ))}
        </datalist>

        <div>
          <span className="feldname">Fotos</span>
          <div className="fotoleiste gross">
            {sichtbareFotos.map((f) => (
              <div key={'foto' in f ? f.foto.id : f.schluessel} className="foto">
                {'foto' in f ? <FotoVorschau fotoId={f.foto.id} /> : <FotoVorschau datei={f.neu} />}
                <button
                  type="button"
                  aria-label="Foto entfernen"
                  onClick={() =>
                    setFotos((liste) =>
                      liste.flatMap((x) => {
                        if (x !== f) return [x];
                        return 'foto' in x ? [{ ...x, entfernt: true }] : [];
                      }),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
            {verarbeite > 0 && <span className="vorschau leer-bild">…</span>}
          </div>
          <input
            ref={kameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={(e) => {
              void fotosHinzufuegen(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={galerieRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void fotosHinzufuegen(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="zweispaltig">
            <button type="button" onClick={() => kameraRef.current?.click()}>
              📷 Foto aufnehmen
            </button>
            <button type="button" onClick={() => galerieRef.current?.click()}>
              🖼 Aus Galerie
            </button>
          </div>
        </div>

        <button type="submit" className="primaer" value="fertig" disabled={speichert || verarbeite > 0}>
          Speichern
        </button>
        <button type="submit" value="weiter" disabled={speichert || verarbeite > 0}>
          Speichern und nächste Feststellung
        </button>
        {!neu && (
          <button
            type="button"
            className="gefahr"
            onClick={async () => {
              if (!confirm('Feststellung löschen?')) return;
              await loesche('feststellung', fid!);
              navigate(zurueck, { replace: true });
            }}
          >
            Feststellung löschen
          </button>
        )}
      </form>
    </section>
  );
}
