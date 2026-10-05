# Gleisinspektion – Konzept (Entwurf v0.2, 05.10.2026)

**Entscheidungen (Benjamin, 05.10.2026):** Repository `bruebel/Gleisinspektion` · Server: Strato-vServer · zunächst nur ein Nutzer, später weitere Nutzer und Berichtsempfänger mit Zugang · zunächst nur Android

## 1. Ziel

Smartphone-App zur Dokumentation von Gleisrundgängen in Gleisanschlüssen (Anschlussbahnen):
Feststellungen mit Maßnahmenvorschlag, Frist, Zuständigkeit und Fotos erfassen – **offline im Gleis**,
Upload sobald wieder WLAN da ist, Bericht als PDF (später automatischer Versand).

## 2. Funktionsumfang

**Version 1 (MVP)**
- Stammdaten: Gleisanschlüsse mit Ansprechpartnern und vorkonfigurierten Infrastrukturelementen
  (Gleis, Weiche, Signal, markantes Bauwerk/Punkt, Sonstiges)
- Inspektion anlegen: Gleisanschluss, Datum, Uhrzeit von/bis, Durchführender, Bemerkung
- Feststellungen erfassen: Element auswählen (oder Freitext-Ort), Feststellung, Maßnahmenvorschlag,
  optional Frist, optional Zuständig, optional ein oder mehrere Fotos (Kamera direkt aus der App)
- Vollständig offline nutzbar, automatischer Upload bei Netz + manueller „Jetzt synchronisieren“-Knopf
- PDF-Bericht je Inspektion (Kopfdaten, Feststellungstabelle, Fotos mit Nummernbezug)

**Später**
- Automatischer PDF-Versand per E-Mail an definierten Empfängerkreis je Gleisanschluss
- Nachverfolgung: offene Mängel der letzten Inspektion beim nächsten Rundgang anzeigen und als „erledigt“ markieren
- Mehrbenutzer: weitere Inspektoren und **Berichtsempfänger mit eigenem Zugang**, die Maßnahmen ihres Gleisanschlusses sehen, kommentieren und als erledigt melden
- Optional: Priorität/Mangelklasse, GPS-Position am Foto

## 3. Datenmodell

```
Gleisanschluss 1───n Ansprechpartner
       │
       ├──1───n Infrastrukturelement
       │
       └──1───n Inspektion 1───n Feststellung 1───n Foto
                                     │
                                     └── n───1 Infrastrukturelement (optional)
```

| Entität | Felder |
|---|---|
| **Gleisanschluss** | id, Name, Firma/Betreiber, Adresse, Bemerkung, aktiv |
| **Ansprechpartner** | id, gleisanschlussId, Name, Funktion, Telefon, E-Mail, erhältBericht (ja/nein) |
| **Infrastrukturelement** | id, gleisanschlussId, Typ (Gleis/Weiche/Signal/Bauwerk/Sonstiges), Bezeichnung (z. B. „W 3“, „Gleis 2“), Beschreibung, aktiv |
| **Inspektion** | id, gleisanschlussId, Datum, Beginn, Ende, Durchführender, weitere Teilnehmer, Bemerkung, Status (Entwurf/abgeschlossen) |
| **Feststellung** | id, inspektionId, lfd. Nr., infrastrukturelementId (optional), Ort-Freitext (optional), Feststellung, Maßnahmenvorschlag, Frist (optional), Zuständig (optional, Freitext oder Ansprechpartner) |
| **Foto** | id, feststellungId, Datei, Aufnahmezeit, Reihenfolge |
| **Benutzer** | id, Name, E-Mail, Rolle (Admin / Inspektor / Empfänger), ansprechpartnerId (optional, für Empfänger) |
| **Zugriff** *(später)* | benutzerId, gleisanschlussId – Empfänger sehen nur „ihre“ Gleisanschlüsse |
| **Kommentar** *(später)* | id, feststellungId, benutzerId, Text, Zeitpunkt |

Feststellung erhält schon im MVP ein Feld **Status** (offen / in Bearbeitung / erledigt) mit `erledigtAm` und `erledigtVon`,
damit die spätere Bearbeitung durch Empfänger ohne Umbau möglich ist. Der Benutzer-Bezug wird von Anfang an angelegt,
im MVP gibt es aber nur einen Admin-Benutzer (dich).

Alle Datensätze tragen zusätzlich `erstelltAm`, `geaendertAm`, `geloescht` (Soft-Delete) und `syncStatus` (nur lokal).
IDs sind UUIDs, die **auf dem Gerät** erzeugt werden – so entstehen offline keine Konflikte.

## 4. Offline & Synchronisation

- **App-Shell im Cache** (Service Worker): App startet auch ohne Netz, einmal installiert („Zum Home-Bildschirm“).
- **Lokale Datenbank** auf dem Gerät (IndexedDB). Jede Änderung wird zuerst lokal gespeichert und in eine
  Warteschlange („Outbox“) gelegt.
- **Fotos** werden direkt beim Aufnehmen verkleinert (ca. 1600 px, JPEG ~80 %, ≈ 300–500 KB) und lokal abgelegt.
- **Upload**: sobald das Gerät online ist (beim App-Start, bei Netzwechsel, per Knopf). Erst Datensätze, dann Fotos;
  jedes Element einzeln, damit ein Abbruch nichts verliert. Status-Anzeige „x Einträge / y Fotos ausstehend“.
- **Download**: Stammdaten (Anschlüsse, Ansprechpartner, Elemente) werden beim Sync aufs Gerät geholt, damit sie im Gleis verfügbar sind.
- **Konflikte**: bei einem Hauptnutzer reicht „letzte Änderung gewinnt“ (pro Datensatz nach `geaendertAm`).
- **Android/Chrome**: Die App nutzt Hintergrund-Synchronisation, d. h. der Upload startet auch dann, wenn die App beim Erreichen des WLANs nicht offen ist.
  Die App fordert „dauerhaften Speicher“ an, damit Chrome lokale Daten nicht löscht. Lokale Daten werden erst nach bestätigtem Upload als „synchronisiert“ markiert.
  (iPhone später möglich, dort ohne Hintergrund-Sync.)

## 5. PDF-Export

- Inhalt: Kopf (Gleisanschluss, Ansprechpartner, Datum, Uhrzeit von–bis, Durchführender),
  Tabelle der Feststellungen (Nr., Element, Feststellung, Maßnahme, Frist, Zuständig),
  anschließend Fotoanhang (2–4 Fotos pro Seite, beschriftet mit Feststellungs-Nr.).
- Erzeugung **auf dem Server** (einheitliches Layout, große Fotomengen problemlos, Grundlage für den späteren Mailversand).
  Optional zusätzlich eine einfache Offline-PDF direkt auf dem Gerät, falls der Bericht schon vor Ort gebraucht wird.
- **Automatischer Versand (später)**: beim Abschließen einer Inspektion verschickt der Server die PDF per SMTP
  an alle Ansprechpartner mit „erhältBericht = ja“ plus feste Verteiler (z. B. eigenes Büro).

## 6. Technikvorschlag

| Baustein | Vorschlag | Begründung |
|---|---|---|
| App (Frontend) | Progressive Web App mit React + TypeScript + Vite, `vite-plugin-pwa` | Läuft auf Android und iPhone im Browser, installierbar, kein App-Store nötig |
| Lokale Daten | IndexedDB über Dexie.js | Bewährt für Offline-Daten inkl. Fotos |
| Server (API) | Node.js (TypeScript, z. B. Fastify) | Gleiche Sprache wie die App, schlank |
| Datenbank | PostgreSQL | Robust, Standard |
| Fotos | Dateisystem des Servers oder S3-kompatibler Speicher | Einfach zu sichern |
| PDF | serverseitig (HTML-Vorlage → PDF via Headless-Chromium oder Typst) | Saubere Layouts mit Fotos |
| Anmeldung | Benutzer + Passwort (bzw. Login-Link per Mail), Sitzung bleibt offline gültig | Kein Login im Gleis nötig |
| Betrieb | Docker Compose (App, API, Datenbank) + Caddy als Webserver mit automatischem HTTPS (Let's Encrypt) | Läuft auf dem Strato-vServer, HTTPS ist für PWA/Kamera Pflicht |

### Wo die Daten gespeichert werden

**Entschieden: Strato-vServer** (Rechenzentrum Deutschland). Darauf laufen per Docker Compose: Caddy (HTTPS), API, PostgreSQL;
Fotos im Dateisystem des Servers. Voraussetzungen: Linux-vServer mit Root-Zugang (z. B. Ubuntu 24.04), mind. 2 GB RAM,
eine (Sub-)Domain, die auf den Server zeigt (z. B. `inspektion.deine-domain.de`). Tägliches Backup von Datenbank und Fotos
(z. B. per `pg_dump` + Kopie auf Strato-HiDrive oder einen zweiten Speicherort).

## 7. Vorgehen

1. Repository anlegen, Grundgerüst (PWA + API + Docker Compose)
2. Stammdatenverwaltung (Gleisanschlüsse, Ansprechpartner, Elemente)
3. Inspektion + Feststellungen + Fotos offline erfassen
4. Synchronisation
5. PDF-Export
6. Testlauf im Gleis, danach Mailversand und Nachverfolgung

## 8. Offene Fragen

- Domain/Subdomain für die App vorhanden?
- Betriebssystem und Größe des Strato-vServers (Root-Zugang)?
