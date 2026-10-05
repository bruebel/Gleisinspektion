import { useEffect, useState, useSyncExternalStore } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { abmelden, gespeicherteAnmeldung, type Benutzer } from './api';
import { db } from './db/lokal';
import { useOnline } from './useOnline';
import { starteAutoSync, synchronisiere, syncZustand } from './sync';
import { Anmelden } from './seiten/Anmelden';
import { AnsprechpartnerFormular } from './seiten/AnsprechpartnerFormular';
import { ElementFormular } from './seiten/ElementFormular';
import { FeststellungFormular } from './seiten/FeststellungFormular';
import { Gleisanschluesse } from './seiten/Gleisanschluesse';
import { GleisanschlussFormular } from './seiten/GleisanschlussFormular';
import { Import } from './seiten/Import';
import { InspektionDetail } from './seiten/InspektionDetail';
import { InspektionFormular } from './seiten/InspektionFormular';
import { Inspektionen } from './seiten/Inspektionen';

export function App() {
  const [benutzer, setBenutzer] = useState<Benutzer | null>(() => gespeicherteAnmeldung()?.benutzer ?? null);
  const online = useOnline();
  const location = useLocation();
  const ausstehend = useLiveQuery(() => db.outbox.count(), [], 0);
  const sync = useSyncExternalStore(syncZustand.abonnieren, syncZustand.lesen);
  useEffect(() => (benutzer ? starteAutoSync() : undefined), [benutzer]);

  if (!benutzer) return <Anmelden onAngemeldet={setBenutzer} />;

  return (
    <div className="app">
      <header className="kopf">
        <h1>Gleisinspektion</h1>
        <button
          type="button"
          className={`status ${!online ? 'offline' : sync.fehler ? 'warnung' : 'online'}`}
          onClick={() => online && void synchronisiere()}
          title={sync.fehler ?? (sync.letzterErfolg ? `Zuletzt abgeglichen: ${new Date(sync.letzterErfolg).toLocaleString('de-DE')}` : '')}
        >
          {!online ? 'Offline' : sync.laeuft ? 'Abgleich …' : sync.fehler ? 'Abgleich gestört' : 'Online'}
          {ausstehend > 0 && ` · ${ausstehend} offen`}
        </button>
      </header>

      {sync.fehler && online && !sync.laeuft && <p className="hinweisleiste">{sync.fehler}</p>}
      <main className="inhalt">
        <Routes>
          <Route path="/" element={<Inspektionen />} />
          <Route path="/inspektionen/neu" element={<InspektionFormular />} />
          <Route path="/inspektionen/:id" element={<InspektionDetail />} />
          <Route path="/inspektionen/:id/bearbeiten" element={<InspektionFormular />} />
          <Route path="/inspektionen/:id/feststellungen/:fid" element={<FeststellungFormular />} />
          <Route path="/gleisanschluesse" element={<Gleisanschluesse />} />
          <Route path="/gleisanschluesse/import" element={<Import />} />
          <Route path="/gleisanschluesse/:id" element={<GleisanschlussFormular />} />
          <Route path="/gleisanschluesse/:gaId/ansprechpartner/:id" element={<AnsprechpartnerFormular />} />
          <Route path="/gleisanschluesse/:gaId/elemente/:id" element={<ElementFormular />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="navigation">
        <NavLink to="/" end className={({ isActive }) => (isActive || location.pathname.startsWith('/inspektionen') ? 'active' : '')}>
          Inspektionen
        </NavLink>
        <NavLink to="/gleisanschluesse">Gleisanschlüsse</NavLink>
        <button
          type="button"
          onClick={async () => {
            if (ausstehend > 0 && !confirm(`${ausstehend} Änderungen sind noch nicht hochgeladen. Sie bleiben auf dem Gerät und werden nach der nächsten Anmeldung hochgeladen. Trotzdem abmelden?`)) return;
            await abmelden();
            setBenutzer(null);
          }}
        >
          Abmelden
        </button>
      </nav>
    </div>
  );
}
