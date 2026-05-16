#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV="${NODE_ENV:-production}"
export OPEN42_EDITION="${OPEN42_EDITION:-cloud}"
export NEXT_PUBLIC_OPEN42_EDITION="${NEXT_PUBLIC_OPEN42_EDITION:-cloud}"
export API_PUBLIC_URL="${API_PUBLIC_URL:-https://api.open42.ai}"
export WEB_PUBLIC_URL="${WEB_PUBLIC_URL:-https://app.open42.ai}"
export NEXT_PUBLIC_OPEN42_APP_URL="${NEXT_PUBLIC_OPEN42_APP_URL:-https://app.open42.ai}"

DATA_DIR="${OPEN42_CORE_DATA_DIR:-/data}"
PGDATA="${PGDATA:-${DATA_DIR}/postgres}"
POSTGRES_USER="${POSTGRES_USER:-open42}"
POSTGRES_DB="${POSTGRES_DB:-open42}"
POSTGRES_PASSWORD_FILE="${POSTGRES_PASSWORD_FILE:-${DATA_DIR}/postgres-password}"
POSTGRES_RUN_DIR="/run/postgresql"
REDIS_DATA_DIR="${REDIS_DATA_DIR:-${DATA_DIR}/redis}"
TAILSCALE_STATE_DIR="${TAILSCALE_STATE_DIR:-${DATA_DIR}/tailscale}"
TAILSCALE_SOCKET="${TAILSCALE_SOCKET:-/var/run/tailscale/tailscaled.sock}"
TAILSCALE_HOSTNAME="${TAILSCALE_HOSTNAME:-open42-core}"
TAILSCALE_TAGS="${TAILSCALE_TAGS:-tag:open42-core}"
TAILSCALE_ACCEPT_DNS="${TAILSCALE_ACCEPT_DNS:-false}"

pids=()

if [[ ! "${POSTGRES_USER}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "POSTGRES_USER must be a simple PostgreSQL identifier" >&2
  exit 1
fi

if [[ ! "${POSTGRES_DB}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "POSTGRES_DB must be a simple PostgreSQL identifier" >&2
  exit 1
fi

mkdir -p "${DATA_DIR}" "${PGDATA}" "${POSTGRES_RUN_DIR}" "${REDIS_DATA_DIR}" /var/log/caddy
chmod 700 "${PGDATA}"
chown -R postgres:postgres "${PGDATA}" "${POSTGRES_RUN_DIR}"
if id redis >/dev/null 2>&1; then
  chown -R redis:redis "${REDIS_DATA_DIR}"
fi

if [[ -n "${POSTGRES_PASSWORD:-}" ]]; then
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

start_tailscale() {
  local state_file="${TAILSCALE_STATE_DIR}/tailscaled.state"

  if [[ -z "${TAILSCALE_AUTHKEY:-}" && ! -s "${state_file}" && "${OPEN42_TAILSCALE_ENABLED:-}" != "1" ]]; then
    return
  fi

  if [[ -z "${TAILSCALE_AUTHKEY:-}" && ! -s "${state_file}" ]]; then
    echo "TAILSCALE_AUTHKEY is required on first Tailscale boot" >&2
    exit 1
  fi

  mkdir -p "$(dirname "${TAILSCALE_SOCKET}")" "${TAILSCALE_STATE_DIR}" /var/cache/tailscale
  tailscaled --state="${state_file}" --socket="${TAILSCALE_SOCKET}" &
  pids+=("$!")

  for _ in $(seq 1 50); do
    if [[ -S "${TAILSCALE_SOCKET}" ]]; then
      break
    fi
    sleep 0.1
  done

  if [[ ! -S "${TAILSCALE_SOCKET}" ]]; then
    echo "tailscaled did not create ${TAILSCALE_SOCKET}" >&2
    exit 1
  fi

  local up_args=("--hostname=${TAILSCALE_HOSTNAME}" "--accept-dns=${TAILSCALE_ACCEPT_DNS}")
  if [[ -n "${TAILSCALE_TAGS}" ]]; then
    up_args+=("--advertise-tags=${TAILSCALE_TAGS}")
  fi
  if [[ -n "${TAILSCALE_AUTHKEY:-}" ]]; then
    up_args+=("--auth-key=${TAILSCALE_AUTHKEY}")
  fi

  if ! tailscale --socket="${TAILSCALE_SOCKET}" up "${up_args[@]}"; then
    echo "tailscale up failed" >&2
    exit 1
  fi
}

export PGPASSWORD="${POSTGRES_PASSWORD}"
until su-exec postgres psql -h 127.0.0.1 -U "${POSTGRES_USER}" -d postgres -c 'SELECT 1' >/dev/null 2>&1; do
  sleep 0.5
done

if ! su-exec postgres psql -h 127.0.0.1 -U "${POSTGRES_USER}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${POSTGRES_DB}'" | grep -q 1; then
  su-exec postgres createdb -h 127.0.0.1 -U "${POSTGRES_USER}" "${POSTGRES_DB}"
fi

redis_args=(
  --bind 127.0.0.1
  --protected-mode yes
  --port 6379
  --appendonly yes
  --dir "${REDIS_DATA_DIR}"
  --daemonize yes
)
if id redis >/dev/null 2>&1; then
  su-exec redis redis-server "${redis_args[@]}"
else
  redis-server "${redis_args[@]}"
fi
until redis-cli -h 127.0.0.1 ping >/dev/null 2>&1; do
  sleep 0.5
done

start_tailscale

export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"

npm run db:migrate:cloud -w @open42/api

API_PORT=3001 PORT=3001 npm run start -w @open42/api &
pids+=("$!")

PORT=3000 npm run start -w @open42/web &
pids+=("$!")

PORT=3002 npm run start -w @open42/landing &
pids+=("$!")

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
pids+=("$!")

shutdown() {
  for pid in "${pids[@]}"; do
    kill "${pid}" >/dev/null 2>&1 || true
  done
  redis-cli -h 127.0.0.1 shutdown save >/dev/null 2>&1 || true
  stop_postgres
}

trap 'shutdown; exit 143' TERM
trap 'shutdown; exit 130' INT
trap shutdown EXIT

wait -n "${pids[@]}"
exit_code="$?"
shutdown
exit "${exit_code}"
