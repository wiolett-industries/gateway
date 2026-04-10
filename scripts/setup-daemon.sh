#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# ── Gateway Daemon Setup — Dispatcher ───────────────────────────────
# Downloads and runs the appropriate setup script for a daemon type.
#
# Usage:
#   curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/setup-daemon.sh | \
#     sudo bash -s -- --type nginx --gateway gateway.example.com:9443 --token <TOKEN>
# ────────────────────────────────────────────────────────────────────

# ── Colors ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m'
BOLD='\033[1m'

# ── Defaults ────────────────────────────────────────────────────────
DAEMON_TYPE=""
GITLAB_URL="${GATEWAY_GITLAB_URL:-https://gitlab.wiolett.net}"
GITLAB_PROJECT="${GATEWAY_GITLAB_PROJECT:-wiolett/gateway}"
PASSTHROUGH_ARGS=()

# ── Helpers ─────────────────────────────────────────────────────────
log()  { echo -e "${CYAN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()  { err "$@"; exit 1; }

command_exists() { command -v "$1" &>/dev/null; }

# ── Parse Arguments ─────────────────────────────────────────────────
show_help() {
    cat <<'HELP'
Gateway Daemon Setup — downloads and runs the appropriate setup script

Usage:
  setup-daemon.sh --type <nginx|docker|monitoring> [options...]

Options:
  --type <type>            Daemon type: nginx, docker, or monitoring
  --gitlab-url <url>       GitLab instance URL (default: https://gitlab.wiolett.net)
  --gitlab-project <proj>  GitLab project path (default: wiolett/gateway)
  -h, --help               Show this help

All other flags are forwarded to the daemon-specific setup script.

Examples:
  # Interactive type selection:
  sudo bash setup-daemon.sh

  # Direct nginx setup:
  sudo bash setup-daemon.sh --type nginx --gateway gw.example.com:9443 --token <TOKEN>

  # Docker daemon with custom GitLab:
  sudo bash setup-daemon.sh --type docker --gitlab-url https://git.example.com --gateway gw.example.com:9443 --token <TOKEN>
HELP
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --type)           DAEMON_TYPE="$2"; shift 2 ;;
        --gitlab-url)     GITLAB_URL="$2"; PASSTHROUGH_ARGS+=("--gitlab-url" "$2"); shift 2 ;;
        --gitlab-project) GITLAB_PROJECT="$2"; PASSTHROUGH_ARGS+=("--gitlab-project" "$2"); shift 2 ;;
        -h|--help)        show_help ;;
        *)                PASSTHROUGH_ARGS+=("$1"); shift ;;
    esac
done

# ── Dependency check ────────────────────────────────────────────────
if ! command_exists curl; then
    die "curl is required but not found. Install it and retry."
fi

# ── Interactive type selection ──────────────────────────────────────
if [[ -z "$DAEMON_TYPE" ]]; then
    echo ""
    echo -e "${BOLD}${CYAN}  Gateway — Daemon Setup${NC}"
    echo ""
    echo -e "  ${GRAY}Select daemon type to install:${NC}"
    echo ""
    echo -e "    ${CYAN}1)${NC} nginx       — Reverse proxy node (nginx + nginx-daemon)"
    echo -e "    ${CYAN}2)${NC} docker      — Docker container management node"
    echo -e "    ${CYAN}3)${NC} monitoring  — System metrics agent (no nginx/docker)"
    echo ""
    if [ -e /dev/tty ]; then
        read -r -p "$(echo -e "  ${CYAN}Choose [1-3]: ${NC}")" choice < /dev/tty
    else
        die "Cannot prompt for type — use --type flag"
    fi
    case "$choice" in
        1|nginx)      DAEMON_TYPE="nginx" ;;
        2|docker)     DAEMON_TYPE="docker" ;;
        3|monitoring) DAEMON_TYPE="monitoring" ;;
        *) die "Invalid choice: $choice" ;;
    esac
    echo ""
fi

# ── Validate type ───────────────────────────────────────────────────
case "$DAEMON_TYPE" in
    nginx|docker|monitoring) ;;
    *) die "Unknown daemon type: $DAEMON_TYPE. Use: nginx, docker, or monitoring" ;;
esac

# ── Map type to script name ─────────────────────────────────────────
case "$DAEMON_TYPE" in
    nginx)      SCRIPT_NAME="setup-node.sh" ;;
    docker)     SCRIPT_NAME="setup-docker-node.sh" ;;
    monitoring) SCRIPT_NAME="setup-monitoring-node.sh" ;;
esac

# ── Build GitLab API URL ────────────────────────────────────────────
ENCODED_PROJECT="${GITLAB_PROJECT//\//%2F}"
GITLAB_API="${GITLAB_URL}/api/v4/projects/${ENCODED_PROJECT}"

# ── Download and execute ────────────────────────────────────────────
DOWNLOAD_URL="${GITLAB_API}/releases/permalink/latest/downloads/${SCRIPT_NAME}"

log "Downloading ${SCRIPT_NAME} from ${GITLAB_URL}..."

TMPSCRIPT=$(mktemp /tmp/gateway-setup-XXXXXX.sh)
trap 'rm -f "$TMPSCRIPT"' EXIT

if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMPSCRIPT"; then
    die "Failed to download ${SCRIPT_NAME} from releases. URL: ${DOWNLOAD_URL}"
fi

chmod +x "$TMPSCRIPT"
log "Running ${SCRIPT_NAME}..."
echo ""

exec bash "$TMPSCRIPT" "${PASSTHROUGH_ARGS[@]}"
