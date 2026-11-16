#!/usr/bin/env bash
# Arranca el escáner en local (Mac/Linux): ./arrancar.sh   ·   Ctrl+C para parar.
set -e
cd "$(dirname "$0")"

command -v node >/dev/null || { echo "Falta Node.js: instala la versión LTS desde https://nodejs.org"; exit 1; }

# Dependencias del analizador (solo la primera vez)
[ -d worker/node_modules ] || (cd worker && npm install)

# Analizador (:8787) y web (:8080) en segundo plano; se paran juntos con Ctrl+C
(cd worker && npx wrangler dev --port 8787) &
npx -y http-server -p 8080 -c-1 &
trap 'kill 0' EXIT

sleep 10
URL="http://localhost:8080/escaner/"
(command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") || echo "Abre $URL"
wait
