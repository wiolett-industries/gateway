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

GITLAB_API="https://gitlab.wiolett.net/api/v4/projects/wiolett%2Fgateway"
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
GATEWAY_ADDR="${GATEWAY_NODE_ADDRESS:-}"
ENROLL_TOKEN="${GATEWAY_NODE_TOKEN:-}"
DAEMON_VERSION="${GATEWAY_NODE_DAEMON_VERSION:-latest}"
SKIP_NGINX="${GATEWAY_NODE_SKIP_NGINX:-0}"
NON_INTERACTIVE=0

# ── Helpers ──────────────────────────────────────────────────────────
log()  { echo -e "${CYAN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }

die() { err "$@"; exit 1; }

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

# ── Parse Arguments ──────────────────────────────────────────────────
show_help() {
    cat <<'HELP'
Gateway Node Setup — installs nginx + nginx-daemon and enrolls with Gateway

Usage:
  setup-node.sh --gateway <address:port> --token <enrollment-token> [options]

Required:
  --gateway <addr>     Gateway gRPC address (e.g. gateway.example.com:9443)
  --token <token>      Enrollment token from Gateway UI (Admin > Nodes > Add Node)

Options:
  --version <ver>      Daemon version to install (default: latest)
  --skip-nginx         Skip nginx installation (if already installed)
  -y, --yes            Non-interactive mode (no prompts)
  -h, --help           Show this help

Environment variables:
  GATEWAY_NODE_ADDRESS          Same as --gateway
  GATEWAY_NODE_TOKEN            Same as --token
  GATEWAY_NODE_DAEMON_VERSION   Same as --version
  GATEWAY_NODE_SKIP_NGINX       Set to 1 to skip nginx install
HELP
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --gateway)    GATEWAY_ADDR="$2"; shift 2 ;;
        --token)      ENROLL_TOKEN="$2"; shift 2 ;;
        --version)    DAEMON_VERSION="$2"; shift 2 ;;
        --skip-nginx) SKIP_NGINX=1; shift ;;
        -y|--yes)     NON_INTERACTIVE=1; shift ;;
        -h|--help)    show_help ;;
        *) die "Unknown option: $1. Use --help for usage." ;;
    esac
done

# ── Validate ─────────────────────────────────────────────────────────
need_root
detect_os
detect_arch

if [[ -z "$GATEWAY_ADDR" ]]; then
    if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
        die "--gateway is required"
    fi
    echo ""
    echo -e "${BOLD}Gateway Node Setup${NC}"
    echo -e "${GRAY}Installs nginx + nginx-daemon and enrolls this host with your Gateway.${NC}"
    echo ""
    read -rp "Gateway gRPC address (e.g. gateway.example.com:9443): " GATEWAY_ADDR
    [[ -z "$GATEWAY_ADDR" ]] && die "Gateway address is required"
fi

if [[ -z "$ENROLL_TOKEN" ]]; then
    if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
        die "--token is required"
    fi
    read -rp "Enrollment token (from Admin > Nodes > Add Node): " ENROLL_TOKEN
    [[ -z "$ENROLL_TOKEN" ]] && die "Enrollment token is required"
fi

echo ""
echo -e "${BOLD}Gateway Node Setup${NC}"
echo -e "${GRAY}────────────────────────────────────────${NC}"
echo -e "  Gateway:  ${CYAN}${GATEWAY_ADDR}${NC}"
echo -e "  Arch:     ${ARCH}"
echo -e "  OS:       ${OS_ID}"
echo -e "  Version:  ${DAEMON_VERSION}"
echo -e "${GRAY}────────────────────────────────────────${NC}"
echo ""

if [[ "$NON_INTERACTIVE" -eq 0 ]]; then
    read -rp "Continue? [Y/n] " confirm
    if [[ "${confirm,,}" == "n" ]]; then
        echo "Aborted."
        exit 0
    fi
fi

# ── Step 1: Install nginx ────────────────────────────────────────────
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
    ok "Directories created"
}

# ── Step 4: Download nginx-daemon binary ─────────────────────────────
install_daemon() {
    local target="/usr/local/bin/nginx-daemon"

    if [[ -f "$target" ]]; then
        local existing_ver
        existing_ver=$("$target" version 2>/dev/null | awk '{print $2}' || echo "unknown")
        if [[ "$DAEMON_VERSION" == "latest" || "$DAEMON_VERSION" == "$existing_ver" ]]; then
            ok "nginx-daemon already installed (${existing_ver})"
            return 0
        fi
        log "Upgrading nginx-daemon from ${existing_ver} to ${DAEMON_VERSION}..."
    else
        log "Downloading nginx-daemon..."
    fi

    local download_url
    if [[ "$DAEMON_VERSION" == "latest" ]]; then
        download_url="${GITLAB_API}/releases/permalink/latest/downloads/nginx-daemon-linux-${ARCH}"
    else
        download_url="${GITLAB_API}/releases/${DAEMON_VERSION}/downloads/nginx-daemon-linux-${ARCH}"
    fi

    if curl -fsSL "$download_url" -o "${target}.tmp" >> "$LOG_FILE" 2>&1; then
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
