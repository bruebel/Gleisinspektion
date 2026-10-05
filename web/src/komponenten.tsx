import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import type { ElementTyp } from './db/lokal';

export const TYP_NAMEN: Record<ElementTyp, string> = {
  gleis: 'Gleis',
  weiche: 'Weiche',
  signal: 'Signal',
  bauwerk: 'Bauwerk / markanter Punkt',
  sonstiges: 'Sonstiges',
};
/** Auswahl für die Art der Prüfung einer Begehung. */
export const PRUEFARTEN = ['Regelbegehung', 'Sonderbegehung', 'Abnahmeprüfung', 'Nachkontrolle Mängelbeseitigung'];

export const TYP_REIHENFOLGE = Object.keys(TYP_NAMEN) as ElementTyp[];

const datumFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
/** Datum „JJJJ-MM-TT“ ohne Zeitzonenverschiebung formatieren. */
export const datum = (iso?: string | null) => {
  if (!iso) return '';
  const [j, m, t] = iso.split('-').map(Number);
  return datumFormat.format(new Date(j, m - 1, t));
};

export const heute = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const jetztUhrzeit = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Leere Eingaben als null speichern. */
export const leerZuNull = (s: string) => (s.trim() === '' ? null : s.trim());

export function Seitenkopf({ titel, zurueck, children }: { titel: string; zurueck?: string; children?: ReactNode }) {
  return (
    <div className="seitenkopf">
      {zurueck && (
        <Link to={zurueck} className="zurueck" aria-label="Zurück">
          ‹
        </Link>
      )}
      <h2>{titel}</h2>
      {children}
    </div>
  );
}

export function Feld({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label>
      {label}
      <input {...props} />
    </label>
  );
}

export function Textfeld({ label, ...props }: { label: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label>
      {label}
      <textarea rows={3} {...props} />
    </label>
  );
}

export function Leer({ children }: { children: ReactNode }) {
  return <p className="leer">{children}</p>;
}
