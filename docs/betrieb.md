# Betrieb auf dem vServer

Ziel: Die App läuft auf dem STRATO-vServer (Ubuntu 24.04) unter **https://inspektion.askeorail.de**.
Alle Dienste laufen als Docker-Container; ein gemeinsamer Caddy-Webserver kümmert sich um HTTPS und
verteilt die Subdomains, sodass später weitere Anwendungen (z. B. n8n) daneben laufen können.

## 1. DNS

Beim Domain-Anbieter von `askeorail.de` einen **A-Record** anlegen:

| Name | Typ | Wert |
|---|---|---|
| `inspektion` | A | IPv4-Adresse des vServers |

Optional zusätzlich einen AAAA-Record mit der IPv6-Adresse. Prüfen mit `nslookup inspektion.askeorail.de`.

## 2. Server einrichten (einmalig)

Als root per SSH anmelden und das Einrichtungsskript ausführen (`benjamin` durch den gewünschten Benutzernamen ersetzen):

```bash
ssh root@<IP-des-Servers>
curl -fsSLO https://raw.githubusercontent.com/bruebel/Gleisinspektion/main/scripts/server-einrichten.sh
less server-einrichten.sh          # kurz durchsehen
bash server-einrichten.sh benjamin
```

Das Skript aktualisiert das System, legt den Benutzer an, sperrt Root- und Passwort-Login per SSH,
richtet die Firewall (nur 22, 80, 443) und Docker ein.
**Vor dem Schließen der root-Sitzung in einem zweiten Terminal `ssh benjamin@<IP>` testen.**

> Das Repository ist privat? Dann statt `curl` den Inhalt des Skripts per Copy & Paste auf den Server bringen,
> oder zuerst Schritt 3 (Deploy-Key) erledigen und das Repository klonen.

## 3. Repository auf den Server holen

Ab jetzt als normaler Benutzer arbeiten:

```bash
ssh benjamin@<IP-des-Servers>
sudo mkdir -p /opt/gleisinspektion && sudo chown $USER: /opt/gleisinspektion
git clone https://github.com/bruebel/Gleisinspektion.git /opt/gleisinspektion
```

Bei einem privaten Repository einen **Deploy-Key** verwenden: `ssh-keygen -t ed25519 -f ~/.ssh/gleisinspektion_deploy`,
den Inhalt der `.pub`-Datei auf GitHub unter *Settings → Deploy keys* (nur Lesezugriff) eintragen und mit
`GIT_SSH_COMMAND="ssh -i ~/.ssh/gleisinspektion_deploy" git clone git@github.com:bruebel/Gleisinspektion.git /opt/gleisinspektion` klonen.

## 4. Gemeinsamen Webserver starten

```bash
cd /opt/gleisinspektion/deploy/proxy
cp .env.example .env && nano .env      # ACME_EMAIL eintragen
docker compose up -d
```

## 5. Gleisinspektion starten

```bash
cd /opt/gleisinspektion/deploy/app
cp .env.example .env
nano .env    # POSTGRES_PASSWORD (z. B. aus: openssl rand -hex 32), ADMIN_EMAIL, ADMIN_PASSWORT
docker compose up -d --build
docker compose logs -f api             # „Admin-Benutzer … angelegt“ und „Server listening“
```

Danach https://inspektion.askeorail.de auf dem Smartphone in Chrome öffnen, anmelden und über das Menü
**„Zum Startbildschirm hinzufügen“** installieren. `ADMIN_PASSWORT` anschließend aus der `.env` löschen.

Mailversand der Berichte über Microsoft 365 (optional): siehe [microsoft-365.md](microsoft-365.md).

## 6. Aktualisieren

```bash
cd /opt/gleisinspektion && git pull
cd deploy/app && docker compose up -d --build
```

Datenbank-Migrationen laufen beim Start der API automatisch.

## 7. Sicherung

`scripts/backup.sh` sichert Datenbank und Fotos nach `/var/backups/gleisinspektion` und behält 14 Tage.
Einrichten mit `sudo crontab -e`:

```
15 2 * * *  /opt/gleisinspektion/scripts/backup.sh >> /var/log/gleisinspektion-backup.log 2>&1
```

Die Sicherung liegt damit noch auf demselben Server. Für echten Schutz die Dateien zusätzlich
an einen zweiten Ort kopieren (z. B. STRATO HiDrive per `rsync`).
