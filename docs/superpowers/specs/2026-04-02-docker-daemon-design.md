# Docker Daemon Design Spec

## Context

Gateway currently supports two daemon types: **nginx** (reverse proxy management) and **monitoring** (system metrics only). Both use the shared daemon library (`packages/daemons/shared/`) and communicate with Gateway over gRPC via `CommandStream`.

**Problem:** Users who want to manage Docker containers on remote hosts must use separate tools (Portainer, SSH + docker CLI, or the existing standalone `wltd` daemon which uses a different protocol). There's no unified management experience.

**Solution:** A new **docker daemon** that extends the shared daemon library, connects to Gateway via the same gRPC protocol, and provides full Docker container lifecycle management. Gateway becomes a simple Portainer alternative — users can deploy, manage, monitor, and debug containers from the same UI they use for proxy and certificate management.

**Scope:** Plain Docker containers only (docker compose / docker run). No Docker Swarm support in this phase.

**Reference:** The existing `wltd` daemon (`/workspace/wiolett/docker-daemon/`) serves as architectural reference for Docker SDK usage patterns, container recreation strategy, and environment override management.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Communication protocol | gRPC (same `CommandStream`) | Consistent with nginx/monitoring daemons, bidirectional streaming for exec/logs |
| Docker SDK | `github.com/docker/docker` client | Same library as `wltd`, well-maintained, full Docker API coverage |
| Container exec | WebSocket → Gateway → gRPC bidirectional stream | Central auth, no daemon ports exposed to users |
| Swarm support | Deferred to Phase 2 | Plain containers cover the primary use case; Swarm adds significant complexity |
| Registry credentials | Stored encrypted in Gateway DB, pushed to daemon | Centralized management, no manual daemon config for registries |
| Container allowlist | Configurable from Gateway UI, pushed to daemon | Two-layer access: daemon allowlist + Gateway group permissions |
| File browser | Read-only via `docker exec` | No Docker volumes mount needed, works universally |
| Async tasks | Daemon reports progress via gRPC, Gateway stores in DB | Long-running ops (image pull, redeploy) tracked and visible in UI |
| Stats collection | `docker stats` API, periodic per-container snapshots | Consistent with system metrics pattern; sent alongside health reports |

---

## 1. Daemon Architecture

### 1.1 Project Structure

```
packages/daemons/docker/
  go.mod
  Makefile
  docker-daemon.example.yaml
  cmd/docker-daemon/
    main.go                           # run / install / version subcommands
  internal/
    docker/
      plugin.go                       # DockerPlugin implements DaemonPlugin
      client.go                       # Docker SDK wrapper (container/image/volume/network ops)
      stats.go                        # Container stats collection (CPU/mem/net/disk per container)
      exec.go                         # Interactive exec session management
      files.go                        # File browser via docker exec (ls, cat)
      tasks.go                        # Async task tracking (pull, redeploy)
      allowlist.go                    # Allowlist resolution and enforcement
      envstore.go                     # Per-container env override persistence
    config/
      config.go                       # Config embeds shared.BaseConfig + Docker section
```

### 1.2 DockerPlugin

Implements the `DaemonPlugin` interface from `shared/lifecycle/plugin.go`:

```go
Type()                → "docker"
Init(cfg, logger)     → connect to Docker socket, verify Docker is running
BuildRegisterMessage  → hostname, docker_version, container_count, daemon_type="docker"
HandleCommand(cmd)    → dispatch to container/image/volume/network/exec/file handlers
CollectHealth(base)   → layer Docker engine info + per-container stats on system metrics
CollectStats()        → nil (container stats are in health report)
OnSessionStart(ctx)   → start container stats polling goroutine
OnSessionEnd()        → stop polling
```

### 1.3 Docker Client Wrapper

Wraps `github.com/docker/docker/client` with Gateway-specific operations:

**Container operations:**
- `ListContainers()` — all containers matching allowlist, with state/image/ports/status
- `CreateContainer(config)` — create from image with full config (ports, volumes, env, networks, restart policy, labels)
- `StartContainer(id)`, `StopContainer(id, timeout)`, `RestartContainer(id, timeout)`, `KillContainer(id, signal)`
- `RemoveContainer(id, force)` — with optional force (removes running container)
- `InspectContainer(id)` — full container details
- `RenameContainer(id, newName)`
- `DuplicateContainer(id, newName)` — inspect source, create new with same config + new name
- `UpdateContainer(id, tag, env, removeEnv)` — pull new image tag, recreate with env overrides
- `ContainerLogs(id, tail, follow)` — log tail or streaming

**Image operations:**
- `ListImages()` — all local images with size/tags/created
- `PullImage(ref, registryAuth)` — pull with optional registry credentials
- `RemoveImage(id, force)`
- `PruneImages()` — remove dangling images

**Volume operations:**
- `ListVolumes()` — with usage info (which containers use each)
- `CreateVolume(name, driver, labels)`
- `RemoveVolume(name, force)`

**Network operations:**
- `ListNetworks()` — with connected containers
- `CreateNetwork(name, driver, subnet, gateway)`
- `RemoveNetwork(id)`
- `ConnectContainer(networkId, containerId)`
- `DisconnectContainer(networkId, containerId)`

**Exec operations:**
- `ExecCreate(containerId, cmd, tty, stdin)` — create exec instance
- `ExecAttach(execId)` — attach for bidirectional I/O (interactive shell)
- `ExecInspect(execId)` — check exit code

**File browser:**
- `ListDir(containerId, path)` — `ls -la` via exec, parsed into entries
- `ReadFile(containerId, path, maxBytes)` — `cat` via exec with size limit

### 1.4 Container Stats Collection

Runs as a background goroutine during active session:
- Polls `docker stats` API every 10 seconds for all allowlisted containers
- Collects: CPU%, memory usage/limit, network rx/tx bytes, block read/write bytes
- Included in `HealthReport` as a new `repeated ContainerStats` field
- Gateway stores snapshots for historical charts

### 1.5 Async Task Management

Long-running operations (image pull, container update/redeploy) are tracked as tasks:
- Each task has: id, type, containerId, status (pending/running/succeeded/failed), progress, error
- Daemon reports task status updates via `CommandResult` with task details in `detail` field (JSON)
- At-most-one-in-flight per container (prevents conflicting operations)
- Tasks auto-expire after 1 hour

### 1.6 Environment Override Persistence

Ported from `wltd`'s `envstore` pattern:
- Overrides stored at `/var/lib/docker-daemon/envstore/<container-name>.env`
- Applied on top of container's original env (override wins on conflict)
- `ComputeRemovals()` detects stale env vars on redeploy
- Pushed from Gateway when user edits env in UI

### 1.7 Allowlist

- Stored in daemon config, updatable via Gateway push command
- `*` means all containers on host
- Explicit list: container names/IDs that the daemon is allowed to manage
- Every container operation checks allowlist before proceeding
- Gateway can update allowlist at runtime (no daemon restart needed)

### 1.8 Config

```yaml
gateway:
  address: "gateway.example.com:9443"
tls:
  ca_cert: "/etc/docker-daemon/certs/ca.pem"
  client_cert: "/etc/docker-daemon/certs/node.pem"
  client_key: "/etc/docker-daemon/certs/node-key.pem"
state_dir: "/var/lib/docker-daemon"
log_level: "info"

docker:
  socket: "unix:///var/run/docker.sock"
  allowlist: ["*"]                    # "*" = all, or explicit container names
```

---

## 2. Proto Changes

### 2.1 New Docker Command Messages

Add to `GatewayCommand.payload` oneof:

```protobuf
// Docker container commands
DockerContainerCommand docker_container = 18;
DockerImageCommand docker_image = 19;
DockerVolumeCommand docker_volume = 20;
DockerNetworkCommand docker_network = 21;
DockerExecCommand docker_exec = 22;
DockerFileCommand docker_file = 23;
DockerConfigPushCommand docker_config_push = 24;
DockerLogsCommand docker_logs = 25;
```

### 2.2 Docker Container Command

```protobuf
message DockerContainerCommand {
  string action = 1;              // "list", "create", "start", "stop", "restart",
                                  // "kill", "remove", "inspect", "rename",
                                  // "duplicate", "update"
  string container_id = 2;        // target container (empty for "list" and "create")
  string config_json = 3;         // JSON-encoded container config (for create/update)
  int32 timeout_seconds = 4;      // for stop/restart (default 30)
  string signal = 5;              // for kill (default SIGKILL)
  string new_name = 6;            // for rename/duplicate
  bool force = 7;                 // for remove (force-remove running container)
}
```

### 2.3 Docker Image Command

```protobuf
message DockerImageCommand {
  string action = 1;              // "list", "pull", "remove", "prune"
  string image_ref = 2;           // image reference (for pull/remove)
  string registry_auth_json = 3;  // base64-encoded registry credentials
  bool force = 4;                 // for remove
}
```

### 2.4 Docker Volume/Network Commands

```protobuf
message DockerVolumeCommand {
  string action = 1;              // "list", "create", "remove"
  string name = 2;
  string driver = 3;
  map<string, string> labels = 4;
  bool force = 5;
}

message DockerNetworkCommand {
  string action = 1;              // "list", "create", "remove", "connect", "disconnect"
  string network_id = 2;
  string container_id = 3;        // for connect/disconnect
  string driver = 4;
  string subnet = 5;
  string gateway_addr = 6;        // "gateway_addr" to avoid name clash with gateway
}
```

### 2.5 Docker Exec Command

```protobuf
message DockerExecCommand {
  string action = 1;              // "create", "resize"
  string container_id = 2;
  repeated string command = 3;    // e.g. ["/bin/bash"]
  bool tty = 4;
  bool stdin = 5;
  int32 rows = 6;                 // terminal size for resize
  int32 cols = 7;
}
```

For interactive exec, bidirectional data flows through existing `DaemonMessage`/`GatewayCommand` stream using a new payload type:

```protobuf
// Added to DaemonMessage.payload oneof:
ExecOutput exec_output = 6;

// Added to GatewayCommand.payload oneof:
ExecInput exec_input = 26;

message ExecOutput {
  string exec_id = 1;
  bytes data = 2;
  bool exited = 3;
  int32 exit_code = 4;
}

message ExecInput {
  string exec_id = 1;
  bytes data = 2;
}
```

### 2.6 Docker File Browser Command

```protobuf
message DockerFileCommand {
  string action = 1;              // "list_dir", "read_file"
  string container_id = 2;
  string path = 3;
  int64 max_bytes = 4;            // for read_file (default 1MB)
}
```

### 2.7 Docker Logs Command

```protobuf
message DockerLogsCommand {
  string container_id = 1;
  int32 tail_lines = 2;           // default 100
  bool follow = 3;                // stream logs continuously
  bool timestamps = 4;
}
```

### 2.8 Docker Config Push

```protobuf
message DockerConfigPushCommand {
  repeated RegistryConfig registries = 1;
  repeated string allowlist = 2;   // container allowlist update
}

message RegistryConfig {
  string url = 1;
  string username = 2;
  string password = 3;
}
```

### 2.9 Container Stats in Health Report

Add to `HealthReport`:

```protobuf
// Docker
repeated ContainerStats container_stats = 28;
string docker_version = 29;
int32 containers_running = 30;
int32 containers_stopped = 31;
int32 containers_total = 32;

message ContainerStats {
  string container_id = 1;
  string name = 2;
  string image = 3;
  string state = 4;               // "running", "exited", "paused", etc.
  double cpu_percent = 5;
  int64 memory_usage_bytes = 6;
  int64 memory_limit_bytes = 7;
  int64 network_rx_bytes = 8;
  int64 network_tx_bytes = 9;
  int64 block_read_bytes = 10;
  int64 block_write_bytes = 11;
  int64 pids = 12;
}
```

---

## 3. Backend Changes

### 3.1 DB Migration

**Migration:** `0012_add_docker_node_type.sql`

```sql
ALTER TYPE "public"."node_type" ADD VALUE IF NOT EXISTS 'docker';
```

**New tables:**

```sql
-- Docker registries (global or per-node)
CREATE TABLE "docker_registries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "url" text NOT NULL,
  "username" text,
  "encrypted_password" text,
  "scope" text NOT NULL DEFAULT 'global',   -- 'global' or 'node'
  "node_id" uuid REFERENCES "nodes"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  UNIQUE("url", "node_id")
);

-- Docker container templates
CREATE TABLE "docker_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "description" text,
  "config" jsonb NOT NULL,                  -- full container config
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Async docker tasks (image pulls, redeploys, etc.)
CREATE TABLE "docker_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id" uuid NOT NULL REFERENCES "nodes"("id") ON DELETE CASCADE,
  "container_id" text,
  "container_name" text,
  "type" text NOT NULL,                     -- 'pull', 'create', 'update', 'remove', 'prune'
  "status" text NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'succeeded', 'failed'
  "progress" text,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);
```

### 3.2 Schema Updates

**`packages/backend/src/db/schema/nodes.ts`:**
- Add `'docker'` to `nodeTypeEnum`: `['nginx', 'bastion', 'monitoring', 'docker']`

**New schema files:**
- `packages/backend/src/db/schema/docker-registries.ts`
- `packages/backend/src/db/schema/docker-templates.ts`
- `packages/backend/src/db/schema/docker-tasks.ts`

### 3.3 gRPC Layer

**`src/grpc/services/control.ts`:**
- Handle `daemon_type: "docker"` in registration
- Store `dockerVersion` in capabilities
- Docker command dispatch: serialize container/image/volume/network commands to proto
- Handle exec stream: proxy WebSocket ↔ gRPC bidirectional stream
- Task status updates: parse `CommandResult.detail` JSON for task progress, store in `docker_tasks`
- Health history: docker node healthy = daemon connected + Docker engine responsive
- Skip nginx-specific operations for docker nodes

**`src/grpc/generated/types.ts`:**
- Add all new Docker message types

### 3.4 New Module: `src/modules/docker/`

```
packages/backend/src/modules/docker/
  docker.routes.ts              # REST API endpoints
  docker.service.ts             # Business logic, command dispatch
  docker.schemas.ts             # Zod validation schemas
  docker-registry.service.ts    # Registry CRUD + credential encryption
  docker-template.service.ts    # Template CRUD
  docker-task.service.ts        # Task tracking + cleanup
```

**REST Endpoints:**

```
# Containers (per node)
GET    /api/docker/nodes/:nodeId/containers              # list containers
POST   /api/docker/nodes/:nodeId/containers              # create container
GET    /api/docker/nodes/:nodeId/containers/:id           # inspect
POST   /api/docker/nodes/:nodeId/containers/:id/start
POST   /api/docker/nodes/:nodeId/containers/:id/stop
POST   /api/docker/nodes/:nodeId/containers/:id/restart
POST   /api/docker/nodes/:nodeId/containers/:id/kill
DELETE /api/docker/nodes/:nodeId/containers/:id           # remove
POST   /api/docker/nodes/:nodeId/containers/:id/rename
POST   /api/docker/nodes/:nodeId/containers/:id/duplicate
POST   /api/docker/nodes/:nodeId/containers/:id/update    # pull + redeploy
GET    /api/docker/nodes/:nodeId/containers/:id/logs
GET    /api/docker/nodes/:nodeId/containers/:id/stats
GET    /api/docker/nodes/:nodeId/containers/:id/env
PUT    /api/docker/nodes/:nodeId/containers/:id/env

# Exec (WebSocket upgrade)
GET    /api/docker/nodes/:nodeId/containers/:id/exec      # WebSocket

# File browser
GET    /api/docker/nodes/:nodeId/containers/:id/files     # ?path=/app
GET    /api/docker/nodes/:nodeId/containers/:id/files/read # ?path=/app/config.yml

# Images (per node)
GET    /api/docker/nodes/:nodeId/images
POST   /api/docker/nodes/:nodeId/images/pull
DELETE /api/docker/nodes/:nodeId/images/:id
POST   /api/docker/nodes/:nodeId/images/prune

# Volumes (per node)
GET    /api/docker/nodes/:nodeId/volumes
POST   /api/docker/nodes/:nodeId/volumes
DELETE /api/docker/nodes/:nodeId/volumes/:name

# Networks (per node)
GET    /api/docker/nodes/:nodeId/networks
POST   /api/docker/nodes/:nodeId/networks
DELETE /api/docker/nodes/:nodeId/networks/:id
POST   /api/docker/nodes/:nodeId/networks/:id/connect
POST   /api/docker/nodes/:nodeId/networks/:id/disconnect

# Registries (global)
GET    /api/docker/registries
POST   /api/docker/registries
PUT    /api/docker/registries/:id
DELETE /api/docker/registries/:id
POST   /api/docker/registries/:id/test

# Templates
GET    /api/docker/templates
POST   /api/docker/templates
PUT    /api/docker/templates/:id
DELETE /api/docker/templates/:id
POST   /api/docker/templates/:id/deploy                   # deploy from template

# Tasks
GET    /api/docker/tasks                                  # list all, filterable
GET    /api/docker/tasks/:id
```

### 3.5 Permissions

New scopes added to `ALL_SCOPES`:

```typescript
// Docker
'docker:list',          // list containers across nodes
'docker:view',          // inspect container details, logs, stats
'docker:create',        // create/deploy containers
'docker:edit',          // start/stop/restart/rename/env/update
'docker:delete',        // remove containers
'docker:exec',          // interactive console (high privilege, separate scope)
'docker:files',         // file browser inside containers
'docker:images',        // image management (list/pull/remove/prune)
'docker:volumes',       // volume management
'docker:networks',      // network management
'docker:registries',    // registry configuration (CRUD)
'docker:templates',     // template management
'docker:tasks',         // view tasks
```

**Resource-scoped permissions:**
- `docker:view:<container-name>` — per-container group access
- `docker:edit:<container-name>`, `docker:exec:<container-name>`, etc.
- Groups can be granted access to specific containers only

**Built-in group updates:**
- `system-admin` / `admin`: all docker scopes
- `operator`: `docker:list`, `docker:view`, `docker:edit`, `docker:tasks`, `docker:templates` (read)
- `viewer`: `docker:list`, `docker:view`

### 3.6 WebSocket Exec Proxy

For interactive terminal sessions:

1. Frontend opens WebSocket to `GET /api/docker/nodes/:nodeId/containers/:id/exec`
2. Backend authenticates, checks `docker:exec` scope (+ resource scope if applicable)
3. Backend sends `DockerExecCommand` to daemon via gRPC stream
4. Daemon creates exec instance with TTY, attaches
5. Bidirectional data flow:
   - Frontend → WebSocket → Backend → `ExecInput` gRPC → Daemon → Docker exec stdin
   - Docker exec stdout → Daemon → `ExecOutput` gRPC → Backend → WebSocket → Frontend
6. Terminal resize: Frontend sends resize event → Backend → `DockerExecCommand(action: "resize")` → Daemon

### 3.7 Registry Credential Sync

When a docker node comes online or registry config changes:
1. Backend collects applicable registries (global + node-specific)
2. Sends `DockerConfigPushCommand` with decrypted credentials
3. Daemon stores credentials in memory (never written to disk)
4. Used for `docker pull` auth headers

### 3.8 Other Backend Updates

**Node routes (`src/modules/nodes/nodes.routes.ts`):**
- Guard docker-specific endpoints for `node.type === 'docker'`
- Skip nginx-specific routes for docker nodes

**Node schemas (`src/modules/nodes/nodes.schemas.ts`):**
- Add `'docker'` to zod enums

**Node monitoring (`src/modules/nodes/node-monitoring.service.ts`):**
- Handle docker container stats in health snapshots
- Skip traffic stats for docker nodes

**Monitoring service (`src/modules/monitoring/monitoring.service.ts`):**
- Include docker node counts in dashboard stats

**AI service (`src/modules/ai/`):**
- Add docker-related tools and internal documentation
- Container management via AI assistant

---

## 4. Frontend Changes

### 4.1 Navigation

Add "Docker" section to sidebar in `DashboardLayout.tsx`:

```typescript
{
  label: "Docker",
  items: [
    { name: "Containers", href: "/docker/containers", icon: Box, scope: "docker:list" },
    { name: "Images", href: "/docker/images", icon: Layers, scope: "docker:images" },
    { name: "Volumes", href: "/docker/volumes", icon: HardDrive, scope: "docker:volumes" },
    { name: "Networks", href: "/docker/networks", icon: Network, scope: "docker:networks" },
    { name: "Templates", href: "/docker/templates", icon: FileCode, scope: "docker:templates" },
    { name: "Tasks", href: "/docker/tasks", icon: ListTodo, scope: "docker:tasks" },
  ],
}
```

Registries goes under existing Settings page as a new tab/section.

### 4.2 Routes

```typescript
// Docker
<Route path="/docker/containers" element={scoped("docker:list", <DockerContainers />)} />
<Route path="/docker/containers/:nodeId/:containerId" element={scoped("docker:view", <DockerContainerDetail />)} />
<Route path="/docker/images" element={scoped("docker:images", <DockerImages />)} />
<Route path="/docker/volumes" element={scoped("docker:volumes", <DockerVolumes />)} />
<Route path="/docker/networks" element={scoped("docker:networks", <DockerNetworks />)} />
<Route path="/docker/templates" element={scoped("docker:templates", <DockerTemplates />)} />
<Route path="/docker/tasks" element={scoped("docker:tasks", <DockerTasks />)} />
```

### 4.3 Pages

**Docker Containers (`/docker/containers`)**
- Table: name, image, status (with colored badge), node, CPU%, memory, uptime
- Node filter dropdown (select specific docker node or "All nodes")
- Status filter (running, stopped, all)
- Search by name/image
- Inline actions: start/stop/restart/remove (with confirmation)
- Create button → dialog:
  - Image reference (with registry selector)
  - Container name
  - Node selector
  - Port mappings (host:container)
  - Volume mounts (host:container or named volume)
  - Environment variables (key-value pairs)
  - Network selection
  - Restart policy (no, always, unless-stopped, on-failure)
  - "Deploy from template" option (loads template config into form)
  - "Save as template" checkbox

**Container Detail (`/docker/containers/:nodeId/:containerId`)**

Seven tabs:

1. **Overview** — status badge, image tag, container ID, created date, uptime, ports, volumes, networks, restart policy, labels. Quick action buttons (start/stop/restart/kill/remove/rename/duplicate). Node link.

2. **Logs** — live tail with:
   - Line count selector (100/500/1000/all)
   - Auto-scroll toggle
   - Search/filter input
   - Timestamps toggle
   - Follow mode (WebSocket stream)
   - Download button (export as text)
   - Stdout/stderr toggle

3. **Console** — web terminal using xterm.js:
   - Shell selector dropdown (sh, bash, zsh, ash)
   - Terminal resizes with viewport
   - Connection status indicator
   - Requires `docker:exec` scope (show "no access" message otherwise)

4. **Files** — read-only file browser:
   - Tree/list view with breadcrumb navigation
   - File content viewer (syntax highlighted for known types)
   - File size and permissions shown
   - Path input for direct navigation
   - Max file size limit (1MB) with warning

5. **Stats** — real-time charts:
   - CPU usage % (line chart, last 1h)
   - Memory usage / limit (area chart with limit line)
   - Network I/O rx/tx (line chart)
   - Block I/O read/write (line chart)
   - PID count
   - Auto-refresh every 10s

6. **Environment** — key-value editor:
   - Table of current env vars (name, value, source badge: "container" or "override")
   - Add/edit/remove overrides
   - Save button triggers confirmation: "This will restart the container. Continue?"
   - Diff view showing what will change

7. **Config** — full inspect view:
   - JSON viewer (collapsible, syntax highlighted)
   - Editable settings: restart policy, labels
   - Save triggers container update

**Docker Images (`/docker/images`)**
- Table per node: repository, tag, image ID (short), size, created
- Node filter dropdown
- Pull button → dialog (image reference, registry selector, node selector)
- Remove button (with confirmation, shows dependent containers warning)
- Prune button: remove all dangling images (shows space to be freed)
- Bulk actions: prune across all nodes

**Docker Volumes (`/docker/volumes`)**
- Table per node: name, driver, mount point, size, containers using it
- Node filter
- Create button → dialog (name, driver, labels, node)
- Remove button (disabled if in use, force option)

**Docker Networks (`/docker/networks`)**
- Table per node: name, driver, subnet, gateway, connected containers
- Node filter
- Create button → dialog (name, driver, subnet, gateway, node)
- Remove button (disabled if containers connected)
- Connect/disconnect container buttons

**Docker Templates (`/docker/templates`)**
- Card/table list: name, description, image, created by, date
- Create: save current container config as template
- Edit: modify template config
- Deploy: select node → fill/override values → create container
- Delete (with confirmation)
- Import/Export as JSON

**Docker Tasks (`/docker/tasks`)**
- Table: type, container, node, status (badge), progress, started, duration, error
- Auto-refresh every 5s
- Filter by: node, type, status
- Status badges: pending (gray), running (blue with spinner), succeeded (green), failed (red)
- Click to expand: full error details, task log
- Clear completed tasks button

### 4.4 Registries (Settings Page)

New section/tab on `/settings`:

- Table: name, URL, scope (global/node badge), node name if scoped
- Add button → dialog:
  - Name
  - URL (e.g., `registry.example.com`, `ghcr.io`, `docker.io`)
  - Username (optional)
  - Password (masked, optional)
  - Scope toggle: Global / Specific node (with node selector)
- Edit, Delete buttons
- Test connection button (attempts to reach registry API)

### 4.5 Node Detail Integration

**Node list (`/nodes`):**
- Add `'docker'` to create dialog type selector
- Show different setup command for docker node type

**Node detail (`/nodes/:id`):**
- For docker nodes, show tabs: Details, Monitoring, Daemon Logs (same as monitoring)
- Details tab: show Docker version, container counts (running/stopped/total) in Runtime section
- Monitoring tab: system metrics + aggregate Docker resource usage
- Link to Docker Containers page filtered by this node

### 4.6 Types

**`src/types/index.ts`:**
- Add `'docker'` to `NodeType`
- Add Docker-related interfaces:

```typescript
interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: DockerPort[];
  volumes: DockerMount[];
  networks: string[];
  created: string;
  labels: Record<string, string>;
  // Stats (when available)
  cpuPercent?: number;
  memoryUsage?: number;
  memoryLimit?: number;
  networkRx?: number;
  networkTx?: number;
}

interface DockerImage { ... }
interface DockerVolume { ... }
interface DockerNetwork { ... }
interface DockerTemplate { ... }
interface DockerTask { ... }
interface DockerRegistry { ... }
```

### 4.7 API Client

Add to `src/services/api.ts`:
- All Docker REST endpoint methods
- WebSocket connection helper for exec sessions
- WebSocket connection helper for log streaming

---

## 5. Setup Script

**New:** `scripts/setup-docker-node.sh`

Same interactive pattern as `setup-monitoring-node.sh`:
- Downloads `docker-daemon` binary from releases
- Verifies Docker is installed and running
- Interactive prompts: gateway host, port, enrollment token
- Creates config at `/etc/docker-daemon/config.yaml`
- Creates systemd unit `docker-daemon.service`
- Enrolls with Gateway
- Starts the daemon

Pre-check: verifies `docker` CLI exists and Docker socket is accessible.

---

## 6. Access Control Model

### Two Layers

**Layer 1: Daemon Allowlist**
- Configurable from Gateway UI (per node)
- `*` = all containers on host, or explicit list of container names
- Pushed to daemon via `DockerConfigPushCommand`
- Daemon refuses to operate on containers not in allowlist
- First line of defense

**Layer 2: Gateway Group Permissions**
- Standard scope-based: `docker:list`, `docker:view`, etc.
- Resource-scoped: `docker:view:myapp-web` grants view access only to container `myapp-web`
- Groups can combine: "dev team" gets `docker:view:*` + `docker:edit:staging-*` + `docker:exec:staging-*`
- Admin groups get all docker scopes

### Access Flow

```
User request → Gateway auth middleware
  → Check base scope (e.g., docker:edit)
  → Check resource scope if applicable (e.g., docker:edit:container-name)
  → Route to docker service
  → Service sends command to daemon via gRPC
  → Daemon checks allowlist
  → Daemon executes Docker operation
  → Result flows back
```

---

## 7. Verification

1. **Daemon enrollment:** Create docker node in UI, run `docker-daemon install`, verify node appears online with Docker version in capabilities
2. **Container listing:** Containers on host appear in UI, filtered by allowlist
3. **Container lifecycle:** Create, start, stop, restart, kill, remove all work from UI
4. **Container deploy:** Pull image from configured registry, create container with full config
5. **Logs:** Live tail and follow mode work in UI
6. **Console:** Interactive shell via xterm.js, resize works, exit properly cleans up
7. **File browser:** Navigate directories, read files inside containers
8. **Stats:** Per-container CPU/memory/network charts populate
9. **Environment:** Edit env vars, save triggers container recreation, values persist
10. **Images:** List, pull, remove, prune from UI
11. **Volumes/Networks:** CRUD operations from UI
12. **Registries:** Add registry with credentials, pull image from private registry works
13. **Templates:** Save container config as template, deploy from template on different node
14. **Tasks:** Long-running operations show progress, completion status visible
15. **Permissions:** User with `docker:view` but not `docker:exec` cannot open console
16. **Resource permissions:** User with `docker:view:myapp` can only see that container
17. **Allowlist:** Container not in daemon allowlist is invisible in UI
18. **Node detail:** Docker nodes show correct type, Docker info in Runtime section
19. **Multi-node:** Containers from multiple docker nodes visible in single list, filterable
