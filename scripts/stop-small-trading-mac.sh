#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
docker compose -f docker-compose.small-trading.yml down
printf "Worker and dashboard API stopped. The persistent Docker data volume was kept.\n"
