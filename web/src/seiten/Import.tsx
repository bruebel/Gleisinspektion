import { useState } from 'react';
import readXlsxFile from 'read-excel-file/browser';
import { useNavigate } from 'react-router-dom';
import { fuehreImportAus, ladeBestand, planeImport, type Blatt, type ImportPlan } from '../import/excel';
import { Seitenkopf } from '../komponenten';

const zeile = (name: string, z: { neu: number; geaendert: number }) =>
  `${name}: ${z.neu} neu, ${z.geaendert} geändert`;

export function Import() {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const dateiGewaehlt = async (datei: File | undefined) => {
    setPlan(null);
    setFehler(null);
    if (!datei) return;
    try {
      const blaetter = (await readXlsxFile(datei)) as Blatt[];
      setPlan(planeImport(blaetter, await ladeBestand()));
    } catch {
      setFehler('Die Datei konnte nicht gelesen werden. Bitte die Excel-Vorlage (.xlsx) verwenden.');
    }
  };

  return (
    <section>
      <Seitenkopf titel="Excel importieren" zurueck="/gleisanschluesse" />
      <p className="hinweis">
        Ausgefüllte Stammdaten-Vorlage auswählen. Bereits vorhandene Einträge werden anhand von Kürzel, Name bzw.
        Bezeichnung erkannt und aktualisiert, die Datei kann also mehrfach importiert werden.
      </p>
      <input
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => dateiGewaehlt(e.target.files?.[0])}
      />
      {fehler && <p className="fehler">{fehler}</p>}
      {plan && (
        <div className="karte">
          <h3>Vorschau</h3>
          <ul>
            <li>{zeile('Gleisanschlüsse', plan.zaehler.gleisanschluesse)}</li>
            <li>{zeile('Ansprechpartner', plan.zaehler.ansprechpartner)}</li>
            <li>{zeile('Infrastrukturelemente', plan.zaehler.elemente)}</li>
          </ul>
          {plan.hinweise.length > 0 && (
            <>
              <h4>Hinweise</h4>
              <ul className="hinweis">
                {plan.hinweise.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </>
          )}
          {plan.fehler.length > 0 && (
            <>
              <h4>Diese Zeilen werden übersprungen</h4>
              <ul className="fehler">
                {plan.fehler.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </>
          )}
          <button
            type="button"
            className="primaer"
            disabled={laeuft || plan.aenderungen.length === 0}
            onClick={async () => {
              setLaeuft(true);
              await fuehreImportAus(plan);
              navigate('/gleisanschluesse', { replace: true });
            }}
          >
            {plan.aenderungen.length === 0 ? 'Keine Änderungen' : `${plan.aenderungen.length} Einträge importieren`}
          </button>
        </div>
      )}
    </section>
  );
}
