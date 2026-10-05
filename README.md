# Gleisinspektion

App zur Dokumentation von Gleisrundgängen in Gleisanschlüssen (Anschlussbahnen).
Feststellungen mit Maßnahmenvorschlag, Frist, Zuständigkeit und Fotos werden **offline** auf dem Smartphone erfasst
und hochgeladen, sobald wieder Netz da ist. Berichte werden als PDF exportiert.

Konzept und Datenmodell: [docs/konzept.md](docs/konzept.md) · Betrieb auf dem Server: [docs/betrieb.md](docs/betrieb.md)

## Aufbau

| Ordner | Inhalt |
|---|---|
| `web/` | Progressive Web App (React, TypeScript, Vite). Lokale Datenbank auf dem Gerät mit Dexie (IndexedDB). |
| `api/` | Server (Fastify, TypeScript) mit PostgreSQL über Drizzle ORM. |
| `deploy/proxy/` | Gemeinsamer Webserver Caddy mit automatischem HTTPS für alle Dienste auf dem vServer. |
| `deploy/app/` | Docker Compose für Datenbank, API und Web-App. |
| `scripts/` | Ersteinrichtung des vServers und tägliche Sicherung. |

## Entwicklung

Voraussetzungen: Node.js 22, Docker.

```bash
npm install

# Datenbank lokal starten
docker run -d --name gleisinspektion-db -p 5432:5432 \
  -e POSTGRES_DB=gleisinspektion -e POSTGRES_USER=gleisinspektion -e POSTGRES_PASSWORD=entwicklung \
  postgres:17-alpine

# API (legt beim ersten Start den Admin an)
DATABASE_URL=postgres://gleisinspektion:entwicklung@localhost:5432/gleisinspektion \
ADMIN_EMAIL=admin@example.de ADMIN_PASSWORT=admin \
npm run dev:api

# Web-App in einem zweiten Terminal (leitet /api an localhost:3000 weiter)
npm run dev:web
```

Prüfen: `npm run typecheck`, `npm test`, `npm run build`.

Datenbankschema ändern: `api/src/schema.ts` anpassen, dann `npm run db:generate -w api`.
Die erzeugte Migration in `api/drizzle/` mit einchecken; sie wird beim Start der API automatisch ausgeführt.

## Stand

- [x] Grundgerüst: App-Shell offline-fähig, Anmeldung, Datenmodell, Docker-Betrieb
- [x] Stammdaten (Gleisanschlüsse, Ansprechpartner, Infrastrukturelemente) inkl. Excel-Import
- [x] Inspektion und Feststellungen mit Fotos offline erfassen (vorerst nur auf dem Gerät gespeichert)
- [ ] Synchronisation Gerät ↔ Server
- [ ] PDF-Bericht
- [ ] Automatischer Versand, Nachverfolgung, weitere Benutzer
