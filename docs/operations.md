# Operations Guide

[Back to README](../README.md)

This guide covers day-two operation: updates, configuration, programmatic access, structured logging, AI assistant, backups, and security notes.

## Updates

### Gateway Updates

From the UI:

1. Go to **Settings > Check for updates**.
2. Review the available version.
3. Click **Update**.

Gateway verifies the signed release manifest, pulls the selected image by its immutable digest, updates `GATEWAY_IMAGE_REF`, and recreates its own container. Automatic gateway updates fail closed when the signed manifest is missing, invalid, or does not match the requested version and running image repository.

Manual update:

```bash
# Edit .env first, for example:
# GATEWAY_VERSION=v2.0.0
# GATEWAY_IMAGE_REF=registry.gitlab.wiolett.net/wiolett/gateway:v2.0.0
docker compose pull
docker compose up -d
```

### Daemon Updates

From a node detail page, click **Update** when an update is available.

The update flow:

1. Gateway fetches and verifies the signed daemon update manifest.
2. Gateway dispatches the signed manifest, download URL, and verified SHA256 checksum to the daemon.
3. New daemons verify the signed manifest locally before downloading.
4. The daemon verifies the downloaded binary checksum, replaces the binary atomically, and exits for systemd restart.
5. The daemon reconnects and reports its new version.

Existing daemons from before signed-manifest support can perform one transition update. In that case Gateway verifies the signed manifest before dispatch, and the old daemon enforces the verified SHA256 checksum. After that transition, daemon-side signature verification is enforced for future updates.

## Configuration Reference

The installer writes `.env`. Important settings:

| Variable | Purpose |
|----------|---------|
| `APP_URL` | Public Gateway URL. |
| `PORT` | HTTP port inside the app container. |
| `DATABASE_URL` | PostgreSQL connection URL. |
| `REDIS_URL` | Redis connection URL. |
| `CLICKHOUSE_URL` | Enables structured logging when set. |
| `GATEWAY_IMAGE_REF` | Gateway image reference used by Compose. Installer defaults this to `${GATEWAY_IMAGE}:${GATEWAY_VERSION}`; signed self-updates replace it with `image@sha256:<digest>`. |
| `CLICKHOUSE_USERNAME` | ClickHouse username. |
| `CLICKHOUSE_PASSWORD` | ClickHouse password. |
| `CLICKHOUSE_DATABASE` | ClickHouse database. |
| `CLICKHOUSE_LOGS_TABLE` | ClickHouse logs table. |
| `OIDC_ISSUER` | OIDC issuer URL. |
| `OIDC_CLIENT_ID` | OIDC client ID. |
| `OIDC_CLIENT_SECRET` | OIDC client secret. |
| `OIDC_REDIRECT_URI` | OIDC callback URL. |
| `OIDC_SCOPES` | OIDC scopes, usually `openid email profile`. |
| `SESSION_SECRET` | Long random session secret. |
| `SESSION_EXPIRY` | Session lifetime in seconds. |
| `PKI_MASTER_KEY` | 64-character hex key for encrypted PKI material. |
| `RATE_LIMIT_WINDOW_MS` | Default rate-limit window. |
| `RATE_LIMIT_MAX_REQUESTS` | Default request limit. |
| `GRPC_PORT` | TLS-only gRPC port for daemon connections. |
| `GRPC_TLS_AUTO_DIR` | Directory for Gateway's auto-issued internal gRPC TLS certificate and key. |
| `GRPC_TLS_EXTRA_SANS` | Extra comma-separated DNS names or IP addresses for the auto-issued gRPC server certificate. Gateway also includes `APP_URL` host and configured public IPs automatically. |
| `GRPC_TLS_CERT` | Optional custom gRPC TLS certificate issued by Gateway's system CA. |
| `GRPC_TLS_KEY` | Optional custom gRPC TLS private key paired with `GRPC_TLS_CERT`. |
| `ACME_EMAIL` | Let's Encrypt account email. |
| `ACME_STAGING` | Use Let's Encrypt staging. |
| `HEALTH_CHECK_INTERVAL_SECONDS` | Proxy health check interval. |
| `ACME_RENEWAL_CRON` | ACME renewal schedule. |
| `EXPIRY_CHECK_CRON` | Certificate expiry check schedule. |

See [.env.example](../.env.example) for the full development reference.

Redis is required infrastructure. Gateway uses it for sessions, cache, and rate limiting; if Redis is unavailable, `/health` returns `503` and Redis-backed rate-limited API/auth/public surfaces fail closed with `RATE_LIMIT_UNAVAILABLE`.

`OIDC_SCOPES` should normally include `openid email profile`. The `email` scope requests `email` and `email_verified`, but providers differ in whether `email_verified` is present in the ID token and whether it is true by default. Authentik, for example, may require explicit mapping/configuration before `email_verified=true` is emitted. Leave **Require verified OIDC email** disabled unless your IdP emits reliable verified-email claims.

## Update Signing Operations

Gateway and daemon automatic updates require signed release manifests. Release CI must have `UPDATE_SIGNING_PRIVATE_KEY_PEM_B64` set to a base64-encoded Ed25519 private key PEM. The corresponding public key is compiled into Gateway and daemon binaries.

If `UPDATE_SIGNING_PRIVATE_KEY_PEM_B64` is missing, gateway and daemon release jobs fail instead of publishing unsigned automatic-update artifacts. To rotate the update signing key, generate a new key pair, update `config/update-trust/update-signing-public-key.pem`, deploy that release, then switch CI to the new private key.

## Container Log Rotation

The installer can add Docker Compose logging limits for Gateway services. This is separate from the optional ClickHouse structured logging feature.

Installer defaults:

| Setting | Default | Meaning |
|---------|---------|---------|
| `GATEWAY_LOG_ROTATION` | `Y` | Add Docker logging options to generated Compose services. |
| `GATEWAY_LOG_MAX_SIZE` | `50m` | Rotate each container log file after this size. |
| `GATEWAY_LOG_MAX_FILE` | `3` | Keep this many rotated log files per service. |

The generated Compose block looks like:

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "50m"
    max-file: "3"
```

For install-time flags, see [Docker log rotation](installation.md#docker-log-rotation).

## Programmatic Access

Gateway supports browser sessions, REST API tokens, OAuth access tokens, MCP access, and logging ingest tokens. These are intentionally separate.

| Prefix | Token family | Purpose |
|--------|--------------|---------|
| `gw_` | API token | REST API automation. |
| `gwo_` | OAuth access token | Gateway API or Gateway MCP resource. |
| `gwl_` | Logging ingest token | Write-only structured log ingestion. |

### API Tokens

API tokens are created in Gateway settings and are scoped. They can call REST API routes according to their scopes and the owning user's current effective permissions.

Important behavior:

- Token scopes cannot exceed the owning user's permissions.
- Effective scopes are bounded by the owner at request time.
- Write-capable scopes satisfy matching read/view checks, but resource-scoped grants stay limited to the same resource.
- Create-only and destructive-only scopes do not imply browse access.
- Sensitive reveal or export operations require explicit scopes.
- API tokens are not accepted by the MCP endpoint.

### OAuth

Gateway supports OAuth 2.0 Authorization Code + PKCE for public clients.

Dynamic OAuth client registration is intended for public local clients such as CLIs and MCP clients. By default, newly registered clients may use only loopback callback URLs (`localhost`, `127.0.0.1`, or `::1`). This keeps automatic CLI login working without allowing arbitrary external callback origins.

Admins can enable OAuth extended callback compatibility in Gateway settings when a client requires an external HTTPS callback URL. When enabled, unverified OAuth clients may register HTTPS callback URLs outside loopback. The consent screen warns users whenever an authorization result will be sent to an external callback origin.

OAuth access tokens are resource-bound:

| Resource | URL | Accepted by |
|----------|-----|-------------|
| Gateway API | `https://<gateway>/api` | REST API routes. |
| Gateway MCP | `https://<gateway>/api/mcp` | Remote MCP endpoint. |

An OAuth access token for the API resource cannot call MCP. An OAuth access token for the MCP resource cannot call normal REST API routes.

OAuth authorizations are managed in **Settings > OAuth Applications**. If the same client has grants for both API and MCP resources, Gateway displays them as separate rows.

### MCP

The remote MCP endpoint is intended for AI and MCP clients.

MCP accepts only OAuth access tokens issued for the Gateway MCP resource. It rejects:

- Browser cookies.
- `gw_` API tokens.
- `gwl_` logging tokens.
- OAuth tokens issued for the Gateway API resource.

The `mcp:use` scope is a user-account capability gate. The owning user must have it for MCP access.

### Scope Rules

Write-capable scopes satisfy matching read/view checks so users can operate on resources they are allowed to modify. Resource-scoped grants stay bounded to the same resource, and create-only or destructive-only scopes do not grant browse access by themselves.

For the complete scope list, implication behavior, delegability, and manual OAuth opt-in scopes, see [SCOPES.md](../SCOPES.md).

## Structured Logging

Logging is optional and enabled when `CLICKHOUSE_URL` is configured.

Required ClickHouse settings:

```env
CLICKHOUSE_URL=http://clickhouse:8123
CLICKHOUSE_USERNAME=gateway
CLICKHOUSE_PASSWORD=<strong-password>
CLICKHOUSE_DATABASE=gateway_logs
CLICKHOUSE_LOGS_TABLE=logs
CLICKHOUSE_REQUEST_TIMEOUT_MS=5000
```

### ClickHouse Image Upgrades

Gateway pins the bundled ClickHouse container to an explicit `clickhouse/clickhouse-server` release tag instead of using `latest`. Upgrade ClickHouse intentionally by changing the pinned tag in `docker-compose.yml`, `docker-compose.dev.yml`, and `scripts/install.sh`, then test startup and log search against existing ClickHouse data before rolling the change into production. When generating a new compose file with the installer, `CLICKHOUSE_IMAGE_REF` must include an explicit non-`latest` tag or a digest; the installer rejects empty, whitespace-containing, or unsupported image references before it writes `docker-compose.yml`.

If logging is disabled:

- `GET /api/logging/status` returns `enabled: false`.
- Logging actions return `LOGGING_DISABLED`.
- The frontend hides the Logging section.

If ClickHouse is configured but unavailable:

- Environment metadata remains manageable.
- Ingest and search return `LOGGING_UNAVAILABLE`.

### Logging Schemas

Gateway stores logs in one shared ClickHouse table. Each logging environment can define schema behavior:

| Mode | Behavior |
|------|----------|
| `reject` | Reject invalid log entries when unknown or invalid keys are present. |
| `strip` | Remove unknown custom labels/fields and accept the remaining event. |
| `loose` | Keep sanitized unknown custom labels/fields. |

### Ingest Examples

Single event:

```bash
curl -H "Authorization: Bearer gwl_xxx" \
  -H "Content-Type: application/json" \
  -X POST https://gw.example.com/api/logging/ingest \
  -d '{"severity":"info","message":"hello from curl","service":"demo"}'
```

Batch:

```bash
curl -H "Authorization: Bearer gwl_xxx" \
  -H "Content-Type: application/json" \
  -X POST https://gw.example.com/api/logging/ingest/batch \
  -d '{"logs":[{"severity":"info","message":"started","service":"api"},{"severity":"error","message":"failed","service":"api","fields":{"statusCode":500}}]}'
```

Search:

```bash
curl -H "Content-Type: application/json" \
  -X POST https://gw.example.com/api/logging/environments/<environment-id>/search \
  -d '{"from":"2026-04-27T00:00:00.000Z","to":"2026-04-27T23:59:59.999Z","severities":["error","fatal"],"message":"failed","limit":100}'
```

### TypeScript SDK

Gateway publishes the official TypeScript logging SDK as [`@wiolett/gateway-logger`](https://www.npmjs.com/package/@wiolett/gateway-logger). Install it in Node services that need structured log delivery with batching, retries, fallback handling, and trace/span context:

```bash
pnpm add @wiolett/gateway-logger
```

```ts
import { GatewayLogger } from "@wiolett/gateway-logger";

const logger = new GatewayLogger({
  endpoint: "https://gw.example.com",
  token: process.env.GATEWAY_LOGGING_TOKEN!,
  service: "billing-api",
  source: "worker-1",
  labels: { app: "billing", region: "eu" },
  fields: { version: "2.4.1" },
});

const trace = logger.createTrace({ requestId: "req_123" });
trace.info("Payment started");
trace.error("Payment capture failed", {
  labels: { provider: "stripe" },
  fields: { statusCode: 502, durationMs: 1834 },
});

await logger.flush();
await logger.close();
```

`gwl_` tokens are server-side write-only secrets. Do not expose them in browser code.

## AI Assistant

The AI assistant is optional and disabled by default.

To use it:

1. Go to **Settings > AI Assistant**.
2. Enable the assistant.
3. Configure an OpenAI-compatible provider.
4. Configure model and API key.
5. Review tool access and approval behavior.

Operational notes:

- No data is sent to an AI provider until an admin enables the assistant.
- Tool calls are permission-gated.
- Destructive operations require approval unless an admin configures bypass rules.
- AI-initiated actions are flagged in audit logs.
- The assistant can use Gateway-specific context from its knowledge base.

## Notifications And Status Pages

Gateway supports operational notification workflows:

- Webhook notification targets.
- Delivery history.
- Built-in templates for common integrations.
- Alert rules.
- Status-page incident workflows.
- Certificate, domain, health, and runtime alerts.

Use status pages for externally visible service health and incidents. Use notifications for internal operational alerts.

## Backups

Back up:

- PostgreSQL data.
- Redis data if preserving sessions and cache matters.
- ClickHouse data if structured logging is enabled.
- `.env`.
- Custom TLS certificate and key files.
- Any external volume paths you configured manually.

Critical secrets:

- `PKI_MASTER_KEY` is required to decrypt PKI private key material.
- `SESSION_SECRET` affects session validity.
- OIDC client secret is needed for login.
- ClickHouse and database credentials are needed for service startup.

Store backups separately from the Gateway server and test restore procedures before relying on them.

## Security Notes

For the full security model, including daemon PKI, mTLS enrollment, token boundaries, and hardening guidance, see [Security model](security.md).

- Prefer OIDC with MFA enforced at the identity provider.
- Grant users only the groups and scopes they need.
- Separate read, write, reveal, export, and destructive scopes.
- Treat API tokens, OAuth refresh tokens, and logging tokens as secrets.
- Use OAuth resource separation for API and MCP clients.
- Review audit logs after sensitive operations.
- Keep daemon update capability limited to trusted admins.
- Protect `.env` because it contains database, OIDC, session, and PKI secrets.

## Troubleshooting Pointers

If Gateway cannot start:

- Check `docker compose ps`.
- Check app logs with `docker compose logs app`.
- Verify `.env` values.
- Verify PostgreSQL, Redis, and ClickHouse health. Redis outages intentionally make `/health` fail and API/auth/public rate-limited endpoints return `503` until rate limiting is enforceable again.

If a node does not connect:

- Verify the node can reach `gw.example.com:9443`.
- Confirm the enrollment token was copied before it expired or was used.
- If logs mention a Gateway certificate fingerprint mismatch, delete the pending node and create a new node in Gateway, then rerun the generated command. You may change `--gateway` to a direct `9443/tcp` endpoint, but keep the generated `--gateway-cert-sha256` value.
- Check the daemon systemd logs.
- Confirm system time is sane on both Gateway and the node.

If OAuth or OIDC fails:

- Verify redirect URI exact match.
- Verify `APP_URL` and `OIDC_REDIRECT_URI`.
- Verify the provider exposes discovery metadata.
- Check Gateway app logs for callback errors.
