# Gateway

Self-hosted certificate manager, reverse proxy, and Docker container management platform.

> **Note:** The primary source of this project is [Wiolett GitLab](https://gitlab.wiolett.net/wiolett/gateway). The [GitHub repository](https://github.com/wiolett-industries/gateway) is a mirror for public visibility. Issues, feature requests, and pull requests are welcome on [GitHub](https://github.com/wiolett-industries/gateway/issues).

Gateway combines a full PKI (Certificate Authority) infrastructure with a reverse proxy manager and Docker container management platform. Issue and manage TLS certificates, configure proxy hosts, handle SSL termination, deploy and manage Docker containers across multiple hosts, collect system metrics, and monitor everything from a single interface.

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

**Docker Container Management**
- Manage Docker containers across multiple hosts from the Gateway UI
- Deploy, start, stop, restart, recreate, and remove containers
- Edit environment variables, ports, mounts, labels, and restart policy
- Container log streaming with search and follow
- Webhook URLs for CI/CD — trigger container image pull and recreate from pipelines
- Auto-cleanup of old images with configurable retention

**PKI / Certificate Authority**
- Create root and intermediate CAs (RSA-2048/4096, ECDSA P-256/P-384)
- Issue TLS server, TLS client, code-signing, and email certificates
- Certificate templates with custom extensions and policies
- CRL distribution support built-in
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
- Three daemon types: **nginx** (reverse proxy), **docker** (container management), **monitoring** (system metrics)
- Register and manage nodes from a central dashboard
- Go daemons on each host, communicating over gRPC with mTLS
- Enrollment via pre-shared token with trust-on-first-use
- Automatic reconnection with exponential backoff
- Daemon self-update from the Gateway UI (SHA256-verified binary download, atomic replace, auto-restart)
- Version compatibility checks — incompatible nodes flagged in the UI
- Nodes keep serving traffic when Gateway is offline
- Per-node health monitoring, stats, and log streaming
- Real-time WebSocket event stream for live UI updates

**AI Assistant** *(optional, disabled by default)*
- Natural language interface for all system operations — manage CAs, issue certificates, configure proxy hosts, Docker containers, and more through conversation
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
- In-app gateway self-update and per-daemon remote updates

**External Logging** *(optional)*
- ClickHouse-backed structured log ingestion for external services
- UI-managed environments, schemas, retention, ingest tokens, and search
- Dedicated `gwl_` write-only ingest tokens separate from normal Gateway API tokens
- Strict severity enum, payload limits, per-token/environment/global rate limits, and partial batch acceptance

## Quick Start

### Prerequisites

- Docker with Compose v2
- OpenSSL
- An OIDC provider (Keycloak, Authentik, Auth0, etc.)

### Install Gateway

```bash
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/install.sh | bash
```

The interactive installer guides you through deployment mode, OIDC, SSL, resource limits, log rotation, and more. Run with `--help` for all options.

### Install a Node

After creating a node in the Gateway UI (**Nodes > Add Node**), run on the target host:

```bash
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/setup-daemon.sh | sudo bash
```

The script prompts for daemon type, gateway address, and enrollment token. For nginx nodes it also lets you choose between a fully managed nginx config or integration with an existing host nginx setup. See [Adding Nodes](#adding-nodes) for non-interactive usage and details.

### Non-interactive install

```bash
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/install.sh | bash -s -- -y \
  --domain gw.example.com \
  --oidc-issuer https://id.example.com \
  --oidc-client-id gateway \
  --oidc-client-secret your-secret \
  --acme-email admin@example.com
```

All flags have environment variable alternatives (`GATEWAY_DOMAIN`, `GATEWAY_OIDC_ISSUER`, etc.). Resource limits and logging can be set via `--resource-profile`, `--log-max-size`, `--log-max-file`.

### Install a specific version

```bash
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/install.sh | bash -s -- --version v2.0.0
```

## Architecture

Gateway runs as four Docker containers plus Go daemons on managed hosts:

| Service | Image / Binary | Purpose |
|---------|---------------|---------|
| **app** | `gateway` | Node.js backend + React frontend (Hono) |
| **postgres** | `postgres:16-alpine` | Database |
| **redis** | `redis:7-alpine` | Session cache, rate limiting |
| **clickhouse** | external / optional | Structured external log storage |
| **nginx-daemon** | Go binary on host | Manages host-native nginx via gRPC |
| **docker-daemon** | Go binary on host | Manages Docker containers via gRPC |
| **monitoring-daemon** | Go binary on host | Reports system metrics via gRPC |

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
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │  Nginx Node      │  │  Docker Node     │  │  Monitoring Node │
   │  nginx-daemon    │  │  docker-daemon   │  │  monitoring-     │
   │  nginx (native)  │  │  Docker engine   │  │    daemon        │
   │  :80 :443        │  │                  │  │                  │
   └──────────────────┘  └──────────────────┘  └──────────────────┘
```

All daemons connect outbound to the Gateway over gRPC with mTLS — no inbound ports needed on nodes for management. Each daemon type is independently versioned and released.

## External Logging

Logging is disabled unless `CLICKHOUSE_URL` is set. When disabled, `GET /api/logging/status` returns `enabled: false`, other logging actions return `LOGGING_DISABLED`, and the frontend hides the Logging section. If ClickHouse is configured but unavailable, environment metadata remains manageable while ingest and search return `LOGGING_UNAVAILABLE`.

Required ClickHouse settings:

```env
CLICKHOUSE_URL=http://clickhouse:8123
CLICKHOUSE_USERNAME=gateway
CLICKHOUSE_PASSWORD=<strong-password>
CLICKHOUSE_DATABASE=gateway_logs
CLICKHOUSE_LOGS_TABLE=logs
```

Gateway creates one shared ClickHouse table for all logging environments. Schema modes are:

- `reject`: reject only invalid log entries in a batch when unknown or invalid keys are present.
- `strip`: remove unknown custom labels/fields and accept the remaining event.
- `loose`: keep sanitized unknown custom labels/fields.

Single ingest:

```bash
curl -H "Authorization: Bearer gwl_xxx" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:3000/api/logging/ingest \
  -d '{"severity":"info","message":"hello from curl","service":"demo"}'
```

Batch ingest:

```bash
curl -H "Authorization: Bearer gwl_xxx" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:3000/api/logging/ingest/batch \
  -d '{"logs":[{"severity":"info","message":"started","service":"api"},{"severity":"error","message":"failed","service":"api","fields":{"statusCode":500}}]}'
```

Search:

```bash
curl -H "Content-Type: application/json" \
  -X POST http://localhost:3000/api/logging/environments/<environment-id>/search \
  -d '{"from":"2026-04-27T00:00:00.000Z","to":"2026-04-27T23:59:59.999Z","severities":["error","fatal"],"message":"failed","limit":100}'
```

No SDK is included yet; the HTTP API response shapes are intended to be stable for a later SDK.

## Adding Nodes

Gateway supports three daemon types, each running as a Go binary on the managed host:

| Type | Daemon | Purpose |
|------|--------|---------|
| **nginx** | `nginx-daemon` | Reverse proxy — manages host-native nginx |
| **docker** | `docker-daemon` | Container management — manages Docker containers |
| **monitoring** | `monitoring-daemon` | System metrics — reports CPU, memory, disk, network |

### Quick setup (recommended)

1. In the Gateway UI, go to **Nodes > Add Node**, select the daemon type, and click **Create Node**
2. Copy the setup command shown in the dialog
3. On the target host, paste and run it:

```bash
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/setup-daemon.sh | \
  sudo bash -s -- --type nginx --gateway gw.example.com:9443 --token <TOKEN>
```

The universal `setup-daemon.sh` wrapper downloads the type-specific setup script and forwards all arguments. You can also use the type-specific scripts directly:

```bash
# Nginx node
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/setup-node.sh | \
  sudo bash -s -- --gateway gw.example.com:9443 --token <TOKEN>

# Docker node (requires Docker already installed)
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/setup-docker-node.sh | \
  sudo bash -s -- --gateway gw.example.com:9443 --token <TOKEN>

# Monitoring node (no nginx or Docker required)
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/setup-monitoring-node.sh | \
  sudo bash -s -- --gateway gw.example.com:9443 --token <TOKEN>
```

All setup scripts support:
- `--version <tag>` to install a specific version (default: latest release)
- `--user <username>` to run the daemon as a non-root user
- `--gitlab-url` and `--gitlab-project` to use a custom GitLab instance
- `-y` for non-interactive mode (CI/automation)
- mandatory SHA256 checksum verification of downloaded binaries
- Backup of existing binary on upgrade

The nginx installer also supports `--nginx-mode <managed|integrate>`:
- `managed` writes a full known-good nginx base config and default server
- `integrate` keeps the existing `nginx.conf` and injects Gateway-specific includes plus a dedicated localhost `stub_status` server

Run any script with `--help` for the full list of options and environment variable alternatives.

### Manual setup

<details>
<summary>Expand manual setup instructions</summary>

#### Step 1: Create the node in Gateway

1. Go to **Nodes > Add Node**
2. Select the daemon type (nginx, docker, or monitoring) and optionally set a display name
3. Copy the **enrollment token** — it is shown only once

#### Step 2: Download the daemon

Download the binary for your platform from the [releases page](https://gitlab.wiolett.net/wiolett/gateway/-/releases). Daemon releases use suffixed tags (e.g. `v2.0.0-nginx`, `v2.0.0-docker`, `v2.0.0-monitoring`).

```bash
# Example: nginx-daemon for linux/amd64
curl -fsSL "https://gitlab.wiolett.net/api/v4/projects/wiolett%2Fgateway/packages/generic/nginx-daemon/v2.0.0-nginx/nginx-daemon-linux-amd64" \
  -o /tmp/nginx-daemon-linux-amd64
curl -fsSL "https://gitlab.wiolett.net/api/v4/projects/wiolett%2Fgateway/packages/generic/nginx-daemon/v2.0.0-nginx/checksums.txt" \
  -o /tmp/nginx-daemon-checksums.txt
expected=$(awk '/nginx-daemon-linux-amd64/ { print $1 }' /tmp/nginx-daemon-checksums.txt)
actual=$(sha256sum /tmp/nginx-daemon-linux-amd64 | awk '{ print $1 }')
[ "$expected" = "$actual" ] || { echo "checksum mismatch"; exit 1; }
install -m 755 /tmp/nginx-daemon-linux-amd64 /usr/local/bin/nginx-daemon
```

#### Step 3: Enroll and start

```bash
nginx-daemon install --gateway gw.example.com:9443 --token <TOKEN>
systemctl enable --now nginx-daemon
```

Replace `nginx-daemon` with `docker-daemon` or `monitoring-daemon` as appropriate.

</details>

### Enrollment flow

On first start, each daemon:
1. Connects to the Gateway using the enrollment token
2. Receives an mTLS client certificate issued by the Gateway's internal CA
3. Clears the enrollment token from its config (single-use)
4. Reconnects using the mTLS cert and registers with the Gateway
5. Receives a full config sync (nginx) or begins reporting (docker/monitoring)

The node appears as **online** in the Gateway UI within seconds.

### Daemon configuration reference

Each daemon stores its config at `/etc/<daemon-name>/config.yaml`. The nginx-daemon example:

```yaml
gateway:
  address: "gw.example.com:9443"
  token: ""  # Cleared after enrollment

tls:
  ca_cert: "/etc/nginx-daemon/certs/ca.pem"
  client_cert: "/etc/nginx-daemon/certs/node.pem"
  client_key: "/etc/nginx-daemon/certs/node-key.pem"

nginx:
  config_dir: "/etc/nginx/conf.d/sites"
  certs_dir: "/etc/nginx/certs"
  logs_dir: "/var/log/nginx"
  global_config: "/etc/nginx/nginx.conf"
  binary: "/usr/sbin/nginx"
  stub_status_url: "http://127.0.0.1/nginx_status"  # managed mode; integrate mode uses http://127.0.0.1:8081/nginx_status
  htpasswd_dir: "/etc/nginx/htpasswd"
  acme_challenge_dir: "/var/www/acme-challenge"

state_dir: "/var/lib/nginx-daemon"
log_level: "info"
log_format: "json"
```

### Daemon updates

Daemons can be updated remotely from the Gateway UI. Go to a node's detail page and click **Update** in the Runtime section — the Gateway downloads the new binary, verifies the SHA256 checksum, performs an atomic file replace, and restarts the daemon via systemd. Each daemon type is versioned independently.

### Firewall requirements

| Direction | Port | Purpose |
|-----------|------|---------|
| Node → Gateway | 9443 (TCP) | gRPC control plane (outbound from node) |
| Internet → Nginx Node | 80, 443 (TCP) | HTTP/HTTPS traffic to proxy hosts |

All daemons connect **outbound** to the Gateway — no inbound ports needed on nodes for management.

## Updating

### Gateway

From the UI: **Settings > Check for updates > Update** (admin only). The app pulls the new image and recreates its own container automatically.

Manually:

```bash
# Edit .env: GATEWAY_VERSION=v2.0.0
docker compose pull && docker compose up -d
```

### Daemons

From the UI: go to a node's detail page and click **Update** in the Runtime section when an update is available. The Gateway downloads the new binary, verifies its SHA256 checksum, atomically replaces the old binary, and restarts the systemd service. Updates are per-daemon-type — nginx, docker, and monitoring daemons are versioned and released independently.

Available updates are also shown as a badge on the Nodes list page.

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
- Go >= 1.24 (for daemons — nginx, docker, monitoring)
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
| `pnpm build:all` | Build backend, frontend, and all daemon binaries |
| `pnpm build:daemon` | Build all Go daemon binaries |
| `pnpm test` | Run frontend, backend, and all Go daemon tests |
| `pnpm test:daemon` | Run all Go daemon tests |
| `pnpm lint` | Run Biome for frontend/backend and `go vet` for all daemons |
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
│       ├── nginx/        # Go daemon for nginx management
│       ├── docker/       # Go daemon for Docker container management
│       ├── monitoring/   # Go daemon for system metrics
│       └── shared/       # Shared Go packages (lifecycle, selfupdate)
├── proto/
│   └── gateway/v1/       # Protobuf service definitions
├── scripts/
│   ├── install.sh              # Gateway server installer
│   ├── setup-daemon.sh         # Universal daemon setup wrapper
│   ├── setup-node.sh           # Nginx daemon setup
│   ├── setup-docker-node.sh    # Docker daemon setup
│   └── setup-monitoring-node.sh # Monitoring daemon setup
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
- [x] Docker container management with deploy, webhooks, and auto-cleanup
- [x] Monitoring daemon for system metrics collection
- [x] Independent daemon versioning with remote self-update
- [x] Real-time WebSocket event stream for live UI updates
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
