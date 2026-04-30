# Installation Guide

[Back to README](../README.md)

This guide covers installing the Gateway control plane. To add nginx, Docker, or monitoring hosts after Gateway is running, see [Nodes and daemons](nodes.md).

## Requirements

Production server:

- Linux server.
- Docker with Docker Compose v2.
- OpenSSL.
- Network access to pull Gateway images and installer assets.
- A domain name if you want production HTTPS and ACME automation.
- An OIDC provider such as Keycloak, Authentik, Auth0, Zitadel, or another OpenID Connect provider.

Recommended production ports:

| Port | Direction | Purpose |
|------|-----------|---------|
| `80/tcp` | inbound to Gateway server | HTTP and ACME HTTP-01 challenge, if used. |
| `443/tcp` | inbound to Gateway server | Gateway UI and API over HTTPS. |
| `9443/tcp` | inbound to Gateway server from nodes | gRPC control plane for daemons. |

Managed nodes connect outbound to Gateway on `9443/tcp`.

## Fast Install

Run this on the Gateway server:

```bash
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/install.sh | bash
```

The installer walks through:

- Deployment domain.
- OIDC issuer and client settings.
- SSL mode.
- ACME email and staging mode.
- Docker resource profile.
- Container log rotation.
- `.env` file permissions.
- Gateway version.

After the installer completes:

1. Open the printed Gateway URL.
2. Sign in with your OIDC provider.
3. Complete any first-run setup steps.
4. Add a node from **Nodes > Add Node**.

## Non-Interactive Install

Use `-y` with flags for CI or repeatable server setup:

```bash
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/install.sh | bash -s -- -y \
  --domain gw.example.com \
  --oidc-issuer https://id.example.com \
  --oidc-client-id gateway \
  --oidc-client-secret your-secret \
  --acme-email admin@example.com
```

Common flags:

| Flag | Environment variable | Purpose |
|------|----------------------|---------|
| `--domain` | `GATEWAY_DOMAIN` | Public Gateway domain. |
| `--acme-email` | `GATEWAY_ACME_EMAIL` | Let's Encrypt account email. |
| `--oidc-issuer` | `GATEWAY_OIDC_ISSUER` | OIDC issuer URL. |
| `--oidc-client-id` | `GATEWAY_OIDC_CLIENT_ID` | OIDC client ID. |
| `--oidc-client-secret` | `GATEWAY_OIDC_CLIENT_SECRET` | OIDC client secret. |
| `--acme-staging` | `GATEWAY_ACME_STAGING` | Use Let's Encrypt staging. |
| `--resource-profile` | `GATEWAY_RESOURCE_PROFILE` | Docker resource profile. |
| `--log-max-size` | `GATEWAY_LOG_MAX_SIZE` | Max Docker container log file size. |
| `--log-max-file` | `GATEWAY_LOG_MAX_FILE` | Max number of rotated Docker log files. |
| `--no-log-rotation` | `GATEWAY_LOG_ROTATION=N` | Disable installer-managed Docker log rotation. |
| `--version` | `GATEWAY_VERSION` | Gateway version tag. |

Run the installer with `--help` for the full list.

## Docker Log Rotation

The installer can add Docker Compose logging limits for Gateway services. This controls Docker's `json-file` container logs, not Gateway's optional ClickHouse structured logging feature.

Defaults:

| Setting | Default | Meaning |
|---------|---------|---------|
| `GATEWAY_LOG_ROTATION` | `Y` | Add Docker logging options to generated Compose services. |
| `GATEWAY_LOG_MAX_SIZE` | `50m` | Rotate a container log file after it reaches this size. |
| `GATEWAY_LOG_MAX_FILE` | `3` | Keep this many rotated log files per service. |

Non-interactive example:

```bash
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/install.sh | bash -s -- -y \
  --domain gw.example.com \
  --oidc-issuer https://id.example.com \
  --oidc-client-id gateway \
  --oidc-client-secret your-secret \
  --acme-email admin@example.com \
  --log-max-size 100m \
  --log-max-file 5
```

Disable installer-managed Docker log rotation:

```bash
GATEWAY_LOG_ROTATION=N \
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/install.sh | bash -s -- -y \
  --domain gw.example.com \
  --oidc-issuer https://id.example.com \
  --oidc-client-id gateway \
  --oidc-client-secret your-secret \
  --acme-email admin@example.com
```

Equivalent flag:

```bash
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/install.sh | bash -s -- -y \
  --domain gw.example.com \
  --oidc-issuer https://id.example.com \
  --oidc-client-id gateway \
  --oidc-client-secret your-secret \
  --acme-email admin@example.com \
  --no-log-rotation
```

## Install A Specific Version

```bash
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/install.sh | bash -s -- --version v2.0.0
```

The same version can be passed in non-interactive mode:

```bash
GATEWAY_VERSION=v2.0.0 \
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/install.sh | bash -s -- -y \
  --domain gw.example.com \
  --oidc-issuer https://id.example.com \
  --oidc-client-id gateway \
  --oidc-client-secret your-secret \
  --acme-email admin@example.com
```

## OIDC Setup

Gateway uses OIDC for user login.

Configure your identity provider with:

- Application type: web application or confidential client.
- Redirect URI: `https://<gateway-domain>/auth/callback`
- Scopes: `openid email profile`

Gateway settings:

```env
OIDC_ISSUER=https://id.example.com
OIDC_CLIENT_ID=gateway
OIDC_CLIENT_SECRET=<secret>
OIDC_REDIRECT_URI=https://gw.example.com/auth/callback
OIDC_SCOPES=openid email profile
```

The exact OIDC provider UI differs, but Gateway expects a normal OIDC issuer with discovery metadata and a callback that returns an authenticated user with an email address.

## SSL Modes

The installer can configure Gateway for common SSL setups:

| Mode | Use when |
|------|----------|
| ACME | Gateway should obtain and renew Let's Encrypt certificates. |
| Custom certificate | You already have certificate, key, and optional chain files. |
| Existing reverse proxy | Another proxy terminates HTTPS in front of Gateway. |

If using ACME, make sure the Gateway domain resolves to the Gateway server and inbound HTTP/HTTPS are reachable.

## Production Configuration

The installer writes `.env`. Important variables:

| Variable | Description |
|----------|-------------|
| `APP_URL` | Public Gateway URL. |
| `DATABASE_URL` | PostgreSQL connection URL. |
| `REDIS_URL` | Redis connection URL. |
| `CLICKHOUSE_URL` | Enables structured logging when set. |
| `CLICKHOUSE_USERNAME` | ClickHouse username. |
| `CLICKHOUSE_PASSWORD` | ClickHouse password. |
| `CLICKHOUSE_DATABASE` | ClickHouse database. |
| `CLICKHOUSE_LOGS_TABLE` | ClickHouse logs table. |
| `OIDC_ISSUER` | OIDC issuer URL. |
| `OIDC_CLIENT_ID` | OIDC client ID. |
| `OIDC_CLIENT_SECRET` | OIDC client secret. |
| `OIDC_REDIRECT_URI` | OIDC callback URL. |
| `SESSION_SECRET` | Long random secret for sessions. |
| `PKI_MASTER_KEY` | 64-character hex key used to encrypt PKI material. |
| `GRPC_PORT` | Gateway gRPC port for daemon connections. |
| `ACME_EMAIL` | Let's Encrypt account email. |
| `ACME_STAGING` | Whether to use Let's Encrypt staging. |
| `HEALTH_CHECK_INTERVAL_SECONDS` | Proxy health check interval. |
| `DNS_CHECK_INTERVAL_SECONDS` | Domain DNS check interval. |
| `EXPIRY_WARNING_DAYS` | Days before expiry to warn. |
| `EXPIRY_CRITICAL_DAYS` | Days before expiry for critical alerts. |

See [.env.example](../.env.example) for the complete development-oriented reference.

## Docker Compose Stack

The production stack includes:

| Service | Purpose |
|---------|---------|
| `app` | Gateway backend, frontend, API, OAuth, MCP, WebSockets, and gRPC server. |
| `postgres` | Main database. |
| `redis` | Sessions, cache, and rate limiting. |
| `clickhouse` | Structured logging storage. |

The app container exposes:

- `3000/tcp` for the app internally or when running without an outer reverse proxy.
- `9443/tcp` for daemon gRPC connections.

## Updating Gateway

From the UI:

1. Go to **Settings > Check for updates**.
2. Review the available version.
3. Click **Update**.

Gateway pulls the selected image and recreates its own container.

Manual update:

```bash
# Edit .env first, for example:
# GATEWAY_VERSION=v2.0.0
docker compose pull
docker compose up -d
```

## Backup Notes

Back up at least:

- PostgreSQL data.
- Redis data if session continuity matters.
- ClickHouse data if using structured logging.
- The generated `.env` file.
- Any custom TLS files used by the deployment.

The `PKI_MASTER_KEY` is critical. Without it, encrypted certificate authority material and private keys cannot be decrypted.

## After Installation

After Gateway is online, continue with:

- [Nodes and daemons](nodes.md) to add nginx, Docker, or monitoring hosts.
- [Operations guide](operations.md) for programmatic access, logging, updates, AI, and security notes.
- [Capabilities](capabilities.md) for a full product feature overview.
