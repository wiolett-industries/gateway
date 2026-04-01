# Gateway

Self-hosted certificate manager and reverse proxy gateway.

> **Note:** The primary source of this project is [Wiolett GitLab](https://gitlab.wiolett.net/wiolett/gateway). The [GitHub repository](https://github.com/wiolett-industries/gateway) is a mirror for public visibility. Issues, feature requests, and pull requests are welcome on [GitHub](https://github.com/wiolett-industries/gateway/issues).

Gateway combines a full PKI (Certificate Authority) infrastructure with a reverse proxy manager — think Nginx Proxy Manager with a built-in CA. Issue and manage TLS certificates, configure proxy hosts, handle SSL termination, and monitor everything from a single interface.

## Screenshots

<table>
<tr>
<td align="center"><strong>Dashboard</strong></td>
<td align="center"><strong>Nginx Monitoring</strong></td>
</tr>
<tr>
<td><img src="docs/screenshots/dashboard.png" width="450" alt="Dashboard"></td>
<td><img src="docs/screenshots/nginx-monitoring.png" width="450" alt="Nginx Monitoring"></td>
</tr>
<tr>
<td align="center"><strong>Proxy Host Config</strong></td>
<td align="center"><strong>Settings</strong></td>
</tr>
<tr>
<td><img src="docs/screenshots/proxy-host.png" width="450" alt="Proxy Host Config"></td>
<td><img src="docs/screenshots/settings.png" width="450" alt="Settings"></td>
</tr>
</table>

## Features

**Reverse Proxy**
- Multi-node proxy management with Go daemon (`nginx-daemon`) on each host
- Proxy hosts with SSL termination, WebSocket support, custom headers, rewrites
- Redirect and 404 host types
- Health checks with configurable expected status/body
- Drag-and-drop host ordering with folder organization
- Nginx config templates with variables
- Access lists (IP rules, basic auth)
- Real-time Nginx logs and stats monitoring

**PKI / Certificate Authority**
- Create root and intermediate CAs (RSA-2048/4096, ECDSA P-256/P-384)
- Issue TLS server, TLS client, code-signing, and email certificates
- Certificate templates with custom extensions and policies
- CRL distribution and OCSP responder built-in
- Certificate export (PEM, PKCS#12, JKS)

**SSL Management**
- Let's Encrypt (ACME) certificates with HTTP-01 and DNS-01 challenges
- Upload custom certificates
- Link internal PKI certificates to proxy hosts
- Auto-renewal with configurable schedule

**Domain Management**
- Central domain registry with DNS status tracking
- Automatic DNS validation (A/AAAA/CNAME/CAA/MX/TXT)
- Domain usage tracking across proxy hosts and SSL certificates

**Node Management**
- Register and manage multiple proxy nodes from a central dashboard
- Go daemon runs on each host alongside native nginx
- gRPC communication with mTLS authentication (certs from internal CA)
- Enrollment via pre-shared token with trust-on-first-use
- Automatic reconnection with exponential backoff
- Nodes keep serving traffic when Gateway is offline
- Per-node health monitoring, stats, and log streaming

**AI Assistant** *(optional, disabled by default)*
- Natural language interface for all system operations — manage CAs, issue certificates, configure proxy hosts, and more through conversation
- Works with any OpenAI-compatible provider (OpenAI, Anthropic, local models, etc.)
- 30+ tools with destructive action approval flow and per-tool access control
- Asks clarifying questions with structured options before acting
- Built-in knowledge base the AI can query for system-specific context
- Web search integration (Tavily, Brave, Serper, Exa, or self-hosted SearXNG)
- Per-user approval bypass preferences, conversation save/restore, configurable rate limits
- Fully opt-in: enable in Settings > AI Assistant, configure a provider and API key. No data is sent anywhere until explicitly enabled by an admin.

**Administration**
- OIDC authentication (any OpenID Connect provider)
- Group-based access control with granular scopes (system-admin, admin, operator, viewer + custom groups)
- API tokens with per-scope and per-resource access control
- Full audit log (AI-initiated actions flagged separately)
- Expiry alerts and notifications
- In-app updates with one-click self-update

## Quick Start

### Prerequisites

- Docker with Compose v2
- OpenSSL
- An OIDC provider (Keycloak, Authentik, Auth0, etc.)

### Install

```bash
mkdir gateway && cd gateway
curl -sSLO https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/install.sh
bash install.sh
```

The installer offers two deployment modes:

1. **With domain** — installs nginx + daemon on the host, serves the management UI via HTTPS on your domain. Recommended for production.
2. **Direct access** — exposes the management UI on port 3000. Good for testing or when you'll add a domain later.

### Non-interactive install

With domain (Let's Encrypt):

```bash
bash install.sh -y \
  --domain gateway.example.com \
  --oidc-issuer https://id.example.com \
  --oidc-client-id gateway \
  --oidc-client-secret your-secret \
  --acme-email admin@example.com
```

With domain (custom certificate):

```bash
bash install.sh -y \
  --domain gateway.example.com \
  --oidc-issuer https://id.example.com \
  --oidc-client-id gateway \
  --oidc-client-secret your-secret \
  --ssl-cert /path/to/cert.pem \
  --ssl-key /path/to/key.pem
```

Direct access (no domain):

```bash
bash install.sh -y \
  --oidc-issuer https://id.example.com \
  --oidc-client-id gateway \
  --oidc-client-secret your-secret
```

All flags have environment variable alternatives (`GATEWAY_DOMAIN`, `GATEWAY_OIDC_ISSUER`, etc.). Run `bash install.sh --help` for the full list.

### Install a specific version

```bash
bash install.sh --version v1.6.0
```

## Architecture

Gateway runs as three Docker containers plus an optional Go daemon on each proxy node:

| Service | Image / Binary | Purpose |
|---------|---------------|---------|
| **app** | `gateway` | Node.js backend + React frontend (Hono) |
| **postgres** | `postgres:16-alpine` | Database |
| **redis** | `redis:7-alpine` | Session cache, rate limiting |
| **nginx-daemon** | Go binary on host | Manages host-native nginx via gRPC |

```
                  ┌──────────────────────────┐
                  │   Gateway (Docker)       │
                  │  ┌─────┐ ┌────┐ ┌─────┐ │
  :9443 (gRPC) ◄──┤  │ app │ │ pg │ │redis│ │
                  │  └──┬──┘ └────┘ └─────┘ │
                  └─────┼────────────────────┘
                        │ gRPC (mTLS)
              ┌─────────┼─────────┐
              ▼                   ▼
   ┌──────────────────┐  ┌──────────────────┐
   │  Node A (host)   │  │  Node B (host)   │
   │  nginx-daemon    │  │  nginx-daemon    │
   │  nginx (native)  │  │  nginx (native)  │
   │  :80 :443        │  │  :80 :443        │
   └──────────────────┘  └──────────────────┘
```

The app generates nginx configs and pushes them to daemons over gRPC. Each daemon writes configs to disk, tests with `nginx -t`, and reloads. Daemons connect outbound to Gateway — no inbound ports needed on proxy nodes (except 80/443 for traffic).

## Adding Proxy Nodes

Each proxy node runs **nginx** (native) and the **nginx-daemon** (Go binary) that receives configuration from the Gateway over gRPC with mTLS.

### Quick setup (recommended)

1. In the Gateway UI, go to **Admin > Nodes > Add Node** and copy the setup command
2. On the target host, paste and run it:

```bash
curl -sSL https://gateway.example.com/api/node/setup-script | \
  sudo bash -s -- --token <ENROLLMENT_TOKEN>
```

The script is served directly from your Gateway with the gRPC address pre-configured — no need to specify `--gateway` separately. It installs nginx, configures `stub_status` for monitoring, downloads the daemon binary, enrolls with the Gateway, and starts the systemd service. The node appears as **online** within seconds.

You can also specify the gateway address explicitly (useful if the API is behind a different hostname):

```bash
curl -sSL https://gateway.example.com/api/node/setup-script | \
  sudo bash -s -- --gateway gateway.example.com:9443 --token <TOKEN>
```

Non-interactive (CI/automation):

```bash
sudo bash setup-node.sh -y --token <TOKEN> --version v0.1.0
```

Run `bash setup-node.sh --help` for all options and environment variable alternatives.

### Manual setup

If you prefer step-by-step control:

<details>
<summary>Expand manual setup instructions</summary>

#### Step 1: Create the node in Gateway

1. Go to **Admin > Nodes > Add Node**
2. Select type **nginx**, optionally set a display name
3. Copy the **enrollment token** — it is shown only once

#### Step 2: Prepare the host

On the target machine (Debian/Ubuntu shown — adapt for your distro):

```bash
# Install nginx
apt-get update && apt-get install -y nginx

# Enable stub_status for monitoring (required for stats collection)
cat > /etc/nginx/conf.d/stub_status.conf << 'EOF'
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

# Create directories the daemon expects
mkdir -p /etc/nginx/conf.d/sites /etc/nginx/certs /etc/nginx/htpasswd /var/www/acme-challenge

# Reload nginx to pick up stub_status
nginx -t && systemctl reload nginx
```

#### Step 3: Install the daemon

Download the `nginx-daemon` binary for your platform from the [releases page](https://gitlab.wiolett.net/wiolett/gateway/-/releases) and place it at `/usr/local/bin/nginx-daemon`.

```bash
# Example for linux/amd64
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/releases/latest/downloads/nginx-daemon-linux-amd64 \
  -o /usr/local/bin/nginx-daemon
chmod +x /usr/local/bin/nginx-daemon
```

#### Step 4: Enroll the node

```bash
nginx-daemon install --gateway gateway.example.com:9443 --token <ENROLLMENT_TOKEN>
```

This writes the config to `/etc/nginx-daemon/config.yaml` (with the enrollment token) and creates a systemd service unit.

#### Step 5: Start the daemon

```bash
systemctl enable --now nginx-daemon
```

</details>

On first start the daemon:
1. Connects to the Gateway using the enrollment token (token validated server-side)
2. Receives an mTLS client certificate issued by the Gateway's internal CA
3. Clears the enrollment token from the config file (it is single-use)
4. Reconnects using the mTLS cert and registers with the Gateway
5. Receives a full config sync if any proxy hosts are assigned to it

The node appears as **online** in the Gateway UI. You can now assign proxy hosts to it.

### Daemon configuration reference

The config file is at `/etc/nginx-daemon/config.yaml` (or set `NGINX_DAEMON_CONFIG` env var):

```yaml
gateway:
  address: "gateway.example.com:9443"   # Gateway gRPC address
  token: ""                              # Enrollment token (cleared after first use)

tls:
  ca_cert: "/etc/nginx-daemon/certs/ca.pem"       # Gateway CA cert (written on enrollment)
  client_cert: "/etc/nginx-daemon/certs/node.pem"  # mTLS client cert (written on enrollment)
  client_key: "/etc/nginx-daemon/certs/node-key.pem"

nginx:
  config_dir: "/etc/nginx/conf.d/sites"   # Where proxy host configs are written
  certs_dir: "/etc/nginx/certs"            # Where SSL certificates are deployed
  logs_dir: "/var/log/nginx"               # Nginx log directory (for log streaming)
  global_config: "/etc/nginx/nginx.conf"   # Main nginx.conf (for remote config editing)
  binary: "/usr/sbin/nginx"                # Path to nginx binary
  stub_status_url: "http://127.0.0.1/nginx_status"  # For stats collection
  htpasswd_dir: "/etc/nginx/htpasswd"      # For access list basic auth
  acme_challenge_dir: "/var/www/acme-challenge"      # For ACME HTTP-01 challenges

state_dir: "/var/lib/nginx-daemon"   # Persistent state (node ID, cert expiry, config hash)
log_level: "info"                     # debug, info, warn, error
log_format: "json"                    # json or text
```

### Daemon commands

```bash
nginx-daemon run                       # Run the daemon (default)
nginx-daemon install --gateway <addr> --token <token>  # Write config + systemd unit
nginx-daemon version                   # Print version
```

### Verifying the node

After the daemon starts, check the node detail page in the Gateway UI:

- **Details tab** — hostname, daemon version, nginx version, health status bar
- **Monitoring tab** — CPU, memory, disk, network I/O, nginx connections and traffic stats
- **Configuration tab** — view and edit the node's `nginx.conf` remotely
- **Daemon Logs tab** — real-time daemon operational logs
- **Nginx Logs tab** — real-time access and error logs for all proxy hosts on this node

### Firewall requirements

| Direction | Port | Purpose |
|-----------|------|---------|
| Node → Gateway | 9443 (TCP) | gRPC control plane (outbound from node) |
| Internet → Node | 80, 443 (TCP) | HTTP/HTTPS traffic to proxy hosts |

The daemon connects **outbound** to the Gateway — no inbound ports needed on the node for management.

## Updating

From the UI: **Settings > Check for updates > Update** (admin only). The app pulls the new image and recreates its own container automatically.

Manually:

```bash
# Edit .env: GATEWAY_VERSION=v1.6.0
docker compose pull && docker compose up -d
```

## Configuration

The installer generates a `.env` file with all settings. Key configuration options:

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_URL` | `http://localhost:3000` | Public URL of the Gateway UI |
| `OIDC_ISSUER` | — | OIDC provider URL |
| `OIDC_CLIENT_ID` | — | OIDC client ID |
| `OIDC_CLIENT_SECRET` | — | OIDC client secret |
| `GRPC_PORT` | `9443` | gRPC server port for daemon communication |
| `ACME_EMAIL` | `admin@example.com` | Let's Encrypt email |
| `ACME_STAGING` | `false` | Use Let's Encrypt staging |
| `HEALTH_CHECK_INTERVAL_SECONDS` | `30` | Proxy health check interval |
| `DNS_CHECK_INTERVAL_SECONDS` | `300` | Domain DNS check interval |
| `EXPIRY_WARNING_DAYS` | `30` | Days before expiry to warn |
| `EXPIRY_CRITICAL_DAYS` | `7` | Days before expiry for critical alert |
| `ACME_RENEWAL_CRON` | `0 3 * * *` | ACME renewal schedule |
| `UPDATE_CHECK_INTERVAL_HOURS` | `4` | How often to check for updates |

## Development

### Prerequisites

- Node.js >= 24
- pnpm >= 9
- Go >= 1.24 (for nginx-daemon)
- Docker (for Postgres, Redis)
- protoc (for proto codegen)

### Setup

```bash
pnpm install
pnpm dev:infra        # Start Postgres, Redis, Nginx (dev mode)
pnpm db:migrate       # Run database migrations
pnpm dev:all          # Start backend + frontend dev servers
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev:all` | Start backend and frontend in parallel |
| `pnpm build` | Build backend and frontend |
| `pnpm build:all` | Build all projects (backend, frontend, daemon) |
| `pnpm build:daemon` | Build the Go nginx-daemon binary |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint all packages (biome) |
| `pnpm typecheck` | TypeScript type check |
| `pnpm proto` | Regenerate protobuf stubs from proto files |
| `pnpm db:generate` | Generate Drizzle ORM migration |
| `pnpm db:migrate` | Run database migrations |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm graph` | View Nx dependency graph |

### Project Structure

```
gateway/
├── packages/
│   ├── backend/          # Node.js/Hono REST API + gRPC server
│   ├── frontend/         # React + Vite SPA
│   └── daemons/
│       └── nginx/        # Go daemon for nginx management
├── proto/
│   └── gateway/v1/       # Protobuf service definitions
├── scripts/
│   ├── install.sh        # Gateway server installer
│   └── setup-node.sh     # Proxy node setup script
├── nx.json               # Nx monorepo config
└── docker-compose.yml    # Production deployment
```

### Tech Stack

- **Backend:** Hono, Drizzle ORM, PostgreSQL, Redis, gRPC (@grpc/grpc-js), Node.js
- **Frontend:** React 19, Vite, Tailwind CSS 4, shadcn/ui, Zustand
- **Daemon:** Go, gRPC, mTLS
- **Monorepo:** Nx, pnpm workspaces
- **Infrastructure:** Docker, Nginx, Let's Encrypt (ACME), Protobuf

## Roadmap

- [x] Opt-in AI assistant with tool calling, approval flows, and any OpenAI-compatible provider
- [x] Group-based permission system with granular scopes for users and API tokens
- [x] Multi-node proxy management with Go daemon and gRPC
- [ ] Bastion/SSH server management daemon
- [ ] Per-user quota management for AI assistant (token budgets, request limits)
- [ ] Webhook notifications with built-in templates (Discord, Telegram, Slack, email, and custom HTTP)
- [ ] Local authentication (username/password) as an alternative to OIDC

## License

Licensed under the [PolyForm Small Business License 1.0.0](LICENSE.md).

- Free for personal use, nonprofits, and small businesses (<10 people, <$100K revenue)
- Larger commercial use requires a separate license — contact [contact@wiolett.net](mailto:contact@wiolett.net)
- Attribution required — retain all copyright notices and credits

Copyright (c) 2021-2026 [Wiolett](https://wiolett.net)
