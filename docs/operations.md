# Operations Guide

[Back to README](../README.md)

This guide covers day-two operation: updates, configuration, programmatic access, structured logging, AI assistant, backups, and security notes.

## Updates

### Gateway Updates

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

### Daemon Updates

From a node detail page, click **Update** when an update is available.

The update flow:

1. Gateway downloads the daemon binary.
2. Gateway verifies the SHA256 checksum.
3. Gateway performs an atomic binary replacement.
4. Gateway restarts the daemon systemd service.
5. The daemon reconnects and reports its new version.

## Configuration Reference

The installer writes `.env`. Important settings:

| Variable | Purpose |
|----------|---------|
| `APP_URL` | Public Gateway URL. |
| `PORT` | HTTP port inside the app container. |
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
| `OIDC_SCOPES` | OIDC scopes, usually `openid email profile`. |
| `SESSION_SECRET` | Long random session secret. |
| `SESSION_EXPIRY` | Session lifetime in seconds. |
| `PKI_MASTER_KEY` | 64-character hex key for encrypted PKI material. |
| `RATE_LIMIT_WINDOW_MS` | Default rate-limit window. |
| `RATE_LIMIT_MAX_REQUESTS` | Default request limit. |
| `GRPC_PORT` | gRPC port for daemon connections. |
| `GRPC_TLS_CERT` | Optional custom gRPC TLS cert. |
| `GRPC_TLS_KEY` | Optional custom gRPC TLS key. |
| `ACME_EMAIL` | Let's Encrypt account email. |
| `ACME_STAGING` | Use Let's Encrypt staging. |
| `HEALTH_CHECK_INTERVAL_SECONDS` | Proxy health check interval. |
| `ACME_RENEWAL_CRON` | ACME renewal schedule. |
| `EXPIRY_CHECK_CRON` | Certificate expiry check schedule. |

See [.env.example](../.env.example) for the full development reference.

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
- Sensitive reveal or export operations require explicit scopes.
- API tokens are not accepted by the MCP endpoint.

### OAuth

Gateway supports OAuth 2.0 Authorization Code + PKCE for public clients.

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

For the complete scope list, delegability, and manual OAuth opt-in scopes, see [SCOPES.md](../SCOPES.md).

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
- Verify PostgreSQL, Redis, and ClickHouse health.

If a node does not connect:

- Verify the node can reach `gw.example.com:9443`.
- Confirm the enrollment token was copied before it expired or was used.
- Check the daemon systemd logs.
- Confirm system time is sane on both Gateway and the node.

If OAuth or OIDC fails:

- Verify redirect URI exact match.
- Verify `APP_URL` and `OIDC_REDIRECT_URI`.
- Verify the provider exposes discovery metadata.
- Check Gateway app logs for callback errors.
