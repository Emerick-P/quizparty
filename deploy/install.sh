#!/usr/bin/env bash
# Installe QuizParty sur une VM Ubuntu (Oracle Cloud Always Free, ARM ou x86).
# À lancer depuis le dossier cloné :   sudo bash deploy/install.sh [nom-de-domaine]
#
# - Sans nom de domaine, le site est servi sur <ip>.sslip.io (adresse gratuite qui pointe
#   vers l'IP de la VM), en HTTPS. Avec un domaine, relance simplement le script avec ce domaine.
# - Le script peut être relancé sans risque : il ne refait que ce qui manque.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Lance-le avec sudo : sudo bash deploy/install.sh"; exit 1; }
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${SUDO_USER:-$(stat -c %U "$APP_DIR")}"
PORT=3000
NODE_MAJOR=22

step() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  IP="$(curl -fsS4 https://ifconfig.me || curl -fsS4 https://api.ipify.org)"
  DOMAIN="${IP//./-}.sslip.io"
fi

step "Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git iptables-persistent debian-keyring debian-archive-keyring apt-transport-https >/dev/null

step "Node.js $NODE_MAJOR"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

step "Caddy (HTTPS automatique)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
caddy version

step "Pare-feu de la VM : ports 80 et 443"
# Les images Ubuntu d'Oracle bloquent tout sauf SSH dans iptables.
for p in 80 443; do
  iptables -C INPUT -p tcp -m state --state NEW --dport "$p" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 1 -p tcp -m state --state NEW --dport "$p" -j ACCEPT
done
netfilter-persistent save >/dev/null

step "Dépendances de l'application"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund"

step "Fichier .env (secrets, jamais dans Git)"
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  read -r -p "Code d'accès pour tes amis (vide = site ouvert à tous) : " ACCESS_CODE </dev/tty
  read -r -p "TWITCH_CLIENT_ID (vide = modes Jaquette grisés) : " TW_ID </dev/tty
  read -r -s -p "TWITCH_CLIENT_SECRET : " TW_SECRET </dev/tty; echo
  cat > "$ENV_FILE" <<EOF
PORT=$PORT
HOST=127.0.0.1
TRUST_PROXY=1
ACCESS_CODE=$ACCESS_CODE
TWITCH_CLIENT_ID=$TW_ID
TWITCH_CLIENT_SECRET=$TW_SECRET
EOF
  chown "$APP_USER": "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  echo ".env déjà présent, conservé ($ENV_FILE)"
fi

step "Service QuizParty (démarre tout seul, redémarre en cas de plantage)"
cat > /etc/systemd/system/quizparty.service <<EOF
[Unit]
Description=QuizParty
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=2
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
# Permet à update.sh de redémarrer le service sans mot de passe
echo "$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart quizparty, /usr/bin/systemctl status quizparty" > /etc/sudoers.d/quizparty
chmod 440 /etc/sudoers.d/quizparty
systemctl daemon-reload
systemctl enable --now quizparty
systemctl restart quizparty

step "Caddy : https://$DOMAIN -> Node"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
systemctl enable caddy >/dev/null
systemctl reload caddy || systemctl restart caddy

step "Vérification"
sleep 3
if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null; then echo "Node répond."; else echo "Node ne répond pas : sudo journalctl -u quizparty -n 50"; fi
echo
echo "Terminé. Adresse du site : https://$DOMAIN"
echo "(le certificat HTTPS peut prendre une minute ; si ça bloque : sudo journalctl -u caddy -n 50)"
