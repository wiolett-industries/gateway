# Nginx Daemon Design Spec

## Context

Gateway currently manages a single nginx Docker container via Docker socket — the Node.js backend writes configs to shared volumes, runs `nginx -t` and `nginx -s reload` via `docker exec`, deploys certs, streams logs, and collects stats. This tightly couples proxy management to a single co-located nginx instance.

**Problem:** This architecture cannot manage nginx on multiple remote hosts, and tightly couples the backend to Docker.

**Solution:** A Go daemon (`nginx-daemon`) that runs on each host machine alongside a host-native nginx installation. The Gateway backend communicates with daemons over gRPC instead of the Docker socket. This enables multi-node proxy management and cleanly separates the control plane from the data plane.

**Scope:** This spec covers the nginx proxy daemon only. A bastion daemon will follow the same pattern later but is out of scope here.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Communication protocol | gRPC | Strongly typed, bidirectional streaming, built-in mTLS, efficient binary protocol |
| Connection direction | Daemon → Gateway | Simpler networking, no need to expose daemon ports to the internet |
| Nginx runtime | Host-native | No Docker dependency on proxy nodes |
| Authentication | mTLS + pre-shared token | Defense in depth; leverages existing internal CA for mTLS certs |
| Offline behavior | Keep running as-is | Nginx continues with last-known config on Gateway disconnect |
| Code location | `packages/daemons/nginx/` in monorepo | Future bastion daemon at `packages/daemons/bastion/` |
| Migration strategy | Full replacement | Remove Docker socket approach entirely, all nginx goes through daemon |
| Monorepo tooling | Migrate pnpm workspaces → Nx | Polyglot support (TS + Go), proto codegen orchestration, dependency graph |

---

## 1. Go Daemon Architecture

### 1.1 Project Structure

```
packages/daemons/
  nginx/
    cmd/nginx-daemon/
      main.go                    # Entry point, CLI flags, signal handling
    internal/
      config/
        config.go                # YAML config loading and validation
      nginx/
        manager.go               # Nginx process lifecycle (test, reload, status)
        config_writer.go         # Atomic file writes (write .tmp → fsync → rename)
        cert_writer.go           # TLS cert file deployment to disk
        log_tailer.go            # tail -f nginx logs, parse, emit LogEntry
        stub_status.go           # HTTP fetch of /nginx_status for metrics
      daemon/
        daemon.go                # Main lifecycle orchestrator
        connector.go             # gRPC dial, reconnection with exp backoff + jitter
        handler.go               # Processes commands received from Gateway
        reporter.go              # Sends stats, health, log streams to Gateway
      auth/
        mtls.go                  # TLS config with client certs
        token.go                 # PSK token handling for enrollment
      state/
        state.go                 # Local state persistence (config version hash, enrollment)
    go.mod
    go.sum
    Makefile                     # build, test, lint targets
    Dockerfile                   # Optional containerized deployment
    nginx-daemon.example.yaml    # Example config
  bastion/                       # Future
proto/
  gateway/v1/
    nginx-daemon.proto           # Shared proto definitions
    bastion-daemon.proto         # Future
  buf.yaml                       # buf.build config for linting/codegen
```

### 1.2 Daemon Configuration

File: `/etc/nginx-daemon/config.yaml`

```yaml
gateway:
  address: "gateway.example.com:9443"
  token: "gw_node_abc123..."          # Only needed for initial enrollment

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
  stub_status_url: "http://127.0.0.1/nginx_status"
  htpasswd_dir: "/etc/nginx/htpasswd"
  acme_challenge_dir: "/var/www/acme-challenge"

state_dir: "/var/lib/nginx-daemon"
log_level: "info"
log_format: "json"
```

### 1.3 Startup Lifecycle

1. Parse config YAML, validate required fields
2. Verify nginx binary exists and is executable (`nginx -v`)
3. Load local state (last config version hash, enrollment status)
4. If not enrolled → use PSK token for enrollment (receives mTLS certs from Gateway CA)
5. Establish mTLS gRPC connection to Gateway
6. Open bidirectional `CommandStream`, send `RegisterMessage` (node_id, hostname, nginx_version, config_version_hash)
7. Enter main loop: process commands from Gateway, run background health/stats reporters
8. On SIGTERM/SIGINT → send deregister message, drain in-flight operations, close gRPC, exit (nginx keeps running)

### 1.4 Nginx Management

`nginx/manager.go` wraps all nginx interactions:

- **TestConfig()** → `nginx -t`, captures stderr, returns `(bool, string)`
- **Reload()** → `nginx -s reload`, returns error if non-zero exit
- **GetVersion()** → parses `nginx -v` output
- **GetWorkerCount()** → reads from process table or nginx.conf
- **GetUptime()** → reads PID file, checks `/proc/{pid}/stat`
- **IsRunning()** → checks PID file + process existence

`config_writer.go` implements atomic writes:
1. Write to `{path}.tmp`
2. `fsync` the temp file
3. `rename` temp → final (atomic on same filesystem)

This mirrors the existing `NginxService.applyConfig` rollback pattern.

### 1.5 Offline Behavior

When gRPC connection to Gateway drops:
- Nginx keeps running with last-known configuration
- Reconnection uses exponential backoff: 1s → 2s → 4s → 8s → ... → 60s cap, with jitter
- On reconnect, daemon sends its current config_version_hash
- Gateway compares and pushes `FullSyncCommand` if they differ
- Local state file (`/var/lib/nginx-daemon/state.json`) stores: config version hash, list of active host IDs, enrollment status

### 1.6 Go Dependencies

- `google.golang.org/grpc` — gRPC framework
- `google.golang.org/protobuf` — protobuf runtime
- `gopkg.in/yaml.v3` — config file parsing
- Standard library for everything else (crypto/tls, os/exec, bufio, net/http)

---

## 2. gRPC Service Definitions

Proto file: `proto/gateway/v1/nginx-daemon.proto`

### 2.1 NodeEnrollment Service

Unary RPCs for initial setup and cert renewal.

```protobuf
service NodeEnrollment {
  rpc Enroll(EnrollRequest) returns (EnrollResponse);
  rpc RenewCertificate(RenewCertRequest) returns (RenewCertResponse);
}

message EnrollRequest {
  string token = 1;
  string hostname = 2;
  string nginx_version = 3;
  string os_info = 4;
  string daemon_version = 5;
}

message EnrollResponse {
  string node_id = 1;
  bytes ca_certificate = 2;
  bytes client_certificate = 3;
  bytes client_key = 4;
  int64 cert_expires_at = 5;
}

message RenewCertRequest {
  string node_id = 1;
}

message RenewCertResponse {
  bytes client_certificate = 1;
  bytes client_key = 2;
  int64 cert_expires_at = 3;
}
```

### 2.2 NodeControl Service

Bidirectional streaming — the main command channel.

```protobuf
service NodeControl {
  rpc CommandStream(stream DaemonMessage) returns (stream GatewayCommand);
}
```

**Daemon → Gateway messages:**

```protobuf
message DaemonMessage {
  oneof payload {
    RegisterMessage register = 1;
    CommandResult command_result = 2;
    HealthReport health_report = 3;
    StatsReport stats_report = 4;
    DaemonLogEntry daemon_log = 5;
  }
}

// Daemon's own operational logs (startup, connections, errors, command execution)
message DaemonLogEntry {
  string timestamp = 1;
  string level = 2;       // debug, info, warn, error
  string message = 3;
  string component = 4;   // e.g. "connector", "nginx.manager", "handler"
  map<string, string> fields = 5;  // structured log fields
}

message RegisterMessage {
  string node_id = 1;
  string hostname = 2;
  string nginx_version = 3;
  string config_version_hash = 4;
  string daemon_version = 5;
  int64 nginx_uptime_seconds = 6;
  bool nginx_running = 7;
}

message CommandResult {
  string command_id = 1;
  bool success = 2;
  string error = 3;
  string detail = 4;
}

message HealthReport {
  bool nginx_running = 1;
  bool config_valid = 2;
  int64 nginx_uptime_seconds = 3;
  int32 worker_count = 4;
  string nginx_version = 5;
  double cpu_percent = 6;
  int64 memory_bytes = 7;
  int64 disk_free_bytes = 8;
  int64 timestamp = 9;
}

message StatsReport {
  int64 active_connections = 1;
  int64 accepts = 2;
  int64 handled = 3;
  int64 requests = 4;
  int32 reading = 5;
  int32 writing = 6;
  int32 waiting = 7;
  int64 timestamp = 8;
}
```

**Gateway → Daemon commands:**

```protobuf
message GatewayCommand {
  string command_id = 1;
  oneof payload {
    ApplyConfigCommand apply_config = 2;
    RemoveConfigCommand remove_config = 3;
    DeployCertCommand deploy_cert = 4;
    RemoveCertCommand remove_cert = 5;
    FullSyncCommand full_sync = 6;
    UpdateGlobalConfigCommand update_global_config = 7;
    DeployHtpasswdCommand deploy_htpasswd = 8;
    TestConfigCommand test_config = 9;
    RequestHealthCommand request_health = 10;
    RequestStatsCommand request_stats = 11;
    SetDaemonLogStreamCommand set_daemon_log_stream = 12;
    RemoveHtpasswdCommand remove_htpasswd = 13;
    DeployAcmeChallengeCommand deploy_acme_challenge = 14;
    RemoveAcmeChallengeCommand remove_acme_challenge = 15;
  }
}

message ApplyConfigCommand {
  string host_id = 1;
  string config_content = 2;
  bool test_only = 3;
}

// Daemon also cleans up associated cache directory (/tmp/nginx-cache-{host_id}) on removal
message RemoveConfigCommand { string host_id = 1; }

// Cert deployment does NOT auto-reload nginx. Gateway sends a separate
// ApplyConfigCommand or TestConfigCommand + reload when ready. This allows
// deploying certs before the config that references them exists.
message DeployCertCommand {
  string cert_id = 1;
  bytes cert_pem = 2;
  bytes key_pem = 3;
  bytes chain_pem = 4;
}

message RemoveCertCommand { string cert_id = 1; }

message FullSyncCommand {
  repeated HostConfig hosts = 1;
  repeated CertBundle certs = 2;
  string global_config = 3;
  repeated HtpasswdFile htpasswd_files = 4;
  string version_hash = 5;
}

message HostConfig {
  string host_id = 1;
  string config_content = 2;
}

message CertBundle {
  string cert_id = 1;
  bytes cert_pem = 2;
  bytes key_pem = 3;
  bytes chain_pem = 4;
}

message HtpasswdFile {
  string access_list_id = 1;
  string content = 2;
}

message UpdateGlobalConfigCommand {
  string content = 1;
  string backup_content = 2;
}

message DeployHtpasswdCommand {
  string access_list_id = 1;
  string content = 2;
}

message RemoveHtpasswdCommand { string access_list_id = 1; }

message TestConfigCommand {}
message RequestHealthCommand {}
message RequestStatsCommand {}

// Controls daemon log streaming over the command channel
message SetDaemonLogStreamCommand {
  bool enabled = 1;           // true to start, false to stop
  string min_level = 2;       // minimum log level to stream: debug, info, warn, error
  int32 tail_lines = 3;       // initial lines from recent log buffer (0 = none)
}

// ACME HTTP-01 challenge file management
// Gateway writes challenge token files during cert issuance; daemon places them
// at {acme_challenge_dir}/.well-known/acme-challenge/{token} for nginx to serve
message DeployAcmeChallengeCommand {
  string token = 1;            // challenge token (filename)
  string content = 2;          // challenge response (file content)
}

message RemoveAcmeChallengeCommand {
  string token = 1;            // challenge token to remove
}
```

### 2.3 LogStream Service

Bidirectional streaming for log delivery.

```protobuf
service LogStream {
  rpc StreamLogs(stream LogStreamMessage) returns (stream LogStreamControl);
}

message LogStreamMessage {
  oneof payload {
    LogSubscribeAck subscribe_ack = 1;
    LogEntry entry = 2;
  }
}

message LogEntry {
  string host_id = 1;
  string timestamp = 2;
  string remote_addr = 3;
  string method = 4;
  string path = 5;
  int32 status = 6;
  int64 body_bytes_sent = 7;
  string referer = 8;
  string user_agent = 9;
  string upstream_response_time = 10;
  string raw = 11;
}

message LogStreamControl {
  oneof payload {
    LogSubscribe subscribe = 1;
    LogUnsubscribe unsubscribe = 2;
  }
}

message LogSubscribe {
  string host_id = 1;
  int32 tail_lines = 2;
}

message LogUnsubscribe { string host_id = 1; }
```

### 2.4 Connection Flow

1. Daemon dials `Gateway:9443` with mTLS
2. Opens `NodeControl.CommandStream()` bidirectional stream
3. Sends `RegisterMessage` as first message
4. Gateway validates mTLS cert CN matches `node_id`, stores stream reference in `NodeRegistry`
5. Gateway pushes commands via the stream; daemon sends results back
6. Command correlation via `command_id` (UUID) with timeout (30s config ops, 10s health checks)

For log streaming:
1. Frontend user starts watching logs for a host on node X
2. Gateway sends `LogSubscribe { host_id, tail_lines: 50 }` on the log stream
3. Daemon starts tailing and streaming `LogEntry` messages
4. On frontend disconnect, Gateway sends `LogUnsubscribe`

---

## 3. Gateway Backend Changes

### 3.1 New gRPC Server

Runs inside the existing Node.js process on a dedicated port (9443) alongside the Hono HTTP server.

New files:
```
packages/backend/src/
  grpc/
    server.ts                     # gRPC server setup, mTLS config
    services/
      enrollment.ts               # NodeEnrollment handlers
      control.ts                  # NodeControl command dispatch
      log-stream.ts               # LogStream relay
    interceptors/
      auth.ts                     # mTLS cert validation + node ID extraction
  services/
    node-registry.service.ts      # In-memory registry of connected nodes + stream handles
    node-dispatch.service.ts      # Routes operations to the correct daemon
```

### 3.2 NodeRegistryService

In-memory map of live connections, backed by the `nodes` DB table for persistence.

```typescript
interface ConnectedNode {
  nodeId: string;
  type: 'nginx' | 'bastion';
  hostname: string;
  commandStream: ServerDuplexStream<GatewayCommand, DaemonMessage>;
  logStream: ServerDuplexStream<LogStreamControl, LogStreamMessage> | null;
  connectedAt: Date;
  lastHealthReport: HealthReport | null;
  lastStatsReport: StatsReport | null;
  configVersionHash: string;
  pendingCommands: Map<string, { resolve, reject, timeout }>;
}
```

The `type` is populated from the `nodes` DB row when the daemon connects and sends its `RegisterMessage`.

Methods: `register()`, `deregister()`, `getNode()`, `getAllNodes()`, `getNodesByType(type)`, `sendCommand()` (returns `Promise<CommandResult>` correlated by `command_id`). `getNodesByType()` ensures `ProxyService` only sees nginx nodes and future bastion code only sees bastion nodes.

### 3.3 NodeDispatchService

Replaces `DockerService`. Every call site that previously did `dockerService.execInContainer(...)` now calls `nodeDispatch.applyConfig(nodeId, ...)` etc.

### 3.4 Refactors to Existing Code

| Current | After |
|---------|-------|
| `NginxService` (config gen + file I/O + Docker) | Split into `NginxConfigGenerator` (pure config generation — keep) + remove all file I/O and Docker calls |
| `DockerService` | Removed entirely |
| `ProxyService` | Gains `nodeId` awareness. Uses `NginxConfigGenerator` → `NodeDispatchService` |
| `NginxStatsService` | Reads from daemon `HealthReport`/`StatsReport` via `NodeRegistry` |
| `NginxConfigService` (global config) | Routes through daemon's `UpdateGlobalConfigCommand` |
| Log streaming SSE | Relays from daemon's `LogStream` gRPC stream |

### 3.5 Database Changes

**New `nodes` table:**

```sql
CREATE TABLE nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL DEFAULT 'nginx',  -- 'nginx' | 'bastion' (future)
  hostname VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',  -- pending | online | offline | error
  enrollment_token_hash VARCHAR(255),
  certificate_serial VARCHAR(255),
  certificate_expires_at TIMESTAMPTZ,
  daemon_version VARCHAR(50),
  os_info VARCHAR(255),
  config_version_hash VARCHAR(64),
  capabilities JSONB DEFAULT '{}',  -- type-specific: { nginx_version, config_dir, ... }
  last_seen_at TIMESTAMPTZ,
  last_health_report JSONB,
  last_stats_report JSONB,
  metadata JSONB DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Alter `proxy_hosts`:**

```sql
ALTER TABLE proxy_hosts ADD COLUMN node_id UUID REFERENCES nodes(id) ON DELETE SET NULL;
```

### 3.6 Frontend Additions

- **Nodes management page** (`/admin/nodes`) — list, status badges (online/offline/error), enroll new node button
- **Node detail page** — health metrics, assigned proxy hosts, nginx version, daemon logs (operational logs streamed via `SetDaemonLogStreamCommand`), service logs (nginx access/error via `LogStream`)
- **Proxy host form** — node selector dropdown (defaults to the default node)
- **Dashboard** — per-node status indicators

### 3.7 New Environment Variables

```
GRPC_PORT=9443                    # gRPC server listen port
GRPC_TLS_CERT=/path/to/cert      # Server TLS cert (from internal CA)
GRPC_TLS_KEY=/path/to/key        # Server TLS key
```

---

## 4. Authentication Flow

### 4.1 Node Enrollment

1. **Admin** clicks "Add Node" in Gateway UI → selects type (`nginx`) → Gateway generates secure random token (`gw_node_xxxxxxxxxxxxxxxxxxxx`), stores bcrypt hash in `nodes` table with status `pending`, displays token once
2. **Admin** installs daemon on target host:
   ```bash
   nginx-daemon install --gateway gateway.example.com:9443 --token gw_node_xxx
   ```
   This writes config.yaml and enables the systemd service
3. **Daemon** calls `NodeEnrollment.Enroll(token, hostname, nginx_version, ...)`
   - Initial connection uses server-side TLS only (no client cert yet). The daemon accepts the Gateway's server cert on first contact (trust-on-first-use / TOFU) and pins the CA cert received in the enrollment response for all subsequent connections.
   - Gateway verifies token hash matches a `pending` node
   - Gateway uses its internal CA to issue a client certificate (CN = node UUID, SAN = hostname)
   - Returns: CA cert, client cert, client key
4. **Daemon** saves certs to disk, reconnects with mTLS. Node status → `online`

### 4.2 Certificate Renewal

- Daemon tracks cert expiry. When within 7 days:
  1. Calls `RenewCertificate(nodeId)` using its still-valid cert for mTLS
  2. Gateway issues new cert from internal CA
  3. Daemon hot-swaps TLS credentials via Go's `tls.Config.GetClientCertificate` callback

### 4.3 Node Removal

When an admin removes a node from the Gateway UI:

1. Gateway checks if the node has assigned proxy hosts. If yes, admin must reassign or delete them first (UI blocks removal otherwise)
2. Gateway revokes the node's mTLS certificate via the internal CA
3. Gateway closes the gRPC command stream to the daemon (if connected)
4. Gateway deletes the `nodes` row (proxy_hosts.node_id is already NULL since hosts were reassigned)
5. Daemon detects stream closure, enters reconnect loop, but mTLS handshake fails (cert revoked) — daemon logs the error and stops retrying after N failures
6. Admin uninstalls the daemon from the host (`nginx-daemon uninstall` or manual cleanup)

Nginx on the host continues running with its last config. The admin is responsible for decommissioning or reconfiguring it.

### 4.4 Heartbeat & Stale Node Detection

The daemon sends `HealthReport` messages every 30 seconds (configurable via `HEALTH_CHECK_INTERVAL_SECONDS`).

Gateway-side stale detection:
- `NodeRegistryService` tracks `lastSeenAt` per node (updated on any `DaemonMessage` received)
- A background job runs every 60 seconds, checks all nodes: if `lastSeenAt` is older than 90 seconds (3 missed heartbeats), marks the node as `offline` in the DB
- gRPC keepalive is configured on both sides (keepalive interval: 30s, timeout: 10s) to detect dead connections faster than application-level heartbeats
- When the gRPC stream breaks (detected by keepalive or read error), `NodeRegistryService.deregister()` is called immediately, node status → `offline`, audit log entry created

---

## 5. Config Sync Protocol

### 5.1 Incremental Updates (Normal Operation)

1. User creates/updates proxy host in Gateway UI
2. Gateway generates nginx config string via `NginxConfigGenerator`
3. Gateway sends `ApplyConfigCommand { host_id, config_content }` via node's command stream
4. Daemon atomically writes config file
5. Daemon runs `nginx -t`
6. If test fails → sends `CommandResult { success: false, error: test_output }`, rolls back file
7. If test passes → runs `nginx -s reload`, sends `CommandResult { success: true }`
8. Gateway commits or rolls back DB change based on result

### 5.2 Full Sync (On Connect/Reconnect)

1. Daemon sends `RegisterMessage` with `config_version_hash`
2. Gateway compares hash with expected state
3. If different → sends `FullSyncCommand` with all configs, certs, htpasswd files, global config
4. Daemon processes: write certs → write htpasswd → write configs → remove stale files → `nginx -t` → reload
5. On success, daemon stores new version_hash. On failure, rolls back all changes.

### 5.3 Version Hash

`SHA-256(sorted(hostId:configHash) + globalConfigHash + sorted(certId:certHash))`

Both Gateway and daemon can independently compute this to detect drift.

### 5.4 Conflict Resolution

Gateway is authoritative. Daemon never generates configs independently — it only receives pre-rendered configs. On full sync, Gateway state overwrites daemon state.

### 5.5 Partial Failure & Crash Recovery

**FullSync partial failure:**
- If certs/htpasswd deploy succeeds but config write or `nginx -t` fails → daemon rolls back ALL changes (certs, htpasswd, configs) to pre-sync state and reports failure
- The version_hash is only updated after complete success — never after partial completion
- Gateway marks the node as `error` status and retries on next reconnect

**Daemon crash mid-operation:**
- On restart, daemon loads last-known version_hash from local state file
- Sends `RegisterMessage` with that hash — Gateway detects mismatch and triggers full sync
- Incomplete `.tmp` files from atomic writes are cleaned up on startup (scan config/cert dirs for `.tmp` suffix)

**Command timeout:**
- If a command times out (30s), Gateway does NOT retry automatically — it reports failure to the caller
- The daemon may still complete the operation after timeout; on next health report or reconnect, version hash reconciliation detects any drift

### 5.6 ACME HTTP-01 Challenge Flow

When Gateway needs to validate a domain via ACME HTTP-01 on a specific node:

1. Gateway determines which node hosts the proxy host (or which node should serve the domain)
2. Gateway sends `DeployAcmeChallengeCommand { token, content }` to the daemon
3. Daemon writes the challenge file to `{acme_challenge_dir}/.well-known/acme-challenge/{token}`
4. Gateway tells the ACME server to validate (existing `acme-client` logic)
5. ACME server hits `http://{domain}/.well-known/acme-challenge/{token}` → nginx serves it
6. After validation (success or failure), Gateway sends `RemoveAcmeChallengeCommand { token }` to clean up

The nginx config already includes a location block for `/.well-known/acme-challenge/` that serves from `acme_challenge_dir` — this is part of the per-host config generated by `NginxConfigGenerator`.

### 5.7 Certificate Renewal Orchestration

When an ACME cert auto-renews or an internal CA cert is re-issued:

1. Gateway generates new cert via existing `AcmeService` / `SslService`
2. Gateway sends `DeployCertCommand` to write new cert files to the node (no reload yet)
3. Gateway sends `ApplyConfigCommand` with the (unchanged) proxy host config that references the cert — this triggers `nginx -t` + reload, picking up the new cert files
4. If the proxy host config hasn't changed, Gateway sends `TestConfigCommand` to validate, then a no-op `ApplyConfigCommand` to force reload

This two-step approach (deploy cert → trigger reload) ensures certs are on disk before nginx tries to read them.

---

## 6. Health Checks

Proxy host health checks (HTTP requests to upstream targets) remain in the **Gateway backend**, not the daemon. Rationale:

- Health check results update the DB (`proxy_hosts.healthStatus`) — this is a Gateway concern
- The Gateway already has the cron job infrastructure for this
- Adding health check logic to the daemon would duplicate business logic and require syncing health check configuration

However, the Gateway must now account for multi-node: when checking a proxy host's upstream, the request originates from the Gateway, not from the node where nginx runs. If this becomes a problem (e.g., upstream is only reachable from the nginx node's network), a future `HealthCheckCommand` can be added to the daemon proto to delegate checks. This is out of scope for MVP.

---

## 7. Permissions & Audit

### 7.1 New Permission Scopes

Add node-specific scopes to the existing permission system:

| Scope | Description |
|-------|-------------|
| `nodes:view` | View node list, status, health reports |
| `nodes:manage` | Enroll/remove nodes, view enrollment tokens |

The existing `proxy:manage` scope continues to cover proxy host CRUD. Node selection when creating a proxy host is governed by `proxy:manage` (you need proxy management permission to assign a host to a node). Node enrollment/removal is a separate admin-level operation under `nodes:manage`.

No per-node scoping for proxy operations in MVP — a user with `proxy:manage` can manage hosts on any node. Per-node restrictions can be added later via resource suffixes (`proxy:manage:node-{id}`).

### 7.2 Audit Logging

All node operations are audit-logged via the existing `AuditService`:

| Action | Resource Type | Details |
|--------|--------------|---------|
| `node.enroll` | `node` | Node hostname, type |
| `node.remove` | `node` | Node ID |
| `node.config_push` | `node` | Host ID, success/failure |
| `node.cert_deploy` | `node` | Cert ID, node ID |
| `node.connected` | `node` | Daemon version, nginx version |
| `node.disconnected` | `node` | Reason (graceful, timeout, error) |

For operations triggered by automated jobs (ACME renewal, scheduled sync), the actor is `SYSTEM_USER_ID` — consistent with the existing pattern in `acme-renewal.job.ts`.

The `command_id` from gRPC commands is stored in the audit `details` JSONB field to correlate Gateway actions with daemon execution.

---

## 8. Migration Path

### Phase 1: Foundation

- Initialize Nx in the monorepo (migrate from pnpm workspaces)
- Set up `proto/` directory with buf.build config
- Define proto files
- Scaffold Go daemon project at `packages/daemons/nginx/`
- Implement daemon: config loading, nginx manager, gRPC client, enrollment, command handler, health/stats reporter, log tailer
- Test daemon standalone

### Phase 2: Gateway gRPC Server

- Add `@grpc/grpc-js` to backend
- Proto codegen for TypeScript
- Implement gRPC server (`grpc/server.ts`)
- Implement enrollment, control, log-stream services
- Add `nodes` table + Drizzle migration
- Add `node_id` to `proxy_hosts` + migration
- Implement `NodeRegistryService` and `NodeDispatchService`
- Wire into DI container (`bootstrap.ts`)

### Phase 3: Refactor Backend Services

- Split `NginxService` → `NginxConfigGenerator` (keep generation logic) + remove file I/O
- Refactor `ProxyService` to use `NodeDispatchService`
- Refactor `NginxStatsService` to read from daemon reports
- Refactor `NginxConfigService` to route through daemon
- Refactor log streaming to relay from daemon
- Remove `DockerService` entirely

### Phase 4: Frontend

- Nodes management page and node detail page
- Node selector in proxy host forms
- Dashboard per-node status
- Enrollment flow UI (generate token, show install command)
- Reuse existing shared components (tables, forms, status badges, dialogs, cards, etc.) everywhere they apply — do not create custom variants of components that already exist
- When new components are genuinely needed, carefully match the existing app design language (spacing, colors, typography, patterns) to avoid off-design inconsistencies

### Phase 5: Migration Tooling & Cleanup

- Update `install.sh` with `--with-daemon` mode
- Migration script: install host nginx, deploy daemon, migrate configs from Docker volumes, remove nginx container
- Update `docker-compose.yml`: remove nginx service, volumes, Docker socket mount; add gRPC port exposure
- Remove legacy env vars (`DOCKER_SOCKET_PATH`, `NGINX_CONTAINER_NAME`)
- Update documentation

---

## 9. Critical Files

### Files to Create
- `proto/gateway/v1/nginx-daemon.proto`
- `packages/daemons/nginx/` (entire Go project)
- `packages/backend/src/grpc/server.ts`
- `packages/backend/src/grpc/services/enrollment.ts`
- `packages/backend/src/grpc/services/control.ts`
- `packages/backend/src/grpc/services/log-stream.ts`
- `packages/backend/src/grpc/interceptors/auth.ts`
- `packages/backend/src/services/node-registry.service.ts`
- `packages/backend/src/services/node-dispatch.service.ts`
- `packages/backend/src/modules/nodes/` (node module: routes, service, DTOs)
- `packages/backend/src/db/schema/nodes.ts`
- New Drizzle migration for `nodes` table + `proxy_hosts.node_id`

### Files to Refactor
- `packages/backend/src/services/nginx.service.ts` → split into `NginxConfigGenerator`
- `packages/backend/src/modules/proxy/proxy.service.ts` → add nodeId dispatch
- `packages/backend/src/modules/monitoring/nginx-stats.service.ts` → read from daemon
- `packages/backend/src/modules/monitoring/nginx-config.service.ts` → route through daemon
- `packages/backend/src/modules/ssl/acme.service.ts` → ACME challenge deployment via daemon instead of local file write
- `packages/backend/src/modules/ssl/ssl.service.ts` → cert deployment via NodeDispatchService
- `packages/backend/src/lib/scopes.ts` → add `nodes:view`, `nodes:manage` scopes
- `packages/backend/src/modules/audit/audit.service.ts` → add node operation audit actions
- `packages/backend/src/bootstrap.ts` → wire new services, add gRPC server init
- `packages/backend/src/config/env.ts` → add GRPC_PORT, GRPC_TLS_* vars

### Files to Remove
- `packages/backend/src/services/docker.service.ts`
- Docker socket mount from `docker-compose.yml`
- `nginx` service from `docker-compose.yml`

### Frontend (New Pages)
- `packages/frontend/src/pages/admin/nodes/` — node management
- `packages/frontend/src/components/nodes/` — node-related components
- Updates to proxy host forms for node selection
