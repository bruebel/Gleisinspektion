export interface Benutzer {
  id: string;
  name: string;
  email: string;
  rolle: 'admin' | 'inspektor' | 'empfaenger';
}

const TOKEN = 'gleisinspektion.token';
const BENUTZER = 'gleisinspektion.benutzer';

// Token und Benutzer bleiben auf dem Gerät gespeichert, damit die App auch ohne Netz startet.
export function gespeicherteAnmeldung(): { token: string; benutzer: Benutzer } | null {
  try {
    const token = localStorage.getItem(TOKEN);
    const benutzer = localStorage.getItem(BENUTZER);
    return token && benutzer ? { token, benutzer: JSON.parse(benutzer) } : null;
  } catch {
    return null;
  }
}

export async function anmelden(email: string, passwort: string): Promise<Benutzer> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, passwort }),
  });
  if (res.status === 401) throw new Error('E-Mail oder Passwort falsch');
  if (!res.ok) throw new Error('Anmeldung fehlgeschlagen. Bist du online?');
  const { token, benutzer } = (await res.json()) as { token: string; benutzer: Benutzer };
  localStorage.setItem(TOKEN, token);
  localStorage.setItem(BENUTZER, JSON.stringify(benutzer));
  return benutzer;
}

export async function abmelden(): Promise<void> {
  const token = localStorage.getItem(TOKEN);
  localStorage.removeItem(TOKEN);
  localStorage.removeItem(BENUTZER);
  if (token) {
    await fetch('/api/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(
      () => undefined,
    );
  }
}
