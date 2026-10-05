import { describe, expect, it } from 'vitest';
import { MailFehler, graphKonfigurationAusUmgebung, graphMailer } from '../src/mail.js';

const konf = { tenantId: 'tenant', clientId: 'client', clientSecret: 'geheim', absender: 'absender@example.de' };

/** Nimmt alle Aufrufe auf und antwortet wie Microsoft (Token, Entwurf, Upload-Sitzung). */
function falscherAbruf(fehlerBei?: string) {
  const aufrufe: { url: string; methode: string; headers: Record<string, string>; body: unknown }[] = [];
  const abruf = (async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === 'string' ? (headers['content-type'] === 'application/json' ? JSON.parse(init.body) : init.body) : init.body;
    aufrufe.push({ url, methode: init.method ?? 'GET', headers, body });
    if (fehlerBei && url.includes(fehlerBei)) return new Response(JSON.stringify({ error: { message: 'Access is denied.' } }), { status: 403 });
    if (url.includes('/oauth2/v2.0/token')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    if (url.endsWith('/messages')) return Response.json({ id: 'msg1' }, { status: 201 });
    if (url.endsWith('/createUploadSession')) return Response.json({ uploadUrl: 'https://upload.example/abc' }, { status: 201 });
    if (url.endsWith('/send')) return new Response(null, { status: 202 });
    if (url.startsWith('https://upload.example')) return new Response(null, { status: 200 });
    return Response.json({}, { status: 201 });
  }) as typeof fetch;
  return { abruf, aufrufe };
}

describe('Mailversand über Microsoft Graph', () => {
  it('liest die Konfiguration nur, wenn alle Werte gesetzt sind', () => {
    expect(graphKonfigurationAusUmgebung({ MS_TENANT_ID: 't', MS_CLIENT_ID: 'c', MS_CLIENT_SECRET: 's' })).toBeNull();
    expect(graphKonfigurationAusUmgebung({ MS_TENANT_ID: 't', MS_CLIENT_ID: 'c', MS_CLIENT_SECRET: 's', MAIL_ABSENDER: 'a@b.de' })).toEqual({
      tenantId: 't', clientId: 'c', clientSecret: 's', absender: 'a@b.de',
    });
  });

  it('legt einen Entwurf an, hängt die PDF direkt an und sendet', async () => {
    const { abruf, aufrufe } = falscherAbruf();
    const mailer = graphMailer(konf, abruf);
    await mailer.sende({ an: ['x@example.de'], betreff: 'B', html: '<p>Hallo</p>', anhaenge: [{ name: 'a.pdf', inhalt: Buffer.from('%PDF-1'), typ: 'application/pdf' }] });

    expect(aufrufe.map((a) => `${a.methode} ${a.url}`)).toEqual([
      'POST https://login.microsoftonline.com/tenant/oauth2/v2.0/token',
      'POST https://graph.microsoft.com/v1.0/users/absender%40example.de/messages',
      'POST https://graph.microsoft.com/v1.0/users/absender%40example.de/messages/msg1/attachments',
      'POST https://graph.microsoft.com/v1.0/users/absender%40example.de/messages/msg1/send',
    ]);
    expect(aufrufe[1].headers.authorization).toBe('Bearer tok');
    expect(aufrufe[1].body).toMatchObject({ subject: 'B', toRecipients: [{ emailAddress: { address: 'x@example.de' } }] });
    expect(aufrufe[2].body).toMatchObject({ name: 'a.pdf', contentBytes: Buffer.from('%PDF-1').toString('base64') });

    // Das Token wird für die nächste Mail wiederverwendet.
    await mailer.sende({ an: ['x@example.de'], betreff: 'B', html: '', anhaenge: [] });
    expect(aufrufe.filter((a) => a.url.includes('oauth2')).length).toBe(1);
  });

  it('lädt große Anhänge in Stücken über eine Upload-Sitzung hoch', async () => {
    const { abruf, aufrufe } = falscherAbruf();
    const gross = Buffer.alloc(5 * 1024 * 1024, 1);
    await graphMailer(konf, abruf).sende({ an: ['x@example.de'], betreff: 'B', html: '', anhaenge: [{ name: 'gross.pdf', inhalt: gross, typ: 'application/pdf' }] });

    const uploads = aufrufe.filter((a) => a.url.startsWith('https://upload.example'));
    expect(uploads.length).toBe(4);
    expect(uploads[0].headers['content-range']).toBe(`bytes 0-${1310720 - 1}/${gross.length}`);
    expect(uploads.at(-1)!.headers['content-range']).toBe(`bytes ${3 * 1310720}-${gross.length - 1}/${gross.length}`);
    expect(uploads.every((u) => !u.headers.authorization)).toBe(true);
    expect(aufrufe.at(-1)!.url).toMatch(/\/send$/);
  });

  it('meldet Fehler von Microsoft verständlich', async () => {
    const { abruf } = falscherAbruf('/messages');
    await expect(graphMailer(konf, abruf).sende({ an: ['x@example.de'], betreff: 'B', html: '', anhaenge: [] })).rejects.toThrow(MailFehler);
    await expect(graphMailer(konf, abruf).sende({ an: ['x@example.de'], betreff: 'B', html: '', anhaenge: [] })).rejects.toThrow(/403.*Access is denied/);
  });
});
