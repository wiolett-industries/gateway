#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# ── Gateway Nginx Node Setup ─────────────────────────────────────────
# Installs nginx + nginx-daemon on a host and enrolls it with the Gateway.
#
# Usage:
#   curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/setup-node.sh | \
#     bash -s -- --gateway gateway.example.com:9443 --token <ENROLLMENT_TOKEN>
#
# Or download and run:
#   bash setup-node.sh --gateway gateway.example.com:9443 --token <TOKEN>
# ──────────────────────────────────────────────────────────────────────

LOG_FILE="/tmp/gateway_node_setup.log"

# ── Colors ───────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m'
BOLD='\033[1m'

# ── Defaults ─────────────────────────────────────────────────────────
GATEWAY_HOST="${GATEWAY_NODE_HOST:-}"
GATEWAY_PORT="${GATEWAY_NODE_PORT:-9443}"
GATEWAY_ADDR="${GATEWAY_NODE_ADDRESS:-}"
ENROLL_TOKEN="${GATEWAY_NODE_TOKEN:-}"
DAEMON_VERSION="${GATEWAY_NODE_DAEMON_VERSION:-latest}"
SKIP_NGINX="${GATEWAY_NODE_SKIP_NGINX:-0}"
GITLAB_URL="${GATEWAY_GITLAB_URL:-https://gitlab.wiolett.net}"
GITLAB_PROJECT="${GATEWAY_GITLAB_PROJECT:-wiolett/gateway}"
RUN_USER=""
NGINX_REPO=""
NON_INTERACTIVE=0
NO_LOGO=0

# ── Helpers ──────────────────────────────────────────────────────────
log()  { echo -e "${CYAN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }

die() { err "$@"; exit 1; }

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
            read -r -p "$(echo -e "  ${CYAN}${prompt} [${default}]: ${NC}")" result < /dev/tty
        else
            read -r -p "$(echo -e "  ${CYAN}${prompt}: ${NC}")" result < /dev/tty
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
        read -rs -p "$(echo -e "  ${CYAN}${prompt}: ${NC}")" result < /dev/tty
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
            read -r -p "$(echo -e "  ${CYAN}${prompt} [Y/n]: ${NC}")" reply < /dev/tty
            reply="${reply:-Y}"
        else
            read -r -p "$(echo -e "  ${CYAN}${prompt} [y/N]: ${NC}")" reply < /dev/tty
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
    local options=("$@")
    local reply
    if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
        echo "$default"
        return
    fi
    if [ -e /dev/tty ]; then
        read -r -p "$(echo -e "  ${CYAN}${prompt} [${default}]: ${NC}")" reply < /dev/tty
    else
        reply=""
    fi
    echo "${reply:-$default}"
}

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
    if ! command_exists curl; then
        die "curl is required but not found. Install it and retry."
    fi
}

build_gitlab_api() {
    local encoded_project="${GITLAB_PROJECT//\//%2F}"
    GITLAB_API="${GITLAB_URL}/api/v4/projects/${encoded_project}"
}

# ── Parse Arguments ──────────────────────────────────────────────────
show_help() {
    cat <<'HELP'
Gateway Node Setup — installs nginx + nginx-daemon and enrolls with Gateway

Usage:
  setup-node.sh [options]

  In interactive mode (default), the script prompts for gateway address, port,
  and enrollment token. Use flags to pre-fill or skip prompts.

Options:
  --gateway <addr>         Gateway gRPC address as host:port (e.g. gateway.example.com:9443)
  --host <host>            Gateway hostname or IP (e.g. gateway.example.com)
  --port <port>            Gateway gRPC port (default: 9443)
  --token <token>          Enrollment token from Gateway UI (Admin > Nodes > Add Node)
  --version <ver>          Daemon version to install (default: latest)
  --user <user>            Run daemon as this user (default: root)
  --skip-nginx             Skip nginx installation (if already installed)
  --nginx-repo <type>      Nginx repo: system, stable, or custom (default: interactive)
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
  GATEWAY_NODE_SKIP_NGINX       Set to 1 to skip nginx install
  GATEWAY_GITLAB_URL            Same as --gitlab-url
  GATEWAY_GITLAB_PROJECT        Same as --gitlab-project

Examples:
  # Interactive (prompts for everything):
  sudo bash setup-node.sh

  # Partially interactive (pre-fill host, prompt for token):
  sudo bash setup-node.sh --host gateway.example.com

  # Fully non-interactive:
  sudo bash setup-node.sh -y --host gateway.example.com --token gw_node_abc123

  # Legacy format (host:port combined):
  sudo bash setup-node.sh --gateway gateway.example.com:9443 --token gw_node_abc123

  # Custom GitLab and user:
  sudo bash setup-node.sh --gitlab-url https://git.example.com --user www-data --gateway gw:9443 --token TOKEN
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
        --skip-nginx)     SKIP_NGINX=1; shift ;;
        --nginx-repo)     NGINX_REPO="$2"; shift 2 ;;
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
    # If no port in the address, use default
    if [[ "$GATEWAY_PORT" == "$GATEWAY_HOST" ]]; then
        GATEWAY_PORT="9443"
        GATEWAY_ADDR="${GATEWAY_HOST}:${GATEWAY_PORT}"
    fi
fi

# ── Validate ─────────────────────────────────────────────────────────
need_root
detect_os
detect_arch
check_dependencies
build_gitlab_api

: > "$LOG_FILE"

# ── Logo ─────────────────────────────────────────────────────────────
if [[ "$NO_LOGO" -eq 0 ]]; then
    echo ""
    echo -e "${BOLD}${CYAN}"
    echo '  ┌─────────────────────────────────────┐'
    echo '  │     Gateway — Node Setup             │'
    echo '  │     Nginx Daemon Installer           │'
    echo '  └─────────────────────────────────────┘'
    echo -e "${NC}"
fi

# ── Interactive configuration ────────────────────────────────────────
if [[ "$NON_INTERACTIVE" -eq 0 ]]; then
    echo -e "  ${GRAY}This script will:${NC}"
    echo -e "  ${GRAY}  1. Install nginx (if not present)${NC}"
    echo -e "  ${GRAY}  2. Download and install the nginx-daemon binary${NC}"
    echo -e "  ${GRAY}  3. Enroll this node with your Gateway server${NC}"
    echo -e "  ${GRAY}  4. Start the daemon as a systemd service${NC}"
    echo ""

    # Gateway host
    if [[ -z "$GATEWAY_HOST" ]]; then
        GATEWAY_HOST=$(prompt_input "Gateway hostname or IP" "")
        [[ -z "$GATEWAY_HOST" ]] && die "Gateway hostname is required"
    else
        echo -e "  ${GRAY}Gateway host: ${CYAN}${GATEWAY_HOST}${NC}"
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

    # Daemon version
    DAEMON_VERSION=$(prompt_input "Daemon version" "${DAEMON_VERSION}")

    echo ""

    # User selection
    if [[ -z "$RUN_USER" ]]; then
        echo -e "  ${GRAY}Run daemon as:${NC}"
        echo -e "    ${CYAN}1)${NC} root  ${GRAY}[default]${NC}"
        echo -e "    ${CYAN}2)${NC} Current user ($(logname 2>/dev/null || echo "$SUDO_USER"))"
        echo -e "    ${CYAN}3)${NC} Custom user"
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

    # Nginx version selection
    if [[ -z "$NGINX_REPO" && "$SKIP_NGINX" -eq 0 ]]; then
        if ! command_exists nginx; then
            echo -e "  ${GRAY}Nginx version:${NC}"
            echo -e "    ${CYAN}1)${NC} System default  ${GRAY}[default]${NC}"
            echo -e "    ${CYAN}2)${NC} Stable (nginx.org official repo)"
            echo -e "    ${CYAN}3)${NC} Custom"
            echo ""
            nginx_choice=$(prompt_choice "Choose" "1")
            case "$nginx_choice" in
                1|system) NGINX_REPO="system" ;;
                2|stable) NGINX_REPO="stable" ;;
                3|custom) NGINX_REPO="custom" ;;
                *)        NGINX_REPO="system" ;;
            esac
            echo ""
        fi
    fi
else
    # Non-interactive: validate required fields
    if [[ -z "$GATEWAY_ADDR" ]]; then
        die "--gateway or --host is required in non-interactive mode"
    fi
    if [[ -z "$ENROLL_TOKEN" ]]; then
        die "--token is required in non-interactive mode"
    fi
    # Default user to root in non-interactive mode
    [[ -z "$RUN_USER" ]] && RUN_USER="root"
    [[ -z "$NGINX_REPO" ]] && NGINX_REPO="system"
fi

# ── Resolve run user/group ───────────────────────────────────────────
RUN_GROUP=""
if [[ "$RUN_USER" == "root" ]]; then
    RUN_GROUP="root"
else
    # Verify user exists
    if ! id "$RUN_USER" &>/dev/null; then
        die "User '$RUN_USER' does not exist. Create it first or choose a different user."
    fi
    RUN_GROUP=$(id -gn "$RUN_USER" 2>/dev/null)
fi

# ── Confirmation ─────────────────────────────────────────────────────
echo -e "  ${BOLD}Configuration Summary${NC}"
echo -e "  ${GRAY}────────────────────────────────────────${NC}"
echo -e "  Gateway:     ${CYAN}${GATEWAY_ADDR}${NC}"
echo -e "  Token:       ${GRAY}${ENROLL_TOKEN:0:12}...${NC}"
echo -e "  Arch:        ${ARCH}"
echo -e "  OS:          ${OS_ID}"
echo -e "  Daemon ver:  ${DAEMON_VERSION}"
echo -e "  Run as:      ${RUN_USER}:${RUN_GROUP}"
echo -e "  Skip nginx:  $([ "$SKIP_NGINX" -eq 1 ] && echo "yes" || echo "no")"
echo -e "  GitLab:      ${GITLAB_URL}"
echo -e "  ${GRAY}────────────────────────────────────────${NC}"
echo ""

if ! prompt_yes_no "Proceed with installation?" "Y"; then
    echo "  Aborted."
    exit 0
fi
echo ""

# ── Step 1: Install nginx ────────────────────────────────────────────
install_nginx_stable_repo() {
    log "Adding nginx.org stable repository..."
    case "$OS_LIKE" in
        *debian*|*ubuntu*)
            apt-get install -y -qq gnupg2 ca-certificates lsb-release >> "$LOG_FILE" 2>&1
            curl -fsSL https://nginx.org/keys/nginx_signing.key | gpg --dearmor -o /usr/share/keyrings/nginx-archive-keyring.gpg 2>> "$LOG_FILE"
            echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] http://nginx.org/packages/$(. /etc/os-release && echo "$ID") $(lsb_release -cs) nginx" \
                > /etc/apt/sources.list.d/nginx.list
            apt-get update -qq >> "$LOG_FILE" 2>&1
            ;;
        *rhel*|*fedora*|*centos*)
            cat > /etc/yum.repos.d/nginx.repo <<'REPO'
[nginx-stable]
name=nginx stable repo
baseurl=http://nginx.org/packages/centos/$releasever/$basearch/
gpgcheck=1
enabled=1
gpgkey=https://nginx.org/keys/nginx_signing.key
module_hotfixes=true
REPO
            ;;
        *)
            warn "Cannot add nginx.org repo for ${OS_ID}. Falling back to system package."
            ;;
    esac
}

install_nginx() {
    if command_exists nginx; then
        local ver
        ver=$(nginx -v 2>&1 | grep -oP 'nginx/\K[\d.]+' || echo "unknown")
        ok "nginx already installed (${ver})"
        return 0
    fi

    if [[ "$SKIP_NGINX" -eq 1 ]]; then
        warn "Skipping nginx install (--skip-nginx). Make sure nginx is available."
        return 0
    fi

    # Add stable repo if requested
    if [[ "$NGINX_REPO" == "stable" ]]; then
        install_nginx_stable_repo
    elif [[ "$NGINX_REPO" == "custom" ]]; then
        warn "Custom nginx repo selected — assuming repo is already configured."
    fi

    log "Installing nginx..."
    case "$OS_LIKE" in
        *debian*|*ubuntu*)
            apt-get update -qq >> "$LOG_FILE" 2>&1
            apt-get install -y -qq nginx >> "$LOG_FILE" 2>&1
            ;;
        *rhel*|*fedora*|*centos*)
            if command_exists dnf; then
                dnf install -y -q nginx >> "$LOG_FILE" 2>&1
            else
                yum install -y -q nginx >> "$LOG_FILE" 2>&1
            fi
            ;;
        *arch*)
            pacman -Sy --noconfirm nginx >> "$LOG_FILE" 2>&1
            ;;
        *alpine*)
            apk add --no-cache nginx >> "$LOG_FILE" 2>&1
            ;;
        *)
            die "Cannot auto-install nginx on ${OS_ID}. Install nginx manually and rerun with --skip-nginx."
            ;;
    esac

    systemctl enable nginx >> "$LOG_FILE" 2>&1 || true
    systemctl start nginx >> "$LOG_FILE" 2>&1 || true
    ok "nginx installed"
}

# ── Step 2: Configure nginx stub_status ──────────────────────────────
configure_stub_status() {
    local stub_conf="/etc/nginx/conf.d/stub_status.conf"

    # Check if stub_status is already configured somewhere
    if nginx -T 2>/dev/null | grep -q "stub_status" ; then
        ok "stub_status already configured"
        return 0
    fi

    log "Configuring nginx stub_status..."
    cat > "$stub_conf" << 'EOF'
server {
    listen 127.0.0.1:80;
    server_name localhost;
    location /nginx_status {
        stub_status;
        allow 127.0.0.1;
        deny all;
    }
}
EOF

    if nginx -t >> "$LOG_FILE" 2>&1; then
        systemctl reload nginx >> "$LOG_FILE" 2>&1 || nginx -s reload >> "$LOG_FILE" 2>&1 || true
        ok "stub_status configured"
    else
        warn "nginx config test failed after adding stub_status — check $LOG_FILE"
    fi
}

# ── Step 3: Create directories ───────────────────────────────────────
create_directories() {
    log "Creating required directories..."
    mkdir -p /etc/nginx/conf.d/sites
    mkdir -p /etc/nginx/certs
    mkdir -p /etc/nginx/htpasswd
    mkdir -p /var/www/acme-challenge/.well-known/acme-challenge
    mkdir -p /etc/nginx-daemon/certs
    mkdir -p /var/lib/nginx-daemon

    # Chown if non-root user
    if [[ "$RUN_USER" != "root" ]]; then
        chown -R "${RUN_USER}:${RUN_GROUP}" /etc/nginx-daemon
        chown -R "${RUN_USER}:${RUN_GROUP}" /var/lib/nginx-daemon
    fi

    ok "Directories created"
}

# ── Step 4: Download nginx-daemon binary ─────────────────────────────
resolve_download_url() {
    local version="$1"
    local binary_name="nginx-daemon-linux-${ARCH}"

    if [[ "$version" == "latest" ]]; then
        log "Resolving latest nginx release tag..."
        local latest_tag
        latest_tag=$(curl -fsSL "${GITLAB_API}/releases" | grep -o '"tag_name":"v[0-9]*\.[0-9]*\.[0-9]*-nginx"' | head -1 | cut -d'"' -f4)
        if [[ -z "$latest_tag" || "$latest_tag" == "null" ]]; then
            die "Could not resolve latest nginx release tag from ${GITLAB_API}/releases"
        fi
        log "Resolved tag: ${latest_tag}"
        RELEASE_BASE="${GITLAB_API}/releases/${latest_tag}/downloads"
    else
        RELEASE_BASE="${GITLAB_API}/releases/${version}-nginx/downloads"
    fi

    DOWNLOAD_URL="${RELEASE_BASE}/${binary_name}"
}

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
            warn "No checksum found for ${binary_name} in checksums.txt — skipping verification"
            return 0
        fi

        if [[ "$expected" != "$actual" ]]; then
            die "Checksum verification failed! Expected: ${expected}, Got: ${actual}"
        fi
        ok "Checksum verified"
    else
        rm -f "$checksums_file"
        warn "Could not download checksums.txt — skipping verification"
    fi
}

install_daemon() {
    local target="/usr/local/bin/nginx-daemon"
    local binary_name="nginx-daemon-linux-${ARCH}"

    if [[ -f "$target" ]]; then
        local existing_ver
        existing_ver=$("$target" version 2>/dev/null | awk '{print $2}' || echo "unknown")
        if [[ "$DAEMON_VERSION" == "latest" || "$DAEMON_VERSION" == "$existing_ver" ]]; then
            ok "nginx-daemon already installed (${existing_ver})"
            return 0
        fi
        log "Upgrading nginx-daemon from ${existing_ver} to ${DAEMON_VERSION}..."
        # Backup existing binary
        local backup="${target}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$target" "$backup"
        ok "Backed up existing binary to ${backup}"
    else
        log "Downloading nginx-daemon..."
    fi

    resolve_download_url "$DAEMON_VERSION"

    if curl -fsSL "$DOWNLOAD_URL" -o "${target}.tmp" >> "$LOG_FILE" 2>&1; then
        verify_checksum "${target}.tmp" "$binary_name"
        mv "${target}.tmp" "$target"
        chmod +x "$target"
        local ver
        ver=$("$target" version 2>/dev/null | awk '{print $2}' || echo "unknown")
        ok "nginx-daemon installed (${ver})"
    else
        rm -f "${target}.tmp"
        warn "Failed to download from releases — you may need to install the binary manually"
        warn "Place the nginx-daemon binary at ${target}"

        if [[ ! -f "$target" ]]; then
            die "nginx-daemon binary not found at ${target}"
        fi
    fi
}

# ── Step 5: Install and enroll ───────────────────────────────────────
enroll_daemon() {
    local target="/usr/local/bin/nginx-daemon"

    # Check if already enrolled (certs exist)
    if [[ -f /etc/nginx-daemon/certs/node.pem && -f /var/lib/nginx-daemon/state.json ]]; then
        ok "Node already enrolled — skipping enrollment"
        return 0
    fi

    log "Writing config and enrolling with Gateway..."
    "$target" install --gateway "$GATEWAY_ADDR" --token "$ENROLL_TOKEN"
    ok "Config written to /etc/nginx-daemon/config.yaml"
}

# ── Step 6: Start the daemon ─────────────────────────────────────────
start_daemon() {
    log "Enabling and starting nginx-daemon..."

    if command_exists systemctl; then
        # Write systemd unit with user/group support
        cat > /etc/systemd/system/nginx-daemon.service <<UNIT
[Unit]
Description=Gateway Nginx Daemon
After=network-online.target nginx.service
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
ExecStart=/usr/local/bin/nginx-daemon run
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT

        systemctl daemon-reload >> "$LOG_FILE" 2>&1
        systemctl enable nginx-daemon >> "$LOG_FILE" 2>&1
        systemctl restart nginx-daemon >> "$LOG_FILE" 2>&1
        sleep 2

        if systemctl is-active --quiet nginx-daemon; then
            ok "nginx-daemon is running"
        else
            warn "nginx-daemon may not have started. Check: journalctl -u nginx-daemon -f"
        fi
    else
        warn "systemd not found — start the daemon manually: nginx-daemon run"
    fi
}

# ── Run ──────────────────────────────────────────────────────────────
install_nginx
configure_stub_status
create_directories
install_daemon
enroll_daemon
start_daemon

echo ""
echo -e "${GREEN}${BOLD}Node setup complete!${NC}"
echo ""
echo -e "  The node should appear as ${GREEN}online${NC} in Gateway within a few seconds."
echo -e "  Check status:  ${CYAN}systemctl status nginx-daemon${NC}"
echo -e "  View logs:     ${CYAN}journalctl -u nginx-daemon -f${NC}"
echo ""
