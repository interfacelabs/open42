#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8080}"
GBRAIN_PUBLIC_URL="${GBRAIN_PUBLIC_URL:-http://localhost:${PORT}}"
export GBRAIN_HOME="${GBRAIN_HOME:-/data/gbrain}"
PGDATA="${PGDATA:-/data/postgres}"
POSTGRES_USER="${GBRAIN_POSTGRES_USER:-gbrain}"
POSTGRES_DB="${GBRAIN_POSTGRES_DB:-gbrain}"
POSTGRES_PASSWORD_FILE="${GBRAIN_POSTGRES_PASSWORD_FILE:-/data/postgres-password}"
POSTGRES_RUN_DIR="/run/postgresql"

if [[ ! "${POSTGRES_USER}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "GBRAIN_POSTGRES_USER must be a simple PostgreSQL identifier" >&2
  exit 1
fi
if [[ ! "${POSTGRES_DB}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "GBRAIN_POSTGRES_DB must be a simple PostgreSQL identifier" >&2
  exit 1
fi

mkdir -p /data "${GBRAIN_HOME}" "${PGDATA}" "${POSTGRES_RUN_DIR}"
chown postgres:postgres "${PGDATA}" "${POSTGRES_RUN_DIR}"
chmod 700 "${PGDATA}"

if [[ -n "${GBRAIN_POSTGRES_PASSWORD:-}" ]]; then
  POSTGRES_PASSWORD="${GBRAIN_POSTGRES_PASSWORD}"
  umask 077
  printf '%s' "${POSTGRES_PASSWORD}" > "${POSTGRES_PASSWORD_FILE}"
elif [[ -s "${POSTGRES_PASSWORD_FILE}" ]]; then
  POSTGRES_PASSWORD="$(cat "${POSTGRES_PASSWORD_FILE}")"
else
  POSTGRES_PASSWORD="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
  umask 077
  printf '%s' "${POSTGRES_PASSWORD}" > "${POSTGRES_PASSWORD_FILE}"
fi

if [[ ! -s "${PGDATA}/PG_VERSION" ]]; then
  password_tmp="$(mktemp)"
  chmod 600 "${password_tmp}"
  printf '%s' "${POSTGRES_PASSWORD}" > "${password_tmp}"
  chown postgres:postgres "${password_tmp}"
  su-exec postgres initdb -D "${PGDATA}" --username="${POSTGRES_USER}" --pwfile="${password_tmp}"
  rm -f "${password_tmp}"
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "unix_socket_directories = '${POSTGRES_RUN_DIR}'"
  } >> "${PGDATA}/postgresql.conf"
  {
    echo "host all all 127.0.0.1/32 scram-sha-256"
    echo "host all all ::1/128 scram-sha-256"
  } >> "${PGDATA}/pg_hba.conf"
fi

su-exec postgres pg_ctl -D "${PGDATA}" -w start

stop_postgres() {
  su-exec postgres pg_ctl -D "${PGDATA}" -m fast -w stop >/dev/null 2>&1 || true
}
trap stop_postgres EXIT TERM INT

export PGPASSWORD="${POSTGRES_PASSWORD}"
until psql -h 127.0.0.1 -U "${POSTGRES_USER}" -d postgres -c 'SELECT 1' >/dev/null 2>&1; do
  sleep 0.5
done

if ! psql -h 127.0.0.1 -U "${POSTGRES_USER}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${POSTGRES_DB}'" | grep -q 1; then
  createdb -h 127.0.0.1 -U "${POSTGRES_USER}" "${POSTGRES_DB}"
fi
psql -h 127.0.0.1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -c 'CREATE EXTENSION IF NOT EXISTS vector' >/dev/null
psql -h 127.0.0.1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm' >/dev/null

export GBRAIN_DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}"
export GBRAIN_DATABASE_URL
gbrain init --non-interactive --url "${GBRAIN_DATABASE_URL}"
gbrain serve --http --port "${PORT}" --enable-dcr --public-url "${GBRAIN_PUBLIC_URL}" &
gbrain_pid="$!"

shutdown() {
  kill "${gbrain_pid}" >/dev/null 2>&1 || true
  wait "${gbrain_pid}" >/dev/null 2>&1 || true
  stop_postgres
}

trap 'shutdown; exit 143' TERM
trap 'shutdown; exit 130' INT
trap shutdown EXIT

wait "${gbrain_pid}"
