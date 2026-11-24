#!/usr/bin/env bash
# Met le site à jour avec la dernière version poussée sur GitHub.
# À lancer sur la VM, sans sudo :   bash ~/quizparty/deploy/update.sh
# Attention : le redémarrage coupe les parties en cours (l'état est en mémoire).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

before="$(git rev-parse HEAD)"
git pull --ff-only
if git diff --name-only "$before" HEAD | grep -qx 'package-lock.json'; then
  npm ci --omit=dev --no-audit --no-fund
fi
sudo /usr/bin/systemctl restart quizparty
sleep 2
port="$(grep -E '^PORT=' .env | cut -d= -f2)"
if curl -fsS "http://127.0.0.1:${port:-3000}/health" >/dev/null; then
  echo "À jour ($(git log -1 --format='%h %s')) et en ligne."
else
  echo "Le serveur ne répond pas : sudo journalctl -u quizparty -n 50"
  exit 1
fi
