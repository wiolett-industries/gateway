# Gateway Capabilities

[Back to README](../README.md)

Gateway is a self-hosted infrastructure control plane. It is built around a central web app and host daemons that connect outbound to the app, so operators can manage common infrastructure workflows without direct shell access to every server.

## Reverse Proxy

Gateway manages nginx through the `nginx-daemon` installed on each proxy node.

Core proxy workflows:

- Create, edit, order, and delete proxy hosts.
- Manage proxy hosts across multiple nginx nodes.
- Configure SSL termination, upstream target, WebSocket support, custom headers, rewrites, and proxy behavior.
- Create redirect hosts and 404 hosts.
- Group proxy hosts into folders and reorder them with drag-and-drop.
- Configure access lists with IP rules and basic authentication.
- Use nginx config templates with variables for repeatable host configuration.
- View real-time nginx logs and node stats.

Health checks:

- Configure expected status codes.
- Configure expected response body matching.
- Track health state and history.
- Surface failures in the UI and notification workflows.

Nginx integration:

- `managed` mode lets Gateway own a known-good base nginx config.
- `integrate` mode keeps an existing host nginx config and injects Gateway-managed includes.
- ACME HTTP-01 challenge paths can be managed for proxy hosts.

## Docker

Gateway manages Docker through the `docker-daemon` installed on container hosts.

Container workflows:

- List containers across managed Docker nodes.
- Start, stop, restart, recreate, duplicate, rename, and remove containers.
- Edit image, command, environment variables, secrets, labels, ports, mounts, restart policy, and runtime limits.
- Browse container logs with search and follow mode.
- Open an interactive container console.
- Browse and edit container files when permitted.
- Manage Docker images and cleanup old images.
- Manage private registry credentials and image registry mappings.

Deployment workflows:

- Create deployment definitions separate from running containers.
- Use deployment slots for rollout and rollback.
- Deploy, switch, rollback, stop slots, and monitor deployment health.
- Trigger image pull and recreate/deploy workflows from CI/CD webhooks.
- Store deployment secrets encrypted and reveal them only with explicit permission.

Safety controls:

- Docker socket mounts are guarded to prevent accidentally exposing host Docker control inside managed containers.
- Secrets are masked by default.
- Dangerous operations are permission-scoped and audited.

## Certificates And PKI

Gateway includes SSL certificate management and internal PKI.

ACME SSL:

- Issue Let's Encrypt certificates.
- Use HTTP-01 and DNS-01 challenge flows.
- Renew certificates on a configurable schedule.
- Attach certificates to proxy hosts.

Uploaded SSL:

- Upload existing certificates.
- Track expiration.
- Use uploaded certificates for proxy hosts.

Internal PKI:

- Create root and intermediate certificate authorities.
- Issue TLS server, TLS client, code-signing, and email certificates.
- Use certificate templates with custom extensions and policies.
- Generate and publish CRLs.
- Export certificates as PEM, PKCS#12, or JKS when the user has export scopes.

Private key material is encrypted at rest with the configured `PKI_MASTER_KEY`. Export and reveal operations are controlled by explicit scopes.

## Domains

Gateway keeps a central registry of domains used by the system.

Domain workflows:

- Track domains independently from proxy hosts and certificates.
- Validate DNS records such as A, AAAA, CNAME, CAA, MX, and TXT.
- Track domain usage across proxy hosts and SSL certificates.
- Surface DNS status in the UI.
- Use scheduled DNS checks for ongoing validation.

## Databases

Gateway can store PostgreSQL and Redis connections with encrypted credentials.

PostgreSQL:

- Test saved connections.
- Track connection health and history.
- Browse schemas and tables.
- Browse rows.
- Insert, update, and delete rows when permitted.
- Run SQL through a scoped console.

Redis:

- Test saved connections.
- Track health and history.
- Scan keys.
- Inspect values.
- Set, delete, and expire keys when permitted.
- Run Redis commands through a scoped console.

Credential reveal and query execution are intentionally separate permissions. Users can be allowed to monitor a database without being allowed to reveal credentials or run arbitrary commands.

## Nodes And Monitoring

Gateway supports three daemon types:

| Type | Daemon | Purpose |
|------|--------|---------|
| nginx | `nginx-daemon` | Reverse proxy management. |
| docker | `docker-daemon` | Docker container and deployment management. |
| monitoring | `monitoring-daemon` | Host metrics without nginx or Docker control. |

Node features:

- Enroll nodes with one-time tokens.
- Communicate over outbound gRPC with mTLS.
- Reconnect automatically with exponential backoff.
- Show version compatibility state.
- Stream node logs.
- Collect CPU, memory, disk, and network metrics.
- Remotely update daemon binaries with SHA256 verification and atomic replacement.

Managed services keep running if Gateway is offline. You lose central control until Gateway returns, but nginx and Docker continue using the last applied host state.

## Structured Logging

Gateway can ingest external service logs into ClickHouse.

Logging features:

- UI-managed environments.
- Per-environment schemas.
- Retention settings.
- Write-only `gwl_` ingest tokens.
- Single-event and batch ingestion APIs.
- Severity validation.
- Payload, token, environment, and global rate limits.
- Partial batch acceptance.
- Search UI with filters and event detail inspection.
- Official TypeScript SDK published as [`@wiolett/gateway-logger`](https://www.npmjs.com/package/@wiolett/gateway-logger), with source in `packages/logging-sdk`.

Logging is optional. If `CLICKHOUSE_URL` is not configured, logging routes report that logging is disabled and the frontend hides the Logging section.

## Programmatic Access

Gateway has three token families:

| Prefix | Purpose |
|--------|---------|
| `gw_` | Gateway REST API tokens. |
| `gwo_` | OAuth access tokens for Gateway API or Gateway MCP resources. |
| `gwl_` | Write-only logging ingest tokens. |

OAuth uses public-client Authorization Code + PKCE and resource-bound access tokens:

- Gateway API resource: `https://<gateway>/api`
- Gateway MCP resource: `https://<gateway>/api/mcp`

REST API routes accept browser sessions, `gw_` API tokens, and `gwo_` OAuth tokens issued for the Gateway API resource. The MCP endpoint accepts only `gwo_` OAuth tokens issued for the Gateway MCP resource.

For scope rules and delegation details, see [SCOPES.md](../SCOPES.md).

## Administration

Administration features:

- OIDC authentication.
- Built-in and custom permission groups.
- Granular scopes for users, groups, API tokens, OAuth grants, and MCP access.
- Write-capable scopes imply matching read/list/view checks while preserving resource boundaries.
- Audit log for user, token, OAuth, and AI-initiated actions.
- Setup state and first-run configuration.
- Update checks and in-app Gateway updates.
- Daemon runtime version tracking and daemon updates.
- License state and edition display.

## Optional AI Assistant

The AI assistant is disabled by default.

When enabled by an admin, it can:

- Use any OpenAI-compatible provider configured in settings.
- Call Gateway tools through permission-gated operations.
- Ask clarifying questions before acting.
- Use destructive action approval flows.
- Use a system-specific knowledge base.
- Save and restore conversations.
- Respect per-user tool access and approval bypass preferences.

No data is sent to an AI provider until an admin enables the assistant and configures a provider.
