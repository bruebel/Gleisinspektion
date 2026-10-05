// Mailversand über Microsoft Graph (Microsoft 365) mit App-Anmeldung (Client Credentials).
// Die Mail landet im Ordner „Gesendete Elemente“ des Absender-Postfachs.
// Einrichtung in Microsoft Entra und Exchange: docs/microsoft-365.md

export interface Anhang {
  name: string;
  inhalt: Buffer;
  typ: string;
}

export interface Mail {
  an: string[];
  betreff: string;
  html: string;
  anhaenge: Anhang[];
}

export interface Mailer {
  absender: string;
  sende(mail: Mail): Promise<void>;
}

export interface GraphKonfiguration {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  absender: string;
}

type Abruf = typeof fetch;

// Graph nimmt Anhänge bis 3 MB direkt an, größere nur über eine Upload-Sitzung in Stücken.
const DIREKT_GRENZE = 3 * 1024 * 1024;
const STUECK = 4 * 320 * 1024; // muss ein Vielfaches von 320 KiB sein

export class MailFehler extends Error {}

export function graphKonfigurationAusUmgebung(env = process.env): GraphKonfiguration | null {
  const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_ABSENDER } = env;
  if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET || !MAIL_ABSENDER) return null;
  return { tenantId: MS_TENANT_ID, clientId: MS_CLIENT_ID, clientSecret: MS_CLIENT_SECRET, absender: MAIL_ABSENDER };
}

export function graphMailer(konf: GraphKonfiguration, abruf: Abruf = fetch): Mailer {
  let token: { wert: string; gueltigBis: number } | null = null;

  const holeToken = async () => {
    if (token && token.gueltigBis > Date.now() + 60_000) return token.wert;
    const res = await abruf(`https://login.microsoftonline.com/${encodeURIComponent(konf.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: konf.clientId,
        client_secret: konf.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    });
    if (!res.ok) throw new MailFehler(`Anmeldung bei Microsoft fehlgeschlagen (${res.status}): ${await fehlertext(res)}`);
    const daten = (await res.json()) as { access_token: string; expires_in: number };
    token = { wert: daten.access_token, gueltigBis: Date.now() + daten.expires_in * 1000 };
    return token.wert;
  };

  const graph = async (methode: string, pfad: string, body?: unknown) => {
    const res = await abruf(`https://graph.microsoft.com/v1.0${pfad}`, {
      method: methode,
      headers: { authorization: `Bearer ${await holeToken()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new MailFehler(`Microsoft Graph ${methode} ${pfad} fehlgeschlagen (${res.status}): ${await fehlertext(res)}`);
    return res.status === 202 || res.status === 204 ? null : ((await res.json()) as Record<string, unknown>);
  };

  const postfach = `/users/${encodeURIComponent(konf.absender)}`;

  return {
    absender: konf.absender,
    async sende(mail) {
      // Entwurf anlegen, Anhänge anhängen, dann senden: funktioniert auch für große PDFs mit vielen Fotos.
      const entwurf = await graph('POST', `${postfach}/messages`, {
        subject: mail.betreff,
        body: { contentType: 'HTML', content: mail.html },
        toRecipients: mail.an.map((address) => ({ emailAddress: { address } })),
      });
      const id = encodeURIComponent(String(entwurf!.id));
      for (const anhang of mail.anhaenge) {
        if (anhang.inhalt.length <= DIREKT_GRENZE) {
          await graph('POST', `${postfach}/messages/${id}/attachments`, {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: anhang.name,
            contentType: anhang.typ,
            contentBytes: anhang.inhalt.toString('base64'),
          });
          continue;
        }
        const sitzung = await graph('POST', `${postfach}/messages/${id}/attachments/createUploadSession`, {
          AttachmentItem: { attachmentType: 'file', name: anhang.name, size: anhang.inhalt.length, contentType: anhang.typ },
        });
        const uploadUrl = String(sitzung!.uploadUrl);
        const gesamt = anhang.inhalt.length;
        for (let start = 0; start < gesamt; start += STUECK) {
          const stueck = anhang.inhalt.subarray(start, Math.min(start + STUECK, gesamt));
          // Die Upload-URL ist selbst signiert und darf keinen Authorization-Header bekommen.
          const res = await abruf(uploadUrl, {
            method: 'PUT',
            headers: {
              'content-length': String(stueck.length),
              'content-range': `bytes ${start}-${start + stueck.length - 1}/${gesamt}`,
              'content-type': 'application/octet-stream',
            },
            body: new Uint8Array(stueck),
          });
          if (!res.ok) throw new MailFehler(`Upload des Anhangs fehlgeschlagen (${res.status}): ${await fehlertext(res)}`);
        }
      }
      await graph('POST', `${postfach}/messages/${id}/send`);
    },
  };
}

async function fehlertext(res: Response) {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string };
    return (typeof json.error === 'object' ? json.error.message : json.error_description ?? json.error) ?? text;
  } catch {
    return text.slice(0, 300);
  }
}
