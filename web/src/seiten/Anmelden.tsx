import { useState, type FormEvent } from 'react';
import { anmelden, type Benutzer } from '../api';
import logo from '../marke/askeorail-logo.svg';

export function Anmelden({ onAngemeldet }: { onAngemeldet: (b: Benutzer) => void }) {
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);

  const absenden = async (e: FormEvent) => {
    e.preventDefault();
    setFehler(null);
    setLaedt(true);
    try {
      onAngemeldet(await anmelden(email, passwort));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
    } finally {
      setLaedt(false);
    }
  };

  return (
    <form className="anmelden" onSubmit={absenden}>
      <h1>
        <img src={logo} alt="AskeoRail" />
        Gleisinspektion
      </h1>
      <p className="hinweis">Einmal mit Netz anmelden – danach funktioniert die App auch offline.</p>
      <label>
        E-Mail
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Passwort
        <input
          type="password"
          autoComplete="current-password"
          value={passwort}
          onChange={(e) => setPasswort(e.target.value)}
          required
        />
      </label>
      {fehler && <p className="fehler">{fehler}</p>}
      <button type="submit" className="primaer" disabled={laedt}>
        {laedt ? 'Anmelden …' : 'Anmelden'}
      </button>
    </form>
  );
}
