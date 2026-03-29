#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# ── Defaults ──────────────────────────────────────────────────────────
DEFAULT_IMAGE="registry.gitlab.wiolett.net/wiolett/gateway"
GITLAB_API="https://gitlab.wiolett.net/api/v4/projects/wiolett%2Fgateway"
VERSION=""
LOG_FILE="/tmp/gateway_install.log"
NO_LOGO=0
NON_INTERACTIVE=0

# Non-interactive config (set via flags or env vars)
OPT_DOMAIN="${GATEWAY_DOMAIN:-}"
OPT_PORT="${GATEWAY_PORT:-}"
OPT_ACME_EMAIL="${GATEWAY_ACME_EMAIL:-}"
OPT_OIDC_ISSUER="${GATEWAY_OIDC_ISSUER:-}"
OPT_OIDC_CLIENT_ID="${GATEWAY_OIDC_CLIENT_ID:-}"
OPT_OIDC_CLIENT_SECRET="${GATEWAY_OIDC_CLIENT_SECRET:-}"
OPT_ACME_STAGING="${GATEWAY_ACME_STAGING:-}"
OPT_SKIP_START="${GATEWAY_SKIP_START:-0}"
OPT_SSL_CERT="${GATEWAY_SSL_CERT:-}"
OPT_SSL_KEY="${GATEWAY_SSL_KEY:-}"
OPT_SSL_CHAIN="${GATEWAY_SSL_CHAIN:-}"

# ── Colors & Tags ─────────────────────────────────────────────────────
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m'
INFO_TAG='\033[47m\033[90m'       # light gray bg, dark gray text
WARN_TAG='\033[43m\033[30m'       # yellow bg, black text
ERROR_TAG='\033[41m\033[97m'      # red bg, white text
SUCCESS_TAG='\033[42m\033[97m'    # green bg, white text
TITLE_TAG='\033[46m\033[97m'      # cyan bg, white text

# ── Logo ──────────────────────────────────────────────────────────────
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
}

# ── Helpers ───────────────────────────────────────────────────────────
info()    { echo -e "${INFO_TAG} INFO ${NC} $1"; }
warn()    { echo -e "${WARN_TAG} WARN ${NC} $1"; }
success() { echo -e "${SUCCESS_TAG} OK ${NC} $1"; }
title()   { echo ""; echo -e "${TITLE_TAG} $1 ${NC}"; echo ""; }

error() {
    echo -e "${ERROR_TAG} ERROR ${NC} $1"
    exit 1
}

run_quiet() {
    if "$@" >>"$LOG_FILE" 2>&1; then
        return 0
    fi
    error "Command failed: $*\n  Check ${LOG_FILE} for details."
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
    local default="${2:-N}"
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

# ── Health check helper ───────────────────────────────────────────────
check_health() {
    local url="$1"
    if command -v curl &>/dev/null; then
        curl -sf "$url" > /dev/null 2>&1
    elif command -v wget &>/dev/null; then
        wget -qO /dev/null "$url" 2>/dev/null
    else
        docker compose exec -T app wget -qO- http://localhost:3000/health > /dev/null 2>&1
    fi
}

# ── Prerequisites ─────────────────────────────────────────────────────
check_prerequisites() {
    title "Prerequisites"

    local missing=0

    if command -v docker &>/dev/null; then
        info "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
    else
        error "Docker is not installed.\n  Install: https://docs.docker.com/engine/install/"
    fi

    if docker compose version &>/dev/null; then
        info "Docker Compose $(docker compose version --short 2>/dev/null || echo 'v2')"
    else
        error "Docker Compose v2 is required.\n  Install the docker-compose-plugin package."
    fi

    if command -v openssl &>/dev/null; then
        info "OpenSSL $(openssl version 2>/dev/null | awk '{print $2}')"
    else
        error "OpenSSL is required to generate security keys."
    fi
}

# ── Intro ─────────────────────────────────────────────────────────────
show_intro() {
    echo -e "  ${CYAN}Gateway${NC} — Certificate & Proxy Manager"
    echo ""
    echo -e "  ${GRAY}This installer will set up Gateway in the current directory:${NC}"
    echo -e "  ${GRAY}  1. Verify prerequisites (Docker, Docker Compose, OpenSSL)${NC}"
    echo -e "  ${GRAY}  2. Configure domain, authentication, and security${NC}"
    echo -e "  ${GRAY}  3. Generate configuration files${NC}"
    echo -e "  ${GRAY}  4. Pull images and start services${NC}"
    echo ""

    if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
        info "Running in non-interactive mode."
        return
    fi

    if ! prompt_yes_no "Continue?" "Y"; then
        info "Cancelled."
        exit 0
    fi
}

# ── Configuration ─────────────────────────────────────────────────────
gather_config() {
    title "Configuration"

    if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
        # Use flags/env vars directly — fall back to sensible defaults
        DOMAIN="${OPT_DOMAIN:-localhost}"
        APP_PORT="${OPT_PORT:-3000}"
        ACME_EMAIL="${OPT_ACME_EMAIL:-admin@example.com}"
        OIDC_ISSUER="${OPT_OIDC_ISSUER:-}"
        OIDC_CLIENT_ID="${OPT_OIDC_CLIENT_ID:-gateway}"
        OIDC_CLIENT_SECRET="${OPT_OIDC_CLIENT_SECRET:-}"
        ACME_STAGING="${OPT_ACME_STAGING:-false}"

        if [ "$DOMAIN" = "localhost" ]; then
            APP_URL="http://localhost:${APP_PORT}"
            ACME_STAGING="true"
        else
            APP_URL="https://${DOMAIN}"
        fi

        OIDC_REDIRECT_URI="${APP_URL}/auth/callback"

        info "Domain: ${DOMAIN}"
        info "Port: ${APP_PORT}"
        info "ACME email: ${ACME_EMAIL}"
        [ -n "$OIDC_ISSUER" ] && info "OIDC issuer: ${OIDC_ISSUER}" || warn "OIDC not configured. Set OIDC_* variables in .env before starting."
        info "ACME staging: ${ACME_STAGING}"
        return
    fi

    DOMAIN=$(prompt_input "Domain (e.g. gateway.example.com)" "localhost")

    if [ "$DOMAIN" = "localhost" ]; then
        APP_URL="http://localhost:3000"
    else
        APP_URL="https://${DOMAIN}"
    fi

    APP_PORT=$(prompt_input "Management UI port" "3000")
    ACME_EMAIL=$(prompt_input "Email for Let's Encrypt" "admin@example.com")

    echo ""

    # OIDC
    OIDC_ISSUER=""
    OIDC_CLIENT_ID=""
    OIDC_CLIENT_SECRET=""

    if prompt_yes_no "Configure OIDC authentication now?" "Y"; then
        OIDC_ISSUER=$(prompt_input "OIDC Issuer URL" "")
        OIDC_CLIENT_ID=$(prompt_input "OIDC Client ID" "gateway")
        OIDC_CLIENT_SECRET=$(prompt_secret "OIDC Client Secret")

        if [ -z "$OIDC_ISSUER" ]; then
            warn "No issuer URL entered. Set OIDC_ISSUER in .env before starting."
        fi
    else
        warn "OIDC not configured. Set OIDC_* variables in .env before starting."
    fi

    OIDC_REDIRECT_URI="${APP_URL}/auth/callback"

    echo ""

    # ACME staging
    if [ "$DOMAIN" = "localhost" ]; then
        ACME_STAGING="true"
    else
        if prompt_yes_no "Use Let's Encrypt staging? (for testing only, not valid certs)" "N"; then
            ACME_STAGING="true"
        else
            ACME_STAGING="false"
        fi
    fi
}

# ── Generate Secrets ──────────────────────────────────────────────────
generate_secrets() {
    title "Security"

    PKI_MASTER_KEY=$(openssl rand -hex 32)
    SESSION_SECRET=$(openssl rand -hex 32)
    DB_PASSWORD=$(openssl rand -hex 16)
    SETUP_TOKEN=$(openssl rand -hex 32)

    info "PKI Master Key generated"
    info "Session secret generated"
    info "Database password generated"
    info "Setup token generated"
}

# ── Write .env ────────────────────────────────────────────────────────
write_env() {
    cat > .env << ENVEOF
# Gateway Configuration
# Generated $(date -u +"%Y-%m-%d %H:%M:%S UTC")

# Image
GATEWAY_IMAGE=${GATEWAY_IMAGE:-$DEFAULT_IMAGE}
GATEWAY_VERSION=${VERSION}

# Server
PORT=3000
APP_PORT=${APP_PORT}
NODE_ENV=production
APP_URL=${APP_URL}
BIND_HOST=0.0.0.0

# Database
DB_PASSWORD=${DB_PASSWORD}
DATABASE_URL=postgres://gateway:${DB_PASSWORD}@postgres:5432/gateway

# Redis
REDIS_URL=redis://redis:6379

# OIDC Authentication
OIDC_ISSUER=${OIDC_ISSUER}
OIDC_CLIENT_ID=${OIDC_CLIENT_ID}
OIDC_CLIENT_SECRET=${OIDC_CLIENT_SECRET}
OIDC_REDIRECT_URI=${OIDC_REDIRECT_URI}
OIDC_SCOPES=openid email profile

# Session
SESSION_SECRET=${SESSION_SECRET}
SESSION_EXPIRY=2592000

# PKI Master Key (DO NOT CHANGE after initial setup)
PKI_MASTER_KEY=${PKI_MASTER_KEY}

# ACME / Let's Encrypt
ACME_EMAIL=${ACME_EMAIL}
ACME_STAGING=${ACME_STAGING}

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=5000

# PKI Defaults
DEFAULT_CRL_VALIDITY_HOURS=24
DEFAULT_OCSP_VALIDITY_MINUTES=60
EXPIRY_WARNING_DAYS=30
EXPIRY_CRITICAL_DAYS=7

# Background Jobs
HEALTH_CHECK_INTERVAL_SECONDS=30
ACME_RENEWAL_CRON=0 3 * * *
EXPIRY_CHECK_CRON=0 6 * * *

# Setup token (for bootstrap API — management SSL provisioning)
SETUP_TOKEN=${SETUP_TOKEN}

# Nginx
NGINX_CONTAINER_NAME=gateway-nginx-1

# Updates
APP_VERSION=\${GATEWAY_VERSION}

# DNS (optional)
# DNS_RESOLVERS=8.8.8.8,1.1.1.1
# DNS_CHECK_INTERVAL_SECONDS=300
# PUBLIC_IPV4=
# PUBLIC_IPV6=
ENVEOF

    info ".env"
}

# ── Write docker-compose.yml ─────────────────────────────────────────
write_compose() {
    cat > docker-compose.yml << 'COMPOSEEOF'
services:
  app:
    image: ${GATEWAY_IMAGE}:${GATEWAY_VERSION}
    restart: unless-stopped
    ports:
      - "${BIND_HOST:-0.0.0.0}:${APP_PORT:-3000}:3000"
    env_file: .env
    volumes:
      - nginx_config:/etc/nginx-config
      - nginx_certs:/etc/nginx-certs
      - nginx_logs:/var/log/nginx-logs:ro
      - acme_challenge:/var/www/acme-challenge
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  nginx:
    image: nginx:1.27-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - ./nginx/html:/usr/share/nginx/html:ro
      - nginx_config:/etc/nginx/conf.d/sites
      - nginx_certs:/etc/nginx/certs
      - nginx_logs:/var/log/nginx
      - acme_challenge:/var/www/acme-challenge
    depends_on:
      app:
        condition: service_started
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: gateway
      POSTGRES_USER: gateway
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gateway -d gateway"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
  nginx_config:
  nginx_certs:
  nginx_logs:
  acme_challenge:
COMPOSEEOF

    info "docker-compose.yml"
}

# ── Write nginx configs ──────────────────────────────────────────────
write_nginx() {
    mkdir -p nginx/html

    # ── nginx.conf ──
    cat > nginx/nginx.conf << 'NGINXEOF'
worker_processes auto;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 50m;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml
        application/xml+rss
        image/svg+xml;

    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    # Docker internal DNS — re-resolve container IPs on restart
    resolver 127.0.0.11 valid=10s ipv6=off;
    resolver_timeout 5s;

    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/conf.d/sites/*.conf;
}
NGINXEOF

    # ── default.conf ──
    cat > nginx/default.conf << 'DEFAULTEOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location /.well-known/acme-challenge/ {
        alias /var/www/acme-challenge/;
    }

    location /health {
        access_log off;
        return 200 "OK\n";
        add_header Content-Type text/plain;
    }

    location /nginx_status {
        stub_status;
        allow 127.0.0.1;
        allow 172.16.0.0/12;
        allow 10.0.0.0/8;
        deny all;
        access_log off;
    }

    location / {
        root /usr/share/nginx/html;
        try_files /404.html =404;
    }

    error_page 404 /404.html;
    error_page 502 /502.html;

    location = /404.html {
        root /usr/share/nginx/html;
        internal;
    }

    location = /502.html {
        root /usr/share/nginx/html;
        internal;
    }
}
DEFAULTEOF

    # ── 404.html ──
    cat > nginx/html/404.html << 'HTML404EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 — Not Found</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: system-ui, -apple-system, sans-serif;
            background: #0e0e0e;
            color: #e5e5e5;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .page { text-align: center; padding: 2rem; }
        .code { font-size: 5rem; font-weight: 700; color: #e5e5e5; line-height: 1; }
        .message { font-size: 0.875rem; color: #a3a3a3; margin-top: 0.75rem; }
        .divider { width: 3rem; height: 1px; background: #2a2a2a; margin: 1.5rem auto; }
        .brand { font-size: 0.75rem; color: #525252; }
        .brand a { color: #a3a3a3; text-decoration: none; }
        .brand a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="page">
        <div class="code">404</div>
        <div class="message">The requested page was not found</div>
        <div class="divider"></div>
        <div class="brand">Gateway &middot; Powered by <a href="https://wiolett.net" target="_blank" rel="noopener noreferrer">Wiolett</a></div>
    </div>
</body>
</html>
HTML404EOF

    # ── 502.html ──
    cat > nginx/html/502.html << 'HTML502EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>502 — Bad Gateway</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: system-ui, -apple-system, sans-serif;
            background: #0e0e0e;
            color: #e5e5e5;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .page { text-align: center; padding: 2rem; }
        .code { font-size: 5rem; font-weight: 700; color: #e5e5e5; line-height: 1; }
        .message { font-size: 0.875rem; color: #a3a3a3; margin-top: 0.75rem; }
        .detail { font-size: 0.75rem; color: #525252; margin-top: 0.25rem; }
        .divider { width: 3rem; height: 1px; background: #2a2a2a; margin: 1.5rem auto; }
        .brand { font-size: 0.75rem; color: #525252; }
        .brand a { color: #a3a3a3; text-decoration: none; }
        .brand a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="page">
        <div class="code">502</div>
        <div class="message">The upstream server is not responding</div>
        <div class="detail">Please try again in a moment</div>
        <div class="divider"></div>
        <div class="brand">Gateway &middot; Powered by <a href="https://wiolett.net" target="_blank" rel="noopener noreferrer">Wiolett</a></div>
    </div>
</body>
</html>
HTML502EOF

    info "nginx configuration"
}

# ── Start Services ────────────────────────────────────────────────────
start_services() {
    title "Starting Services"

    info "Pulling Docker images..."
    run_quiet docker compose pull

    info "Starting services..."
    run_quiet docker compose up -d

    info "Waiting for services to become healthy (this may take a minute on first start)..."
    local retries=60
    local port="${APP_PORT:-3000}"
    printf "  "
    while [ $retries -gt 0 ]; do
        if check_health "http://localhost:${port}/health"; then
            break
        fi
        retries=$((retries - 1))
        printf "."
        sleep 3
    done
    echo ""

    if [ $retries -eq 0 ]; then
        echo ""
        warn "Services did not become healthy within 3 minutes."
        echo -e "  ${GRAY}Check logs:  docker compose logs${NC}"
        echo -e "  ${GRAY}Retry:       docker compose up -d${NC}"
        exit 1
    fi

    echo ""
    success "All services are healthy!"
}

# ── Bootstrap Management SSL ──────────────────────────────────────────
bootstrap_ssl() {
    local domain="$1"
    local port="${APP_PORT:-3000}"
    local token="${SETUP_TOKEN}"

    # Only for FQDN domains (not localhost)
    if [ "$domain" = "localhost" ] || ! echo "$domain" | grep -q '\.'; then
        return
    fi

    echo ""

    # Determine SSL method: letsencrypt, custom, or skip
    local ssl_method="letsencrypt"

    if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
        if [ -n "${OPT_SSL_CERT:-}" ] && [ -n "${OPT_SSL_KEY:-}" ]; then
            ssl_method="custom"
            info "Using custom certificate for ${domain}..."
        else
            info "Issuing Let's Encrypt certificate for ${domain}..."
        fi
    else
        echo -e "  ${CYAN}SSL certificate for ${domain}:${NC}"
        echo -e "  ${GRAY}  1) Let's Encrypt (automatic, requires DNS pointing here)${NC}"
        echo -e "  ${GRAY}  2) Custom certificate (e.g. Cloudflare Origin, self-signed)${NC}"
        echo -e "  ${GRAY}  3) Skip (configure later from UI)${NC}"
        echo ""
        local choice
        choice=$(prompt_input "Choose" "1")
        case "$choice" in
            2) ssl_method="custom" ;;
            3) info "Skipping SSL setup."; return ;;
            *) ssl_method="letsencrypt" ;;
        esac
    fi

    local http_code

    if [ "$ssl_method" = "custom" ]; then
        # Custom certificate flow
        local cert_file key_file chain_file=""

        if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
            cert_file="${OPT_SSL_CERT}"
            key_file="${OPT_SSL_KEY}"
            chain_file="${OPT_SSL_CHAIN:-}"
        else
            cert_file=$(prompt_input "Path to certificate PEM file" "")
            key_file=$(prompt_input "Path to private key PEM file" "")
            chain_file=$(prompt_input "Path to chain PEM file (optional, press Enter to skip)" "")
        fi

        if [ ! -f "$cert_file" ]; then
            warn "Certificate file not found: ${cert_file}"
            return
        fi
        if [ ! -f "$key_file" ]; then
            warn "Key file not found: ${key_file}"
            return
        fi

        info "Uploading custom certificate for ${domain}..."

        # Build JSON payload with cert contents
        local cert_pem key_pem chain_pem=""
        cert_pem=$(cat "$cert_file")
        key_pem=$(cat "$key_file")
        if [ -n "$chain_file" ] && [ -f "$chain_file" ]; then
            chain_pem=$(cat "$chain_file")
        fi

        local payload
        payload=$(python3 -c "
import json, sys
d = {'domain': sys.argv[1], 'certificatePem': sys.argv[2], 'privateKeyPem': sys.argv[3]}
if sys.argv[4]: d['chainPem'] = sys.argv[4]
print(json.dumps(d))
" "$domain" "$cert_pem" "$key_pem" "$chain_pem" 2>/dev/null) || \
        payload=$(node -e "
const d = {domain:process.argv[1],certificatePem:process.argv[2],privateKeyPem:process.argv[3]};
if(process.argv[4]) d.chainPem=process.argv[4];
console.log(JSON.stringify(d));
" "$domain" "$cert_pem" "$key_pem" "$chain_pem" 2>/dev/null) || {
            warn "Failed to encode certificate. Ensure python3 or node is available."
            return
        }

        http_code=$(curl -s -o /tmp/gateway_ssl_response.json -w "%{http_code}" \
            -X POST "http://localhost:${port}/api/setup/management-ssl-upload" \
            -H "Authorization: Bearer ${token}" \
            -H "Content-Type: application/json" \
            -d "$payload" \
            --max-time 30 2>>"$LOG_FILE") || true
    else
        # Let's Encrypt flow
        info "Requesting ACME certificate for ${domain}..."
        info "This may take up to 60 seconds..."

        http_code=$(curl -s -o /tmp/gateway_ssl_response.json -w "%{http_code}" \
            -X POST "http://localhost:${port}/api/setup/management-ssl" \
            -H "Authorization: Bearer ${token}" \
            -H "Content-Type: application/json" \
            -d "{\"domain\":\"${domain}\"}" \
            --max-time 120 2>>"$LOG_FILE") || true
    fi

    if [ "$http_code" = "200" ]; then
        success "SSL certificate configured!"
        info "Management UI is now accessible at https://${domain}"

        # Update .env: APP_URL to https, bind backend to localhost only
        if grep -q "^APP_URL=http://" .env 2>/dev/null; then
            sed -i "s|^APP_URL=http://.*|APP_URL=https://${domain}|" .env
            APP_URL="https://${domain}"
        fi
        # Restrict app port to localhost on host (nginx handles external traffic)
        sed -i 's|0\.0\.0\.0:\${APP_PORT:-3000}:3000|127.0.0.1:${APP_PORT:-3000}:3000|' docker-compose.yml
        info "App port restricted to localhost on host (nginx handles external traffic)"

        # Recreate app with updated port binding
        run_quiet docker compose up -d app
    else
        local response
        response=$(cat /tmp/gateway_ssl_response.json 2>/dev/null || echo "No response")
        warn "SSL setup failed (HTTP ${http_code})."
        echo -e "  ${GRAY}Response: ${response}${NC}"
        if [ "$ssl_method" = "letsencrypt" ]; then
            echo -e "  ${GRAY}Ensure DNS for ${domain} points to this server.${NC}"
        fi
        echo -e "  ${GRAY}You can configure SSL later from the Gateway UI.${NC}"
    fi

    rm -f /tmp/gateway_ssl_response.json
}

# ── Summary ───────────────────────────────────────────────────────────
show_summary() {
    local port="${APP_PORT:-3000}"

    echo ""
    echo -e "${SUCCESS_TAG} SUCCESS ${NC} Gateway is running!"
    echo ""
    echo -e "  Management UI   ${CYAN}${APP_URL}${NC}"
    echo -e "  Proxy (HTTP)    ${CYAN}:80${NC}"
    echo -e "  Proxy (HTTPS)   ${CYAN}:443${NC}"
    echo ""
    echo -e "  ${GRAY}Useful commands:${NC}"
    echo -e "  ${GRAY}  docker compose logs -f          View logs${NC}"
    echo -e "  ${GRAY}  docker compose restart           Restart services${NC}"
    echo -e "  ${GRAY}  docker compose pull && \\${NC}"
    echo -e "  ${GRAY}    docker compose up -d           Update to latest version${NC}"
    echo ""
    echo -e "  ${WARN_TAG} IMPORTANT ${NC}"
    echo -e "  ${GRAY}  PKI Master Key is stored in .env — back it up securely!${NC}"
    echo -e "  ${GRAY}  First OIDC login automatically becomes admin.${NC}"
    echo ""
    info "Log file: ${LOG_FILE}"
    echo ""
}

# ── Main ──────────────────────────────────────────────────────────────
main() {
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --version|-v)
                VERSION="$2"
                shift 2
                ;;
            --image)
                GATEWAY_IMAGE="$2"
                shift 2
                ;;
            --domain)
                OPT_DOMAIN="$2"
                shift 2
                ;;
            --port)
                OPT_PORT="$2"
                shift 2
                ;;
            --acme-email)
                OPT_ACME_EMAIL="$2"
                shift 2
                ;;
            --oidc-issuer)
                OPT_OIDC_ISSUER="$2"
                shift 2
                ;;
            --oidc-client-id)
                OPT_OIDC_CLIENT_ID="$2"
                shift 2
                ;;
            --oidc-client-secret)
                OPT_OIDC_CLIENT_SECRET="$2"
                shift 2
                ;;
            --acme-staging)
                OPT_ACME_STAGING="true"
                shift
                ;;
            --ssl-cert)
                OPT_SSL_CERT="$2"
                shift 2
                ;;
            --ssl-key)
                OPT_SSL_KEY="$2"
                shift 2
                ;;
            --ssl-chain)
                OPT_SSL_CHAIN="$2"
                shift 2
                ;;
            --skip-start)
                OPT_SKIP_START=1
                shift
                ;;
            --non-interactive|-y)
                NON_INTERACTIVE=1
                NO_LOGO=1
                shift
                ;;
            --no-logo)
                NO_LOGO=1
                shift
                ;;
            -h|--help)
                echo "Usage: install.sh [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --version, -v <tag>     Image version to install (default: auto-detect latest)"
                echo "  --image <image>         Custom image reference"
                echo "  --no-logo               Suppress the logo banner"
                echo "  -h, --help              Show this help"
                echo ""
                echo "Non-interactive mode:"
                echo "  -y, --non-interactive   Skip all prompts, use flags/env vars for config"
                echo "  --domain <domain>       Management domain (default: localhost)"
                echo "  --port <port>           Management UI port (default: 3000)"
                echo "  --acme-email <email>    Let's Encrypt email (default: admin@example.com)"
                echo "  --oidc-issuer <url>     OIDC issuer URL"
                echo "  --oidc-client-id <id>   OIDC client ID (default: gateway)"
                echo "  --oidc-client-secret <s> OIDC client secret"
                echo "  --acme-staging          Use Let's Encrypt staging environment"
                echo "  --ssl-cert <path>       Custom SSL certificate PEM file (BYO cert)"
                echo "  --ssl-key <path>        Custom SSL private key PEM file"
                echo "  --ssl-chain <path>      Custom SSL chain PEM file (optional)"
                echo "  --skip-start            Generate files only, don't start services"
                echo ""
                echo "Environment variables (alternative to flags):"
                echo "  GATEWAY_DOMAIN, GATEWAY_PORT, GATEWAY_ACME_EMAIL,"
                echo "  GATEWAY_OIDC_ISSUER, GATEWAY_OIDC_CLIENT_ID,"
                echo "  GATEWAY_OIDC_CLIENT_SECRET, GATEWAY_ACME_STAGING,"
                echo "  GATEWAY_SSL_CERT, GATEWAY_SSL_KEY, GATEWAY_SSL_CHAIN,"
                echo "  GATEWAY_SKIP_START"
                echo ""
                echo "Examples:"
                echo "  # Let's Encrypt:"
                echo "  bash install.sh -y --domain gateway.example.com \\"
                echo "    --oidc-issuer https://id.example.com --oidc-client-secret s3cret"
                echo ""
                echo "  # BYO certificate (e.g. Cloudflare Origin):"
                echo "  bash install.sh -y --domain gateway.example.com \\"
                echo "    --ssl-cert /path/to/cert.pem --ssl-key /path/to/key.pem"
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    : > "$LOG_FILE"

    [[ "$NO_LOGO" -eq 0 ]] && show_logo

    show_intro

    check_prerequisites

    # Check for existing installation
    if [ -f .env ]; then
        echo ""
        warn "Existing .env file detected."
        if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
            info "Non-interactive mode: overwriting existing .env."
        elif ! prompt_yes_no "Overwrite configuration?" "N"; then
            info "Keeping existing .env. Updating compose and nginx files only."
            title "Writing Files"
            write_compose
            write_nginx
            if [[ "$OPT_SKIP_START" -eq 0 ]]; then
                start_services
            else
                info "Skipping service start (--skip-start)."
            fi
            # Read APP_URL from existing .env for summary
            APP_URL=$(grep -E '^APP_URL=' .env | cut -d= -f2- || echo "http://localhost:3000")
            APP_PORT=$(grep -E '^APP_PORT=' .env | cut -d= -f2- || echo "3000")
            show_summary
            return
        fi
        echo ""
    fi

    # Resolve version if not specified
    if [ -z "$VERSION" ]; then
        info "Fetching latest version..."
        VERSION=$(curl -sf "${GITLAB_API}/releases" 2>/dev/null \
            | grep -o '"tag_name":"[^"]*"' | head -1 | cut -d'"' -f4) || true
        if [ -z "$VERSION" ]; then
            warn "Could not fetch latest version, falling back to 'latest' tag"
            VERSION="latest"
        else
            info "Latest version: ${VERSION}"
        fi
    fi

    gather_config

    generate_secrets

    title "Writing Files"

    write_env
    write_compose
    write_nginx

    if [[ "$OPT_SKIP_START" -eq 0 ]]; then
        start_services
        bootstrap_ssl "$DOMAIN"
    else
        info "Skipping service start (--skip-start)."
    fi

    show_summary
}

main "$@"
