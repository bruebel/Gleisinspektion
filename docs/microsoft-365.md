# Mailversand über Microsoft 365 einrichten

Die App verschickt Begehungsberichte über Microsoft Graph aus **einem** festgelegten Postfach.
Die Mails erscheinen dort unter „Gesendete Elemente“. Auf dem Server liegt kein Postfach-Passwort,
nur ein App-Schlüssel, der ausschließlich aus diesem einen Postfach senden darf.

Benötigt: ein Konto mit den Rollen **Anwendungsadministrator** (Entra) und **Exchange-Administrator**
(oder globaler Administrator). Dauer: etwa 15 Minuten, danach bis zu 2 Stunden, bis Microsoft die
Berechtigung überall verteilt hat.

Im Folgenden steht `vorname.nachname@askeorail.de` für das Absender-Postfach.

## Teil A: App in Microsoft Entra registrieren

1. <https://entra.microsoft.com> öffnen → **Anwendungen → App-Registrierungen → Neue Registrierung**.
2. Ausfüllen:
   - Name: `Gleisinspektion`
   - Unterstützte Kontotypen: **Nur Konten in diesem Organisationsverzeichnis** (Einzelmandant)
   - Umleitungs-URI: Plattform **Web**, `https://inspektion.askeorail.de/api/auth/microsoft/callback`
     (wird erst für die spätere Anmeldung mit Microsoft-Konto gebraucht, schadet jetzt nicht)
   - **Registrieren** klicken.
3. Auf der Übersichtsseite notieren:
   - **Anwendungs-ID (Client)** → `MS_CLIENT_ID`
   - **Verzeichnis-ID (Mandant)** → `MS_TENANT_ID`
4. **Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel**
   - Beschreibung `Server`, Ablauf **24 Monate** → **Hinzufügen**
   - Sofort die Spalte **Wert** kopieren (nicht „Geheimnis-ID“; der Wert ist später nicht mehr sichtbar) → `MS_CLIENT_SECRET`
   - Ablaufdatum im Kalender eintragen: danach muss ein neuer Schlüssel erstellt und in die `.env` eingetragen werden.
5. **API-Berechtigungen:** hier **nichts** hinzufügen. Insbesondere **nicht** `Mail.Send` als
   Anwendungsberechtigung erteilen: Das würde der App erlauben, aus *jedem* Postfach der Firma zu senden.
   Die Berechtigung wird stattdessen in Teil B auf das eine Postfach beschränkt vergeben.
6. **Anwendungen → Unternehmensanwendungen** → `Gleisinspektion` öffnen und die **Objekt-ID** notieren.
   (Achtung: Das ist eine andere Objekt-ID als die auf der Seite der App-Registrierung.)

## Teil B: Senderecht auf das eine Postfach beschränken (Exchange Online)

In der PowerShell (Windows: „Windows PowerShell“ als normaler Benutzer öffnen):

```powershell
# einmalig: Modul installieren
Install-Module ExchangeOnlineManagement -Scope CurrentUser

Connect-ExchangeOnline

# App in Exchange bekannt machen
New-ServicePrincipal -AppId <MS_CLIENT_ID> -ObjectId <Objekt-ID aus A6> -DisplayName "Gleisinspektion"

# Bereich: nur das Absender-Postfach
New-ManagementScope -Name "Gleisinspektion Absender" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'vorname.nachname@askeorail.de'"

# Senderecht nur innerhalb dieses Bereichs
New-ManagementRoleAssignment -App <MS_CLIENT_ID> -Role "Application Mail.Send" -CustomResourceScope "Gleisinspektion Absender"

# Prüfen: InScope muss True sein
Test-ServicePrincipalAuthorization -Identity <MS_CLIENT_ID> -Resource vorname.nachname@askeorail.de
```

## Teil C: Server konfigurieren

In `/opt/gleisinspektion/deploy/app/.env` ergänzen:

```
MS_TENANT_ID=<Verzeichnis-ID>
MS_CLIENT_ID=<Anwendungs-ID>
MS_CLIENT_SECRET=<Wert des Schlüssels>
MAIL_ABSENDER=vorname.nachname@askeorail.de
```

Dann neu starten und prüfen:

```bash
cd /opt/gleisinspektion/deploy/app
docker compose up -d
docker compose logs api | grep Mailversand
# erwartet: „Mailversand über Microsoft 365 als vorname.nachname@askeorail.de“
```

## Teil D: Testen

In der App eine Begehung öffnen → **Bericht per Mail versenden** → nur die eigene Adresse unter
„Weitere Empfänger“ eintragen → senden. Die Mail kommt an und liegt zusätzlich in „Gesendete Elemente“.

## Fehlermeldungen

| Meldung in der App | Ursache |
|---|---|
| „Der Mailversand ist auf dem Server noch nicht eingerichtet.“ | Eine der vier Variablen fehlt in der `.env`, oder der Container wurde nicht neu gestartet. |
| „Anmeldung bei Microsoft fehlgeschlagen (401) … invalid_client“ | Schlüssel falsch kopiert (Geheimnis-ID statt Wert) oder abgelaufen → neuen Schlüssel erstellen (A4). |
| „… (403): Access is denied“ / „ErrorAccessDenied“ | Teil B fehlt, betrifft ein anderes Postfach als `MAIL_ABSENDER`, oder ist noch nicht verteilt (bis zu 2 Stunden warten). |
| „… (404) … ResourceNotFound / MailboxNotEnabledForRESTAPI“ | `MAIL_ABSENDER` ist kein Exchange-Online-Postfach oder falsch geschrieben. |
