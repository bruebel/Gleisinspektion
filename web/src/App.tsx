import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { abmelden, gespeicherteAnmeldung, type Benutzer } from './api';
import { db } from './db/lokal';
import { useOnline } from './useOnline';
import { Anmelden } from './seiten/Anmelden';
import { Gleisanschluesse } from './seiten/Gleisanschluesse';
import { Inspektionen } from './seiten/Inspektionen';

export function App() {
  const [benutzer, setBenutzer] = useState<Benutzer | null>(() => gespeicherteAnmeldung()?.benutzer ?? null);
  const online = useOnline();
  const ausstehend = useLiveQuery(() => db.outbox.count(), [], 0);

  if (!benutzer) return <Anmelden onAngemeldet={setBenutzer} />;

  return (
    <div className="app">
      <header className="kopf">
        <h1>Gleisinspektion</h1>
        <span className={online ? 'status online' : 'status offline'}>
          {online ? 'Online' : 'Offline'}
          {ausstehend > 0 && ` · ${ausstehend} ausstehend`}
        </span>
      </header>

      <main className="inhalt">
        <Routes>
          <Route path="/" element={<Inspektionen />} />
          <Route path="/gleisanschluesse" element={<Gleisanschluesse />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="navigation">
        <NavLink to="/" end>
          Inspektionen
        </NavLink>
        <NavLink to="/gleisanschluesse">Gleisanschlüsse</NavLink>
        <button
          type="button"
          onClick={async () => {
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
