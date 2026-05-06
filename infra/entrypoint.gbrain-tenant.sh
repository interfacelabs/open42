#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8080}"
GBRAIN_PUBLIC_URL="${GBRAIN_PUBLIC_URL:-http://localhost:${PORT}}"

gbrain init --pglite >/dev/null 2>&1 || true
exec gbrain serve --http --port "${PORT}" --enable-dcr --public-url "${GBRAIN_PUBLIC_URL}"
