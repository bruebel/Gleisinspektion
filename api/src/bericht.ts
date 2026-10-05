import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { and, asc, eq, inArray } from 'drizzle-orm';
import pdfmake from 'pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import type { Db } from './db.js';
import { LOGO_SVG } from './marke.js';
import * as s from './schema.js';

// PDF-Bericht einer Begehung (intern: Inspektion): Kopfdaten, Ansprechpartner, Tabelle der Feststellungen und Fotoanhang.

// Schrift wie in der App: Hanken Grotesk (frei, ähnlich der Lab Grotesque von askeorail.de).
const schriften = join(dirname(createRequire(import.meta.url).resolve('@fontsource/hanken-grotesk/package.json')), 'files');
const schrift = (schnitt: string) => join(schriften, `hanken-grotesk-latin-${schnitt}.woff`);
pdfmake.addFonts({
  Hanken: {
    normal: schrift('400-normal'),
    bold: schrift('600-normal'),
    italics: schrift('400-italic'),
    bolditalics: schrift('600-italic'),
  },
});
// Bilder werden nur als Daten übergeben; außer den Schriften darf das Dokument keine Dateien oder URLs laden.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((pfad) => pfad.startsWith(schriften));

// Hausfarben von askeorail.de
const BLAU = '#23566c';
const GELB = '#ffec00';
const GRAU = '#5a6468';
const FIRMA = 'askeo rail GmbH · August-Horch-Str. 18 · 55129 Mainz · +49 6131 27675-20 · info@askeorail.de';
const TYP_NAMEN = { gleis: 'Gleis', weiche: 'Weiche', signal: 'Signal', bauwerk: 'Bauwerk', sonstiges: '' } as const;
const BILDFORMATE = new Set(['image/jpeg', 'image/png']);

/** „JJJJ-MM-TT“ → „TT.MM.JJJJ“ */
export const datumDe = (iso?: string | null) => (iso ? iso.split('-').reverse().join('.') : '');
const uhrzeit = (t?: string | null) => (t ? t.slice(0, 5) : '');

export async function erstelleBericht(db: Db, inspektionId: string, fotoOrdner: string) {
  const [inspektion] = await db
    .select()
    .from(s.inspektion)
    .where(and(eq(s.inspektion.id, inspektionId), eq(s.inspektion.geloescht, false)));
  if (!inspektion) return null;

  const [anschluss] = await db.select().from(s.gleisanschluss).where(eq(s.gleisanschluss.id, inspektion.gleisanschlussId));
  const ansprechpartner = await db
    .select()
    .from(s.ansprechpartner)
    .where(and(eq(s.ansprechpartner.gleisanschlussId, inspektion.gleisanschlussId), eq(s.ansprechpartner.geloescht, false)))
    .orderBy(asc(s.ansprechpartner.name));
  const feststellungen = await db
    .select()
    .from(s.feststellung)
    .where(and(eq(s.feststellung.inspektionId, inspektionId), eq(s.feststellung.geloescht, false)))
    .orderBy(asc(s.feststellung.lfdNr));
  const elemente = await db
    .select()
    .from(s.infrastrukturelement)
    .where(eq(s.infrastrukturelement.gleisanschlussId, inspektion.gleisanschlussId));
  const fotos = feststellungen.length
    ? await db
        .select()
        .from(s.foto)
        .where(and(inArray(s.foto.feststellungId, feststellungen.map((f) => f.id)), eq(s.foto.geloescht, false)))
        .orderBy(asc(s.foto.reihenfolge))
    : [];

  const ortVon = (f: (typeof feststellungen)[number]) => {
    const e = elemente.find((x) => x.id === f.infrastrukturelementId);
    return [e && `${TYP_NAMEN[e.typ]} ${e.bezeichnung}`.trim(), f.ort].filter(Boolean).join('\n') || '–';
  };

  const zeitraum = [uhrzeit(inspektion.beginn), uhrzeit(inspektion.ende)].filter(Boolean).join(' – ');
  const kopf: [string, string][] = [
    ['Gleisanschluss', [anschluss?.name, anschluss?.kuerzel && `(${anschluss.kuerzel})`].filter(Boolean).join(' ')],
    ['Betreiber', anschluss?.firma ?? ''],
    ['Adresse', anschluss?.adresse ?? ''],
    ['Art der Prüfung', inspektion.art ?? ''],
    ['Datum', datumDe(inspektion.datum)],
    ['Zeitraum', zeitraum ? `${zeitraum} Uhr` : ''],
    ['Durchführender', inspektion.durchfuehrender],
    ['Weitere Teilnehmer', inspektion.teilnehmer ?? ''],
  ];

  const inhalt: Content[] = [
    {
      columns: [
        { text: 'Begehungsbericht', style: 'titel' },
        { svg: LOGO_SVG, width: 130, alignment: 'right' },
      ],
    },
    { canvas: [{ type: 'rect', x: 0, y: 0, w: 60, h: 4, color: GELB }], margin: [0, 0, 0, 14] },
    {
      table: {
        widths: [110, '*'],
        body: kopf.filter(([, w]) => w).map(([k, w]) => [{ text: k, style: 'etikett' }, w]),
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 8],
    },
  ];
  if (inspektion.bemerkung) inhalt.push({ text: inspektion.bemerkung, italics: true, margin: [0, 0, 0, 8] });

  if (ansprechpartner.length) {
    inhalt.push({ text: 'Ansprechpartner', style: 'ueberschrift' });
    inhalt.push({
      table: {
        headerRows: 1,
        widths: ['*', '*', 'auto', '*'],
        body: [
          ['Name', 'Funktion', 'Telefon', 'E-Mail'].map((t) => ({ text: t, style: 'tabellenkopf' })),
          ...ansprechpartner.map((a) => [a.name, a.funktion ?? '', a.telefon ?? '', a.email ?? '']),
        ],
      },
      layout: 'lightHorizontalLines',
      fontSize: 9,
    });
  }

  inhalt.push({ text: `Feststellungen (${feststellungen.length})`, style: 'ueberschrift' });
  if (feststellungen.length === 0) {
    inhalt.push({ text: 'Bei der Begehung wurden keine Mängel festgestellt.' });
  } else {
    inhalt.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [18, 70, '*', '*', 52, 62],
        body: [
          ['Nr.', 'Element / Ort', 'Feststellung', 'Maßnahmenvorschlag', 'Frist', 'Zuständig'].map((t) => ({
            text: t,
            style: 'tabellenkopf',
          })),
          ...feststellungen.map((f) => {
            const anzahl = fotos.filter((x) => x.feststellungId === f.id).length;
            return [
              { text: String(f.lfdNr), bold: true },
              ortVon(f),
              anzahl ? { stack: [f.feststellung, { text: `${anzahl} Foto${anzahl > 1 ? 's' : ''}`, color: GRAU, fontSize: 8 }] } : f.feststellung,
              f.massnahme,
              datumDe(f.frist),
              f.zustaendig ?? '',
            ];
          }),
        ],
      },
      layout: 'lightHorizontalLines',
      fontSize: 9,
    });
  }

  // Fotoanhang: zwei Fotos nebeneinander, beschriftet mit der Feststellungsnummer.
  const fotoKaesten: Content[] = [];
  for (const f of feststellungen) {
    const eigene = fotos.filter((x) => x.feststellungId === f.id);
    for (const [i, foto] of eigene.entries()) {
      const beschriftung = `Nr. ${f.lfdNr}${eigene.length > 1 ? ` – Foto ${i + 1}` : ''}: ${ortVon(f).replace('\n', ', ')}`;
      let bild: Content;
      const daten = foto.dateiVorhanden && BILDFORMATE.has(foto.mimeTyp)
        ? await readFile(join(fotoOrdner, foto.id)).catch(() => null)
        : null;
      if (daten) {
        bild = { image: `data:${foto.mimeTyp};base64,${daten.toString('base64')}`, fit: [250, 200], alignment: 'center' };
      } else {
        bild = {
          text: foto.dateiVorhanden ? 'Bildformat nicht darstellbar' : 'Foto noch nicht hochgeladen',
          color: GRAU,
          alignment: 'center',
          margin: [0, 90, 0, 90],
        };
      }
      fotoKaesten.push({ stack: [bild, { text: beschriftung, style: 'beschriftung' }], unbreakable: true });
    }
  }
  if (fotoKaesten.length) {
    inhalt.push({ text: 'Fotos', style: 'ueberschrift', pageBreak: 'before' });
    for (let i = 0; i < fotoKaesten.length; i += 2) {
      inhalt.push({
        columns: [fotoKaesten[i], fotoKaesten[i + 1] ?? { text: '' }],
        columnGap: 15,
        margin: [0, 0, 0, 15],
        unbreakable: true,
      });
    }
  }

  const erstellt = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });
  const definition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 50, 40, 50],
    info: { title: `${inspektion.art ?? 'Begehung'} ${anschluss?.name ?? ''} ${datumDe(inspektion.datum)}`, author: inspektion.durchfuehrender },
    defaultStyle: { font: 'Hanken', fontSize: 10, lineHeight: 1.2 },
    styles: {
      titel: { fontSize: 18, bold: true, color: BLAU, margin: [0, 8, 0, 8] },
      ueberschrift: { fontSize: 13, bold: true, color: BLAU, margin: [0, 14, 0, 6] },
      etikett: { color: GRAU },
      tabellenkopf: { bold: true, color: BLAU },
      beschriftung: { fontSize: 8, color: GRAU, margin: [0, 4, 0, 0] },
    },
    header: (seite) =>
      seite > 1
        ? { text: `${anschluss?.name ?? ''} · ${datumDe(inspektion.datum)}`, fontSize: 8, color: GRAU, margin: [40, 25, 40, 0] }
        : null,
    footer: (seite, seiten) => ({
      stack: [
        { text: FIRMA, fontSize: 7, color: BLAU, margin: [0, 0, 0, 2] },
        {
          columns: [
            { text: `Erstellt am ${erstellt}`, fontSize: 8, color: GRAU },
            { text: `Seite ${seite} von ${seiten}`, fontSize: 8, color: GRAU, alignment: 'right' },
          ],
        },
      ],
      margin: [40, 10, 40, 0],
    }),
    content: inhalt,
  };

  const pdf = await pdfmake.createPdf(definition).getBuffer();
  const name = (anschluss?.kuerzel || anschluss?.name || 'Begehung').replace(/[^\p{L}\p{N}-]+/gu, '_');
  return { pdf, dateiname: `Begehung_${name}_${inspektion.datum}.pdf` };
}
