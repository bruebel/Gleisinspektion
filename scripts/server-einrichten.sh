#!/usr/bin/env bash
# Ersteinrichtung eines frischen Ubuntu-24.04-vServers (z. B. STRATO VC4-8).
# Aufruf als root:   bash server-einrichten.sh <benutzername>
#
# Was passiert:
#  - System aktualisieren, automatische Sicherheitsupdates, fail2ban
#  - Benutzer mit sudo anlegen, SSH-Schlüssel von root übernehmen
#  - SSH härten: kein Root-Login, kein Passwort-Login (nur Schlüssel)
#  - Firewall: nur SSH, HTTP, HTTPS
#  - Docker Engine + Compose-Plugin (offizielles Docker-Repository)
#  - Docker-Netzwerk "proxy" für den gemeinsamen Webserver
set -euo pipefail

BENUTZER="${1:?Aufruf: bash server-einrichten.sh <benutzername>}"

if [[ $EUID -ne 0 ]]; then
  echo "Bitte als root ausführen." >&2
  exit 1
fi

if [[ ! -s /root/.ssh/authorized_keys ]]; then
  echo "Abbruch: /root/.ssh/authorized_keys ist leer. Ohne SSH-Schlüssel würdest du dich aussperren." >&2
  exit 1
fi

echo "==> System aktualisieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install ca-certificates curl gnupg ufw fail2ban unattended-upgrades git

echo "==> Automatische Sicherheitsupdates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Benutzer $BENUTZER anlegen"
if ! id "$BENUTZER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$BENUTZER"
fi
usermod -aG sudo "$BENUTZER"
install -d -m 700 -o "$BENUTZER" -g "$BENUTZER" "/home/$BENUTZER/.ssh"
install -m 600 -o "$BENUTZER" -g "$BENUTZER" /root/.ssh/authorized_keys "/home/$BENUTZER/.ssh/authorized_keys"
echo "Bitte ein Passwort für $BENUTZER festlegen (wird für sudo gebraucht):"
passwd "$BENUTZER"

echo "==> SSH härten"
cat > /etc/ssh/sshd_config.d/10-haertung.conf <<'CONF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
CONF
sshd -t
systemctl reload ssh

echo "==> Firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> Docker installieren"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker "$BENUTZER"
docker network inspect proxy &>/dev/null || docker network create proxy

# Hinweis: Docker veröffentlicht Ports an ufw vorbei. Deshalb veröffentlichen nur Caddy (80/443)
# Ports nach außen; Datenbank und API sind ausschließlich über interne Docker-Netzwerke erreichbar.

cat <<HINWEIS

Fertig.
WICHTIG: Bevor du diese Sitzung schließt, in einem ZWEITEN Terminal testen:
    ssh $BENUTZER@<IP-des-Servers>
Erst wenn das klappt, ist alles gut. Root-Login per SSH ist ab jetzt gesperrt.

Weiter geht es mit der Anleitung in docs/betrieb.md.
HINWEIS
