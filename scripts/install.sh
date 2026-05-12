#!/usr/bin/env bash
# Open42 community edition installer.
#
# Usage (inside a checkout):
#   bash scripts/install.sh
#
# Usage (fresh machine, once hosted):
#   curl -fsSL https://raw.githubusercontent.com/interfacelabs/open42/main/scripts/install.sh | bash
#
# Flags:
#   --no-start            Skip starting the stack after .env is written
#   --skip-prereqs        Trust the host, don't run the prerequisite checks
#   --repo-dir <path>     Clone into <path> when running outside a checkout
#   -h, --help            Show this help

set -euo pipefail

REPO_URL="https://github.com/interfacelabs/open42.git"
REPO_DIR_DEFAULT="open42"
COMPOSE_FILE="docker-compose.community.yml"
REQUIRED_NODE_MAJOR=20

START_STACK=1
SKIP_PREREQS=0
REPO_DIR=""

if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_DIM=""; C_RESET=""
fi

ok()   { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
info() { printf '%s→%s %s\n' "$C_BLUE"  "$C_RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
err()  { printf '%s✗%s %s\n' "$C_RED"   "$C_RESET" "$*" >&2; }
hr()   { printf '%s%s%s\n' "$C_DIM" "----------------------------------------------------------------" "$C_RESET"; }

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --no-start) START_STACK=0; shift ;;
    --skip-prereqs) SKIP_PREREQS=1; shift ;;
    --repo-dir) REPO_DIR="${2:-}"; [ -n "$REPO_DIR" ] || { err "--repo-dir requires a path"; exit 1; }; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) err "unknown flag: $1"; usage; exit 1 ;;
  esac
done

# When piped (e.g. curl ... | bash), stdin is the pipe — reattach to the
# controlling terminal so interactive prompts in setup.mjs still work.
if [ ! -t 0 ] && [ -r /dev/tty ]; then
  exec </dev/tty
fi

detect_os() {
  case "$(uname -s)" in
    Darwin) echo macos ;;
    Linux)
      if [ -r /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        case "${ID:-}" in
          ubuntu|debian) echo ubuntu ;;
          *) [ "${ID_LIKE:-}" = "debian" ] && echo ubuntu || echo "${ID:-linux}" ;;
        esac
      else
        echo linux
      fi
      ;;
    *) echo "unknown" ;;
  esac
}

OS="$(detect_os)"

print_banner() {
  hr
  printf '%sOpen42%s community installer\n' "$C_BOLD" "$C_RESET"
  printf '%sOS detected:%s %s\n' "$C_DIM" "$C_RESET" "$OS"
  hr
}

hint_for() {
  local tool="$1"
  case "$OS:$tool" in
    macos:git)             echo "xcode-select --install   (or: brew install git)" ;;
    macos:curl)            echo "Pre-installed on macOS. If missing: brew install curl" ;;
    macos:docker)          echo "Install Docker Desktop: https://www.docker.com/products/docker-desktop  (or: brew install --cask docker)" ;;
    macos:docker-compose)  echo "Docker Desktop bundles 'docker compose' v2. Install Docker Desktop." ;;
    macos:node)            echo "brew install node@20   (or: nvm install 20 && nvm use 20)" ;;
    macos:npm)             echo "Bundled with Node.js. Install Node 20+." ;;
    ubuntu:git)            echo "sudo apt-get update && sudo apt-get install -y git" ;;
    ubuntu:curl)           echo "sudo apt-get update && sudo apt-get install -y curl" ;;
    ubuntu:docker)         echo "Install Docker Engine: https://docs.docker.com/engine/install/ubuntu/" ;;
    ubuntu:docker-compose) echo "Install the docker-compose-plugin package (bundled with the official Docker Engine install)." ;;
    ubuntu:node)           echo "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs" ;;
    ubuntu:npm)            echo "Bundled with Node.js. Install Node 20+." ;;
    *)                     echo "Install '${tool}' for your platform." ;;
  esac
}

HINTS=()
add_hint() { HINTS+=("$1"); }

check_cmd() {
  local cmd="$1" tool="${2:-$1}"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$cmd"
    return 0
  fi
  err "$cmd not found"
  add_hint "  ${C_BOLD}${tool}${C_RESET}: $(hint_for "$tool")"
  return 1
}

check_node_version() {
  command -v node >/dev/null 2>&1 || return 0
  local raw major
  raw="$(node -v)"
  major="${raw#v}"; major="${major%%.*}"
  if [ "${major:-0}" -lt "$REQUIRED_NODE_MAJOR" ]; then
    err "Node.js ${REQUIRED_NODE_MAJOR}+ required (found ${raw})"
    add_hint "  ${C_BOLD}node${C_RESET}: $(hint_for node)"
    return 1
  fi
  ok "node ${raw}"
}

check_docker_compose() {
  command -v docker >/dev/null 2>&1 || return 0
  if docker compose version >/dev/null 2>&1; then
    ok "docker compose v2"
  else
    err "'docker compose' v2 plugin not available"
    add_hint "  ${C_BOLD}docker-compose${C_RESET}: $(hint_for docker-compose)"
    return 1
  fi
}

check_docker_running() {
  command -v docker >/dev/null 2>&1 || return 0
  if docker info >/dev/null 2>&1; then
    ok "docker daemon running"
    return 0
  fi
  err "Docker daemon is not running"
  case "$OS" in
    macos)  add_hint "  Start Docker Desktop, then re-run." ;;
    ubuntu) add_hint "  Start the daemon: sudo systemctl start docker" ;;
    *)      add_hint "  Start the Docker daemon, then re-run." ;;
  esac
  return 1
}

prereq_check() {
  info "Checking prerequisites"
  local failed=0
  check_cmd git              || failed=1
  check_cmd curl             || failed=1
  check_cmd node             || failed=1
  check_node_version         || failed=1
  check_cmd npm              || failed=1
  check_cmd docker           || failed=1
  check_docker_compose       || failed=1
  check_docker_running       || failed=1

  if [ "$failed" -ne 0 ]; then
    hr
    err "Missing prerequisites. Install them, then re-run this script:"
    if [ "${#HINTS[@]}" -gt 0 ]; then
      for h in "${HINTS[@]}"; do printf '%s\n' "$h"; done
    fi
    hr
    exit 1
  fi
}

ensure_repo() {
  if [ -f "$COMPOSE_FILE" ] && [ -f "package.json" ]; then
    info "Using current checkout: $(pwd)"
    return 0
  fi
  local dir="${REPO_DIR:-$REPO_DIR_DEFAULT}"
  if [ -d "$dir/.git" ]; then
    info "Reusing checkout at ./${dir}"
  else
    info "Cloning ${REPO_URL} → ./${dir}"
    git clone --depth=1 "$REPO_URL" "$dir"
  fi
  cd "$dir"
}

run_npm_install() {
  info "Installing Node dependencies (npm install)"
  npm install --no-audit --no-fund
}

run_setup() {
  info "Generating secrets and prompting for required values"
  npm run setup -- --ask-provider-keys
}

build_tenant_image() {
  info "Building the gbrain tenant image"
  npm run tenant:build
}

start_stack() {
  info "Starting the community stack (docker compose up --build -d)"
  docker compose -f "$COMPOSE_FILE" up --build -d
}

wait_health() {
  info "Waiting for services to become healthy"
  local deadline=$((SECONDS + 180))
  local api_ok=0 web_ok=0
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$api_ok" -eq 0 ] && curl -fsS -o /dev/null http://localhost:3001/healthz; then
      ok "API up at http://localhost:3001"
      api_ok=1
    fi
    if [ "$web_ok" -eq 0 ] && curl -fsS -o /dev/null http://localhost:3000; then
      ok "Web up at http://localhost:3000"
      web_ok=1
    fi
    [ "$api_ok" -eq 1 ] && [ "$web_ok" -eq 1 ] && return 0
    sleep 2
  done
  warn "Timed out waiting for /healthz. Inspect logs: docker compose -f ${COMPOSE_FILE} logs"
  return 1
}

print_done() {
  hr
  printf '%s%sOpen42 is ready.%s\n\n' "$C_BOLD" "$C_GREEN" "$C_RESET"
  printf '  Sign in: %shttp://localhost:3000/sign_in%s\n' "$C_BOLD" "$C_RESET"
  printf '  API:     http://localhost:3001/healthz\n'
  printf '  Logs:    docker compose -f %s logs -f\n' "$COMPOSE_FILE"
  printf '  Stop:    docker compose -f %s down\n' "$COMPOSE_FILE"
  printf '\n  %sThe first Supabase magic-link recipient becomes the workspace owner.%s\n' "$C_DIM" "$C_RESET"
  hr
}

print_banner
case "$OS" in
  macos|ubuntu) ;;
  *) warn "OS '${OS}' is not officially tested. Continuing — your mileage may vary." ;;
esac

[ "$SKIP_PREREQS" -eq 1 ] || prereq_check
ensure_repo
run_npm_install
run_setup
build_tenant_image
if [ "$START_STACK" -eq 1 ]; then
  start_stack
  wait_health
fi
print_done
