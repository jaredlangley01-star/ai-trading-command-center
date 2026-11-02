#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { printf "\nSETUP ERROR: %s\n" "$1" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Install Docker Desktop for Mac first."
docker info >/dev/null 2>&1 || fail "Docker Desktop is not running. Open Docker Desktop and wait until it says Engine running."
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install Node.js 22.13 or newer."
command -v npm >/dev/null 2>&1 || fail "npm was not found."
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22 || (a===22 && b<13)) process.exit(1)' || fail "Node.js 22.13 or newer is required."
command -v openssl >/dev/null 2>&1 || fail "OpenSSL is required to generate a private dashboard token."

if [[ ! -f .env.small-trading ]]; then
  [[ -f .env.small-trading.example ]] || fail "Missing .env.small-trading.example."
  cp .env.small-trading.example .env.small-trading
  chmod 600 .env.small-trading
  printf "Created private .env.small-trading.\n"
fi

if grep -Eq 'replace-with-paper-account-key|replace-with-paper-account-secret' .env.small-trading; then
  printf "\nAlpaca Paper credentials are needed for real market observations.\n"
  read -r -p "Alpaca Paper API Key ID: " APCA_KEY
  read -r -s -p "Alpaca Paper Secret Key: " APCA_SECRET
  printf "\n"
  [[ -n "$APCA_KEY" && -n "$APCA_SECRET" ]] || fail "Both Alpaca credentials are required."
  export APCA_KEY APCA_SECRET
  python3 - <<'PY'
import os
from pathlib import Path
p=Path(".env.small-trading")
s=p.read_text()
s=s.replace("replace-with-paper-account-key", os.environ["APCA_KEY"])
s=s.replace("replace-with-paper-account-secret", os.environ["APCA_SECRET"])
p.write_text(s)
p.chmod(0o600)
PY
  unset APCA_KEY APCA_SECRET
fi

if grep -q 'replace-with-a-long-random-token' .env.small-trading; then
  TOKEN="$(openssl rand -hex 32)"
  export TOKEN
  python3 - <<'PY'
import os
from pathlib import Path
p=Path(".env.small-trading")
p.write_text(p.read_text().replace("replace-with-a-long-random-token", os.environ["TOKEN"]))
p.chmod(0o600)
PY
fi

TOKEN="$(sed -n 's/^SMALL_TRADING_API_TOKEN=//p' .env.small-trading | tail -n 1)"
[[ -n "$TOKEN" ]] || fail "SMALL_TRADING_API_TOKEN is missing from .env.small-trading."
cat > .env.local <<EOF
SMALL_TRADING_BACKEND_URL=http://127.0.0.1:8765
SMALL_TRADING_API_TOKEN=$TOKEN
EOF
chmod 600 .env.local

printf "\nStarting the observation worker and private dashboard API...\n"
docker compose -f docker-compose.small-trading.yml up -d --build
printf "\nInstalling dashboard dependencies if needed...\n"
if [[ ! -d node_modules ]]; then npm ci; fi
printf "\nDashboard: http://localhost:3000/small-trading\n"
printf "Worker logs: docker compose -f docker-compose.small-trading.yml logs -f observation-worker\n"
printf "Press Control+C to stop only the dashboard. The worker will continue in Docker.\n\n"
npm run dev
