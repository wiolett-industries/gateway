#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# ── Gateway Monitoring Node Setup ──────────────────────────────────
# Installs monitoring-daemon on a host and enrolls it with the Gateway.
# No nginx or Docker required — this agent reports system metrics only.
#
# Usage:
#   curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/setup-monitoring-node.sh | \
#     sudo bash -s -- --gateway gateway.example.com:9443 --token <ENROLLMENT_TOKEN>
# ───────────────────────────────────────────────────────────────────

LOG_FILE="/tmp/gateway_monitoring_setup.log"

# ── Colors ────────────────────────────────────────────────────────
BRAND_MINT='\033[38;2;140;176;132m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
GRAY='\033[0;90m'
NC='\033[0m'
BOLD='\033[1m'
TITLE_TAG='\033[48;2;140;176;132m\033[30m'
INFO_TAG='\033[47m\033[90m'
WARN_TAG='\033[43m\033[30m'
ERROR_TAG='\033[41m\033[97m'
SUCCESS_TAG='\033[42m\033[97m'

# ── Defaults ──────────────────────────────────────────────────────
GATEWAY_HOST="${GATEWAY_NODE_HOST:-}"
GATEWAY_PORT="${GATEWAY_NODE_PORT:-9443}"
GATEWAY_ADDR="${GATEWAY_NODE_ADDRESS:-}"
ENROLL_TOKEN="${GATEWAY_NODE_TOKEN:-}"
DAEMON_VERSION="${GATEWAY_NODE_DAEMON_VERSION:-latest}"
GITLAB_URL="${GATEWAY_GITLAB_URL:-https://gitlab.wiolett.net}"
GITLAB_PROJECT="${GATEWAY_GITLAB_PROJECT:-wiolett/gateway}"
RUN_USER=""
NON_INTERACTIVE=0
NO_LOGO=0
APT_UPDATED=0
RESOLVED_DAEMON_VERSION=""
EXISTING_INSTALL=0
EXISTING_VERSION=""
EXISTING_GATEWAY_ADDR=""
EXISTING_ENROLLED=0

# ── Helpers ───────────────────────────────────────────────────────
log()  { echo -e "${INFO_TAG} INFO ${NC} $*"; }
warn() { echo -e "${WARN_TAG} WARN ${NC} $*"; }
err()  { echo -e "${ERROR_TAG} ERROR ${NC} $*" >&2; }
ok()   { echo -e "${SUCCESS_TAG} OK ${NC} $*"; }

die() { err "$@"; exit 1; }

show_logo() {
    echo ""
    echo '░██       ░██ ░██           ░██               ░██       ░██    '
    echo '░██       ░██               ░██               ░██       ░██    '
    echo '░██  ░██  ░██ ░██ ░███████  ░██  ░███████  ░████████ ░████████ '
    echo '░██ ░████ ░██ ░██░██    ░██ ░██ ░██    ░██    ░██       ░██    '
    echo '░██░██ ░██░██ ░██░██    ░██ ░██ ░█████████    ░██       ░██    '
    echo '░████   ░████ ░██░██    ░██ ░██ ░██           ░██       ░██    '
    echo '░███     ░███ ░██ ░███████  ░██  ░███████      ░████     ░████ '
    echo ""
    echo -e "${BRAND_MINT}░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░${NC}"
    echo -e "${BRAND_MINT}░░░█▀▀░█▀█░▀█▀░█▀▀░█░█░█▀█░█░█░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░${NC}"
    echo -e "${BRAND_MINT}░░░█░█░█▀█░░█░░█▀▀░█▄█░█▀█░░█░░░░▀░▀░▀░▀░▀░▀░▀░▀░▀░▀░▀░▀░▀░░░░${NC}"
    echo -e "${BRAND_MINT}░░░▀▀▀░▀░▀░░▀░░▀▀▀░▀░▀░▀░▀░░▀░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░${NC}"
    echo -e "${BRAND_MINT}░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░${NC}"
    echo ""
}

title() { echo ""; echo -e "${TITLE_TAG} $1 ${NC}"; echo ""; }

need_root() {
    if [[ $EUID -ne 0 ]]; then
        die "This script must be run as root (or with sudo)"
    fi
}

detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS_ID="${ID:-unknown}"
        OS_LIKE="${ID_LIKE:-$OS_ID}"
    else
        OS_ID="unknown"
        OS_LIKE="unknown"
    fi
}

detect_arch() {
    local machine
    machine=$(uname -m)
    case "$machine" in
        x86_64|amd64) ARCH="amd64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        armv7l)        ARCH="armv7" ;;
        *) die "Unsupported architecture: $machine" ;;
    esac
}

command_exists() { command -v "$1" &>/dev/null; }

check_dependencies() {
    if command_exists curl; then
        return
    fi
    log "curl not found, installing it..."
    if command_exists apt-get; then
        if [[ "$APT_UPDATED" -eq 0 ]]; then
            apt-get update >>"$LOG_FILE" 2>&1
            APT_UPDATED=1
        fi
        apt-get install -y curl ca-certificates >>"$LOG_FILE" 2>&1
    elif command_exists yum; then
        yum install -y curl ca-certificates >>"$LOG_FILE" 2>&1
    elif command_exists dnf; then
        dnf install -y curl ca-certificates >>"$LOG_FILE" 2>&1
    elif command_exists apk; then
        apk add curl ca-certificates >>"$LOG_FILE" 2>&1
    else
        die "curl is required and no supported package manager was found for automatic installation."
    fi
}

build_gitlab_api() {
    local encoded_project="${GITLAB_PROJECT//\//%2F}"
    GITLAB_API="${GITLAB_URL}/api/v4/projects/${encoded_project}"
}

normalize_daemon_version() {
    local version="$1"
    version="${version%-monitoring}"
    if [[ "$version" != v* ]]; then
        version="v${version}"
    fi
    echo "$version"
}

detect_existing_install() {
    local target="/usr/local/bin/monitoring-daemon"
    local config_path="/etc/monitoring-daemon/config.yaml"
    local state_path="/var/lib/monitoring-daemon/state.json"
    local cert_path="/etc/monitoring-daemon/certs/node.pem"
    EXISTING_INSTALL=0
    EXISTING_VERSION=""
    EXISTING_GATEWAY_ADDR=""
    EXISTING_ENROLLED=0

    if [[ -x "$target" ]]; then
        EXISTING_INSTALL=1
        EXISTING_VERSION=$("$target" version 2>/dev/null | awk '{print $2}' || echo "unknown")
    fi

    if [[ -f "$config_path" ]]; then
        EXISTING_GATEWAY_ADDR=$(awk -F'"' '/^[[:space:]]*address:[[:space:]]*"/ {print $2; exit}' "$config_path")
        if [[ -z "$EXISTING_GATEWAY_ADDR" ]]; then
            EXISTING_GATEWAY_ADDR=$(awk '/^[[:space:]]*address:[[:space:]]*/ {print $2; exit}' "$config_path")
        fi
    fi

    if [[ -f "$cert_path" && -f "$state_path" ]]; then
        EXISTING_ENROLLED=1
    fi
}

resolve_download_url() {
    local version="$1"
    local binary_name="monitoring-daemon-linux-${ARCH}"

    if [[ "$version" == "latest" ]]; then
        log "Resolving latest monitoring release tag..."
        local latest_tag
        latest_tag=$(curl -fsSL "${GITLAB_API}/releases" | grep -o '"tag_name":"v[0-9]*\.[0-9]*\.[0-9]*-monitoring"' | head -1 | cut -d'"' -f4)
        if [[ -z "$latest_tag" || "$latest_tag" == "null" ]]; then
            die "Could not resolve latest monitoring release tag from ${GITLAB_API}/releases"
        fi
        log "Resolved tag: ${latest_tag}"
        RESOLVED_DAEMON_VERSION="${latest_tag%-monitoring}"
        RELEASE_BASE="${GITLAB_API}/releases/${latest_tag}/downloads"
    else
        RESOLVED_DAEMON_VERSION=$(normalize_daemon_version "$version")
        RELEASE_BASE="${GITLAB_API}/releases/${RESOLVED_DAEMON_VERSION}-monitoring/downloads"
    fi

    DOWNLOAD_URL="${RELEASE_BASE}/${binary_name}"
}

prompt_input() {
    local prompt="$1"
    local default="${2:-}"
    local result
    if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
        echo "$default"
        return
    fi
    if [ -e /dev/tty ]; then
        if [ -n "$default" ]; then
            read -r -p "$(echo -e "  ${BRAND_MINT}${prompt} [${default}]: ${NC}")" result < /dev/tty
        else
            read -r -p "$(echo -e "  ${BRAND_MINT}${prompt}: ${NC}")" result < /dev/tty
        fi
    else
        result=""
    fi
    echo "${result:-$default}"
}

prompt_secret() {
    local prompt="$1"
    local result
    if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
        echo ""
        return
    fi
    if [ -e /dev/tty ]; then
        read -rs -p "$(echo -e "  ${BRAND_MINT}${prompt}: ${NC}")" result < /dev/tty
        echo "" >&2
    else
        result=""
    fi
    echo "$result"
}

prompt_yes_no() {
    local prompt="$1"
    local default="${2:-Y}"
    local reply
    if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
        [[ "$default" =~ ^[yY]$ ]]
        return
    fi
    if [ -e /dev/tty ]; then
        if [[ "$default" == "Y" ]]; then
            read -r -p "$(echo -e "  ${BRAND_MINT}${prompt} [Y/n]: ${NC}")" reply < /dev/tty
            reply="${reply:-Y}"
        else
            read -r -p "$(echo -e "  ${BRAND_MINT}${prompt} [y/N]: ${NC}")" reply < /dev/tty
            reply="${reply:-N}"
        fi
    else
        reply="$default"
    fi
    [[ "$reply" =~ ^[yY]$ ]]
}

prompt_choice() {
    local prompt="$1"
    local default="$2"
    shift 2
    local reply
    if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
        echo "$default"
        return
    fi
    if [ -e /dev/tty ]; then
        read -r -p "$(echo -e "  ${BRAND_MINT}${prompt} [${default}]: ${NC}")" reply < /dev/tty
    else
        reply=""
    fi
    echo "${reply:-$default}"
}

# ── Parse Arguments ───────────────────────────────────────────────
show_help() {
    cat <<'HELP'
Gateway Monitoring Node Setup — installs monitoring-daemon and enrolls with Gateway

Usage:
  setup-monitoring-node.sh [options]

  In interactive mode (default), the script prompts for gateway address, port,
  and enrollment token. Use flags to pre-fill or skip prompts.

Options:
  --gateway <addr>         Gateway gRPC address as host:port (e.g. gateway.example.com:9443)
  --host <host>            Gateway hostname or IP (e.g. gateway.example.com)
  --port <port>            Gateway gRPC port (default: 9443)
  --token <token>          Enrollment token from Gateway UI (Admin > Nodes > Add Node)
  --version <ver>          Daemon version to install (default: latest)
  --user <user>            Run daemon as this user (default: root)
  --gitlab-url <url>       GitLab instance URL (default: https://gitlab.wiolett.net)
  --gitlab-project <proj>  GitLab project path (default: wiolett/gateway)
  --no-logo                Suppress the logo banner
  -y, --yes                Non-interactive mode (no prompts, all values required via flags)
  -h, --help               Show this help

Environment variables:
  GATEWAY_NODE_HOST             Same as --host
  GATEWAY_NODE_PORT             Same as --port (default: 9443)
  GATEWAY_NODE_ADDRESS          Same as --gateway (host:port combined)
  GATEWAY_NODE_TOKEN            Same as --token
  GATEWAY_NODE_DAEMON_VERSION   Same as --version
  GATEWAY_GITLAB_URL            Same as --gitlab-url
  GATEWAY_GITLAB_PROJECT        Same as --gitlab-project

Examples:
  # Interactive (prompts for everything):
  sudo bash setup-monitoring-node.sh

  # Partially interactive (pre-fill host, prompt for token):
  sudo bash setup-monitoring-node.sh --host gateway.example.com

  # Fully non-interactive:
  sudo bash setup-monitoring-node.sh -y --host gateway.example.com --token gw_node_abc123

  # Custom GitLab and user:
  sudo bash setup-monitoring-node.sh --gitlab-url https://git.example.com --user monitor --gateway gw:9443 --token TOKEN
HELP
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --gateway)        GATEWAY_ADDR="$2"; shift 2 ;;
        --host)           GATEWAY_HOST="$2"; shift 2 ;;
        --port)           GATEWAY_PORT="$2"; shift 2 ;;
        --token)          ENROLL_TOKEN="$2"; shift 2 ;;
        --version)        DAEMON_VERSION="$2"; shift 2 ;;
        --user)           RUN_USER="$2"; shift 2 ;;
        --gitlab-url)     GITLAB_URL="$2"; shift 2 ;;
        --gitlab-project) GITLAB_PROJECT="$2"; shift 2 ;;
        --no-logo)        NO_LOGO=1; shift ;;
        -y|--yes)         NON_INTERACTIVE=1; NO_LOGO=1; shift ;;
        -h|--help)        show_help ;;
        *) die "Unknown option: $1. Use --help for usage." ;;
    esac
done

# Resolve GATEWAY_ADDR from --host/--port if --gateway not given
if [[ -n "$GATEWAY_HOST" && -z "$GATEWAY_ADDR" ]]; then
    GATEWAY_ADDR="${GATEWAY_HOST}:${GATEWAY_PORT}"
fi
# If --gateway was given, extract host/port for display
if [[ -n "$GATEWAY_ADDR" && -z "$GATEWAY_HOST" ]]; then
    GATEWAY_HOST="${GATEWAY_ADDR%%:*}"
    GATEWAY_PORT="${GATEWAY_ADDR##*:}"
    if [[ "$GATEWAY_PORT" == "$GATEWAY_HOST" ]]; then
        GATEWAY_PORT="9443"
        GATEWAY_ADDR="${GATEWAY_HOST}:${GATEWAY_PORT}"
    fi
fi

# ── Validate ──────────────────────────────────────────────────────
need_root
detect_os
detect_arch
check_dependencies
build_gitlab_api
detect_existing_install

if [[ -z "$GATEWAY_ADDR" && -n "$EXISTING_GATEWAY_ADDR" ]]; then
    GATEWAY_ADDR="$EXISTING_GATEWAY_ADDR"
    GATEWAY_HOST="${GATEWAY_ADDR%%:*}"
    GATEWAY_PORT="${GATEWAY_ADDR##*:}"
    if [[ "$GATEWAY_PORT" == "$GATEWAY_HOST" ]]; then
        GATEWAY_PORT="9443"
        GATEWAY_ADDR="${GATEWAY_HOST}:${GATEWAY_PORT}"
    fi
fi

: > "$LOG_FILE"

# ── Logo ──────────────────────────────────────────────────────────
if [[ "$NO_LOGO" -eq 0 ]]; then
    if [ -t 1 ] && command_exists clear; then
        clear
    fi
    show_logo
    title "Gateway Monitoring Node Setup"
fi

# ── Interactive configuration ─────────────────────────────────────
if [[ "$NON_INTERACTIVE" -eq 0 ]]; then
    echo -e "  ${GRAY}This script will:${NC}"
    echo -e "  ${GRAY}  1. Download and install the monitoring-daemon binary${NC}"
    echo -e "  ${GRAY}  2. Enroll this node with your Gateway server${NC}"
    echo -e "  ${GRAY}  3. Start the daemon as a systemd service${NC}"
    echo -e "  ${GRAY}  No nginx or other software is required.${NC}"
    echo ""

    if [[ "$EXISTING_ENROLLED" -eq 1 && -n "$EXISTING_GATEWAY_ADDR" && -z "$ENROLL_TOKEN" ]]; then
        log "Existing enrolled monitoring node detected — reusing current gateway configuration"
    else
        # Gateway host
        if [[ -z "$GATEWAY_HOST" ]]; then
            GATEWAY_HOST=$(prompt_input "Gateway hostname or IP" "")
            [[ -z "$GATEWAY_HOST" ]] && die "Gateway hostname is required"
        else
            echo -e "  ${GRAY}Gateway host: ${BRAND_MINT}${GATEWAY_HOST}${NC}"
        fi

        # Gateway port
        GATEWAY_PORT=$(prompt_input "gRPC port" "${GATEWAY_PORT}")
        [[ -z "$GATEWAY_PORT" ]] && GATEWAY_PORT="9443"

        GATEWAY_ADDR="${GATEWAY_HOST}:${GATEWAY_PORT}"

        echo ""

        # Enrollment token
        if [[ -z "$ENROLL_TOKEN" ]]; then
            ENROLL_TOKEN=$(prompt_secret "Enrollment token (from Admin > Nodes)")
            [[ -z "$ENROLL_TOKEN" ]] && die "Enrollment token is required"
        else
            echo -e "  ${GRAY}Token: ${ENROLL_TOKEN:0:12}...${ENROLL_TOKEN: -4}${NC}"
        fi

        echo ""
    fi

    # Daemon version
    DAEMON_VERSION=$(prompt_input "Daemon version" "${DAEMON_VERSION}")

    echo ""

    # User selection
    if [[ -z "$RUN_USER" ]]; then
        echo -e "  ${GRAY}Run daemon as:${NC}"
        echo -e "    ${BRAND_MINT}1)${NC} root  ${GRAY}[default]${NC}"
        echo -e "    ${BRAND_MINT}2)${NC} Current user ($(logname 2>/dev/null || echo "$SUDO_USER"))"
        echo -e "    ${BRAND_MINT}3)${NC} Custom user"
        echo ""
        user_choice=$(prompt_choice "Choose" "1")
        case "$user_choice" in
            1|root)   RUN_USER="root" ;;
            2)        RUN_USER="$(logname 2>/dev/null || echo "${SUDO_USER:-root}")" ;;
            3)        RUN_USER=$(prompt_input "Username" ""); [[ -z "$RUN_USER" ]] && die "Username is required" ;;
            *)        RUN_USER="root" ;;
        esac
        echo ""
    fi
else
    # Non-interactive: validate required fields
    if [[ -z "$GATEWAY_ADDR" && "$EXISTING_ENROLLED" -eq 0 ]]; then
        die "--gateway or --host is required in non-interactive mode"
    fi
    if [[ -z "$ENROLL_TOKEN" && "$EXISTING_ENROLLED" -eq 0 ]]; then
        die "--token is required in non-interactive mode"
    fi
    [[ -z "$RUN_USER" ]] && RUN_USER="root"
fi

# ── Resolve run user/group ────────────────────────────────────────
RUN_GROUP=""
if [[ "$RUN_USER" == "root" ]]; then
    RUN_GROUP="root"
else
    if ! id "$RUN_USER" &>/dev/null; then
        die "User '$RUN_USER' does not exist. Create it first or choose a different user."
    fi
    RUN_GROUP=$(id -gn "$RUN_USER" 2>/dev/null)
fi

resolve_download_url "$DAEMON_VERSION"
detect_existing_install

# ── Confirmation ──────────────────────────────────────────────────
if [[ "$EXISTING_INSTALL" -eq 1 ]]; then
    log "Existing monitoring-daemon installation detected"
    echo -e "  ${GRAY}Current version: ${BRAND_MINT}${EXISTING_VERSION}${NC}"
    echo -e "  ${GRAY}Version to install: ${BRAND_MINT}${RESOLVED_DAEMON_VERSION}${NC}"
    echo ""
fi

echo -e "  ${BOLD}Configuration Summary${NC}"
echo -e "  ${GRAY}────────────────────────────────────────${NC}"
echo -e "  Gateway:     ${BRAND_MINT}${GATEWAY_ADDR}${NC}"
if [[ -n "$ENROLL_TOKEN" ]]; then
    echo -e "  Token:       ${GRAY}${ENROLL_TOKEN:0:12}...${NC}"
else
    echo -e "  Token:       ${GRAY}existing enrollment${NC}"
fi
echo -e "  Arch:        ${ARCH}"
echo -e "  OS:          ${OS_ID}"
echo -e "  Install ver: ${RESOLVED_DAEMON_VERSION}"
echo -e "  Current ver: $([[ "$EXISTING_INSTALL" -eq 1 ]] && echo "${EXISTING_VERSION}" || echo "not installed")"
echo -e "  Mode:        $([[ "$EXISTING_INSTALL" -eq 1 ]] && echo "update" || echo "fresh install")"
echo -e "  Run as:      ${RUN_USER}:${RUN_GROUP}"
echo -e "  GitLab:      ${GITLAB_URL}"
echo -e "  ${GRAY}────────────────────────────────────────${NC}"
echo ""

if ! prompt_yes_no "Proceed with installation?" "Y"; then
    echo "  Aborted."
    exit 0
fi
echo ""

# ── Step 1: Create directories ────────────────────────────────────
create_directories() {
    log "Creating required directories..."
    mkdir -p /etc/monitoring-daemon/certs
    mkdir -p /var/lib/monitoring-daemon

    if [[ "$RUN_USER" != "root" ]]; then
        chown -R "${RUN_USER}:${RUN_GROUP}" /etc/monitoring-daemon
        chown -R "${RUN_USER}:${RUN_GROUP}" /var/lib/monitoring-daemon
    fi

    ok "Directories created"
}

# ── Step 2: Download monitoring-daemon binary ─────────────────────

verify_checksum() {
    local file="$1"
    local binary_name="$2"

    log "Verifying checksum..."
    local checksums_file="/tmp/gateway_checksums.txt"
    if curl -fsSL "${RELEASE_BASE}/checksums.txt" -o "$checksums_file" >> "$LOG_FILE" 2>&1; then
        local expected actual
        expected=$(grep "$binary_name" "$checksums_file" | awk '{print $1}')
        actual=$(sha256sum "$file" | awk '{print $1}')
        rm -f "$checksums_file"

        if [[ -z "$expected" ]]; then
            die "No checksum found for ${binary_name} in checksums.txt"
        fi

        if [[ "$expected" != "$actual" ]]; then
            die "Checksum verification failed! Expected: ${expected}, Got: ${actual}"
        fi
        ok "Checksum verified"
    else
        rm -f "$checksums_file"
        die "Could not download checksums.txt for checksum verification"
    fi
}

install_daemon() {
    local target="/usr/local/bin/monitoring-daemon"
    local binary_name="monitoring-daemon-linux-${ARCH}"

    if [[ -f "$target" ]]; then
        local existing_ver
        existing_ver=$("$target" version 2>/dev/null | awk '{print $2}' || echo "unknown")
        if [[ "$RESOLVED_DAEMON_VERSION" == "$existing_ver" ]]; then
            ok "monitoring-daemon already installed (${existing_ver})"
            return 0
        fi
        log "Upgrading monitoring-daemon from ${existing_ver} to ${RESOLVED_DAEMON_VERSION}..."
        # Backup existing binary
        local backup="${target}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$target" "$backup"
        ok "Backed up existing binary to ${backup}"
    else
        log "Downloading monitoring-daemon..."
    fi

    if curl -fsSL "$DOWNLOAD_URL" -o "${target}.tmp" >> "$LOG_FILE" 2>&1; then
        verify_checksum "${target}.tmp" "$binary_name"
        mv "${target}.tmp" "$target"
        chmod +x "$target"
        local ver
        ver=$("$target" version 2>/dev/null | awk '{print $2}' || echo "unknown")
        ok "monitoring-daemon installed (${ver})"
    else
        rm -f "${target}.tmp"
        warn "Failed to download from releases — you may need to install the binary manually"
        warn "Place the monitoring-daemon binary at ${target}"

        if [[ ! -f "$target" ]]; then
            die "monitoring-daemon binary not found at ${target}"
        fi
    fi
}

# ── Step 3: Install and enroll ────────────────────────────────────
enroll_daemon() {
    local target="/usr/local/bin/monitoring-daemon"

    # Check if already enrolled (certs exist)
    if [[ -f /etc/monitoring-daemon/certs/node.pem && -f /var/lib/monitoring-daemon/state.json ]]; then
        ok "Node already enrolled — skipping enrollment"
        return 0
    fi

    log "Writing config and enrolling with Gateway..."
    "$target" install --gateway "$GATEWAY_ADDR" --token "$ENROLL_TOKEN"
    ok "Config written to /etc/monitoring-daemon/config.yaml"
}

# ── Step 4: Start the daemon ──────────────────────────────────────
start_daemon() {
    log "Enabling and starting monitoring-daemon..."

    if command_exists systemctl; then
        cat > /etc/systemd/system/monitoring-daemon.service <<UNIT
[Unit]
Description=Gateway Monitoring Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
ExecStart=/usr/local/bin/monitoring-daemon run
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT

        systemctl daemon-reload >> "$LOG_FILE" 2>&1
        systemctl enable monitoring-daemon >> "$LOG_FILE" 2>&1
        systemctl restart monitoring-daemon >> "$LOG_FILE" 2>&1
        sleep 2

        if systemctl is-active --quiet monitoring-daemon; then
            ok "monitoring-daemon is running"
        else
            warn "monitoring-daemon may not have started. Check: journalctl -u monitoring-daemon -f"
        fi
    else
        warn "systemd not found — start the daemon manually: monitoring-daemon run"
    fi
}

# ── Run ───────────────────────────────────────────────────────────
create_directories
install_daemon
enroll_daemon
start_daemon

echo ""
echo -e "${GREEN}${BOLD}Monitoring node setup complete!${NC}"
echo ""
echo -e "  The node should appear as ${GREEN}online${NC} in Gateway within a few seconds."
echo -e "  Check status:  ${BRAND_MINT}systemctl status monitoring-daemon${NC}"
echo -e "  View logs:     ${BRAND_MINT}journalctl -u monitoring-daemon -f${NC}"
echo ""
