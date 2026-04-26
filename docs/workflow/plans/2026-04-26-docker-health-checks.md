# Docker Health Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` by default, or `subagent-driven-development` when the `multi-agent-workflows` plugin is installed and you want same-session multi-agent execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gateway-owned health checks, health bars, notifications, and status-page support for normal Docker containers and blue/green Docker deployments.

**Architecture:** Add a Docker health-check persistence layer that stores configuration, current status, and rolling history for `container` and `deployment` targets. A backend job probes reachable HTTP endpoints through Docker node host ports, records state transitions, publishes notification events, and feeds status-page source resolution. Frontend uses one shared health-check settings block and the existing `HealthBars` component across normal container and deployment settings/detail/list views.

**Tech Stack:** TypeScript, Drizzle/Postgres migrations, Hono routes, existing scheduler/event bus/notification evaluator/status page services, React, existing shadcn-style UI primitives, Docker node APIs.

---

## Locked Decisions

- Use option 3: a Docker-owned health-check system.
- Normal containers: health checks are disabled until the user selects a published HTTP host port.
- Deployments: health checks are enabled by default from the primary route.
- Deployment health reflects the active slot route only.
- Readiness and ongoing health share the same destination/config shape, but readiness still gates deployment switches while ongoing health drives bars, notifications, and status page.
- Internal router/slot containers remain hidden and cannot be selected as status-page services.
- UI must reuse existing local UI patterns and shared components; no custom visual language.

## File Structure

Backend:
- Create `packages/backend/src/db/schema/docker-health-checks.ts`: Docker health-check table and types.
- Modify `packages/backend/src/db/schema/index.ts`: export the new schema.
- Create `packages/backend/src/db/migrations/0019_docker_health_checks.sql`: table, enum-like constraints, indexes, and status-page source enum extension.
- Create `packages/backend/src/modules/docker/docker-health-check.schemas.ts`: zod schemas for get/upsert payloads.
- Create `packages/backend/src/modules/docker/docker-health-check.service.ts`: validation, config CRUD, endpoint resolution, probe execution, status/history writes, and event publication.
- Create `packages/backend/src/modules/docker/docker-health-check.routes.ts`: session-only endpoints for containers and deployments.
- Modify `packages/backend/src/modules/docker/docker.routes.ts`: register health-check routes.
- Modify `packages/backend/src/bootstrap.ts`: instantiate service and schedule the job.
- Modify `packages/backend/src/modules/docker/docker.service.ts`: include health fields in synthetic/list rows and block internals.
- Modify `packages/backend/src/modules/docker/docker-deployment.service.ts`: create default deployment health config row and expose health on detail/list rows.
- Modify `packages/backend/src/modules/notifications/notification.constants.ts`: add container health events and template variables.
- Modify `packages/backend/src/modules/status-page/status-page.service.ts`: resolve Docker container/deployment sources.
- Modify `packages/backend/src/modules/status-page/status-page.schemas.ts`: accept Docker source types.
- Modify `packages/backend/src/db/schema/status-page.ts`: expand source type enum.
- Test `packages/backend/src/modules/docker/docker-health-check.service.test.ts`.
- Test `packages/backend/src/modules/status-page/status-page.service.test.ts`.
- Test `packages/backend/src/modules/notifications/notification.constants.test.ts`.

Frontend:
- Create `packages/frontend/src/pages/docker-detail/DockerHealthCheckSection.tsx`: shared settings block.
- Modify `packages/frontend/src/pages/docker-detail/SettingsTab.tsx`: render the shared block for normal containers.
- Modify `packages/frontend/src/pages/DockerDeploymentDetail.tsx`: render the same shared block in deployment settings and health bars in overview.
- Modify `packages/frontend/src/components/docker/DockerContainerRow.tsx`: render health badge/bars row for container and deployment rows.
- Modify `packages/frontend/src/pages/DockerContainers.tsx`: pass health fields through sorting/filtering without treating internals as visible rows.
- Modify `packages/frontend/src/pages/StatusPage.tsx` and `packages/frontend/src/pages/settings/StatusPageSection.tsx`: load/select Docker containers and deployments as status-page sources.
- Modify `packages/frontend/src/pages/Notifications.tsx`: resource selector labels remain stable for containers and deployments.
- Modify `packages/frontend/src/services/api.ts`: add health-check API methods and types.
- Modify `packages/frontend/src/types/index.ts`: add Docker health-check DTOs and source-type union members.
- Test existing frontend tests plus add focused tests where local test infrastructure supports the touched components.

## Data Model

Create one table for both normal containers and deployments:

```ts
export type DockerHealthTargetType = 'container' | 'deployment';
export type DockerHealthStatus = 'online' | 'offline' | 'degraded' | 'unknown' | 'disabled';
export type DockerHealthBodyMatchMode = 'includes' | 'exact' | 'starts_with' | 'ends_with';

export interface DockerHealthHistoryEntry {
  ts: string;
  status: 'online' | 'offline';
  responseMs?: number;
  slow?: boolean;
}

export const dockerHealthChecks = pgTable(
  'docker_health_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
    targetType: text('target_type').$type<DockerHealthTargetType>().notNull(),
    containerName: text('container_name'),
    deploymentId: uuid('deployment_id').references(() => dockerDeployments.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    scheme: text('scheme').notNull().default('http'),
    hostPort: integer('host_port'),
    containerPort: integer('container_port'),
    path: varchar('path', { length: 500 }).notNull().default('/'),
    statusMin: integer('status_min').notNull().default(200),
    statusMax: integer('status_max').notNull().default(299),
    timeoutSeconds: integer('timeout_seconds').notNull().default(10),
    intervalSeconds: integer('interval_seconds').notNull().default(30),
    expectedBody: varchar('expected_body', { length: 500 }),
    bodyMatchMode: text('body_match_mode').$type<DockerHealthBodyMatchMode>().notNull().default('includes'),
    slowThreshold: integer('slow_threshold').notNull().default(3),
    healthStatus: text('health_status').$type<DockerHealthStatus>().notNull().default('disabled'),
    lastHealthCheckAt: timestamp('last_health_check_at', { withTimezone: true }),
    healthHistory: jsonb('health_history').$type<DockerHealthHistoryEntry[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('docker_health_checks_container_target_unique').on(table.nodeId, table.targetType, table.containerName),
    unique('docker_health_checks_deployment_target_unique').on(table.targetType, table.deploymentId),
    index('docker_health_checks_node_idx').on(table.nodeId),
    index('docker_health_checks_deployment_idx').on(table.deploymentId),
    index('docker_health_checks_status_idx').on(table.healthStatus),
  ]
);
```

## API Shape

Container endpoints:

```http
GET /api/docker/nodes/:nodeId/containers/:containerName/health-check
PUT /api/docker/nodes/:nodeId/containers/:containerName/health-check
POST /api/docker/nodes/:nodeId/containers/:containerName/health-check/test
```

Deployment endpoints:

```http
GET /api/docker/nodes/:nodeId/deployments/:deploymentId/health-check
PUT /api/docker/nodes/:nodeId/deployments/:deploymentId/health-check
POST /api/docker/nodes/:nodeId/deployments/:deploymentId/health-check/test
```

Scopes:
- Read: `docker:containers:view`
- Update/test: `docker:containers:edit`
- Deployment read/update follows the same node-scoped Docker container scopes already used by deployment settings.

Payload:

```ts
export interface DockerHealthCheckDto {
  id: string | null;
  nodeId: string;
  targetType: 'container' | 'deployment';
  containerName: string | null;
  deploymentId: string | null;
  enabled: boolean;
  scheme: 'http' | 'https';
  hostPort: number | null;
  containerPort: number | null;
  path: string;
  statusMin: number;
  statusMax: number;
  timeoutSeconds: number;
  intervalSeconds: number;
  expectedBody: string | null;
  bodyMatchMode: 'includes' | 'exact' | 'starts_with' | 'ends_with';
  slowThreshold: number;
  healthStatus: 'online' | 'offline' | 'degraded' | 'unknown' | 'disabled';
  lastHealthCheckAt: string | null;
  healthHistory: Array<{ ts: string; status: string; responseMs?: number; slow?: boolean }>;
  routeOptions: Array<{ hostPort: number; containerPort: number; label: string; primary?: boolean }>;
}
```

## Task 1: Backend Schema And Migration

**Files:**
- Create: `packages/backend/src/db/schema/docker-health-checks.ts`
- Create: `packages/backend/src/db/migrations/0019_docker_health_checks.sql`
- Modify: `packages/backend/src/db/schema/index.ts`
- Modify: `packages/backend/src/db/schema/status-page.ts`
- Test: `pnpm --filter backend exec tsc --noEmit`

- [ ] **Step 1: Add the schema file**

Add `dockerHealthChecks` with the table shape from the Data Model section. Import `nodes` and `dockerDeployments` from sibling schema files. Keep the types exported from the file.

- [ ] **Step 2: Export the schema**

Add this line to `packages/backend/src/db/schema/index.ts`:

```ts
export * from './docker-health-checks.js';
```

- [ ] **Step 3: Expand status-page source types**

Change `packages/backend/src/db/schema/status-page.ts`:

```ts
export const statusPageSourceTypeEnum = pgEnum('status_page_source_type', [
  'node',
  'proxy_host',
  'database',
  'docker_container',
  'docker_deployment',
]);
```

- [ ] **Step 4: Add SQL migration**

Create `packages/backend/src/db/migrations/0019_docker_health_checks.sql`:

```sql
ALTER TYPE "status_page_source_type" ADD VALUE IF NOT EXISTS 'docker_container';
ALTER TYPE "status_page_source_type" ADD VALUE IF NOT EXISTS 'docker_deployment';

CREATE TABLE IF NOT EXISTS "docker_health_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "node_id" uuid NOT NULL REFERENCES "nodes"("id") ON DELETE cascade,
  "target_type" text NOT NULL,
  "container_name" text,
  "deployment_id" uuid REFERENCES "docker_deployments"("id") ON DELETE cascade,
  "enabled" boolean DEFAULT false NOT NULL,
  "scheme" text DEFAULT 'http' NOT NULL,
  "host_port" integer,
  "container_port" integer,
  "path" varchar(500) DEFAULT '/' NOT NULL,
  "status_min" integer DEFAULT 200 NOT NULL,
  "status_max" integer DEFAULT 299 NOT NULL,
  "timeout_seconds" integer DEFAULT 10 NOT NULL,
  "interval_seconds" integer DEFAULT 30 NOT NULL,
  "expected_body" varchar(500),
  "body_match_mode" text DEFAULT 'includes' NOT NULL,
  "slow_threshold" integer DEFAULT 3 NOT NULL,
  "health_status" text DEFAULT 'disabled' NOT NULL,
  "last_health_check_at" timestamp with time zone,
  "health_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "docker_health_checks_target_type_check" CHECK ("target_type" IN ('container', 'deployment')),
  CONSTRAINT "docker_health_checks_scheme_check" CHECK ("scheme" IN ('http', 'https')),
  CONSTRAINT "docker_health_checks_body_match_mode_check" CHECK ("body_match_mode" IN ('includes', 'exact', 'starts_with', 'ends_with')),
  CONSTRAINT "docker_health_checks_health_status_check" CHECK ("health_status" IN ('online', 'offline', 'degraded', 'unknown', 'disabled')),
  CONSTRAINT "docker_health_checks_target_shape_check" CHECK (
    ("target_type" = 'container' AND "container_name" IS NOT NULL AND "deployment_id" IS NULL)
    OR
    ("target_type" = 'deployment' AND "deployment_id" IS NOT NULL)
  ),
  CONSTRAINT "docker_health_checks_status_range_check" CHECK ("status_min" >= 100 AND "status_max" <= 599 AND "status_min" <= "status_max"),
  CONSTRAINT "docker_health_checks_interval_check" CHECK ("interval_seconds" >= 5 AND "interval_seconds" <= 3600),
  CONSTRAINT "docker_health_checks_timeout_check" CHECK ("timeout_seconds" >= 1 AND "timeout_seconds" <= 120)
);

CREATE UNIQUE INDEX IF NOT EXISTS "docker_health_checks_container_target_unique"
  ON "docker_health_checks" ("node_id", "target_type", "container_name")
  WHERE "target_type" = 'container';

CREATE UNIQUE INDEX IF NOT EXISTS "docker_health_checks_deployment_target_unique"
  ON "docker_health_checks" ("target_type", "deployment_id")
  WHERE "target_type" = 'deployment';

CREATE INDEX IF NOT EXISTS "docker_health_checks_node_idx" ON "docker_health_checks" ("node_id");
CREATE INDEX IF NOT EXISTS "docker_health_checks_deployment_idx" ON "docker_health_checks" ("deployment_id");
CREATE INDEX IF NOT EXISTS "docker_health_checks_status_idx" ON "docker_health_checks" ("health_status");
```

- [ ] **Step 5: Verify types**

Run:

```bash
pnpm --filter backend exec tsc --noEmit
```

Expected: typecheck succeeds or only reports pre-existing unrelated errors. If it reports schema import errors, fix this task before continuing.

## Task 2: Backend Service And Routes

**Files:**
- Create: `packages/backend/src/modules/docker/docker-health-check.schemas.ts`
- Create: `packages/backend/src/modules/docker/docker-health-check.service.ts`
- Create: `packages/backend/src/modules/docker/docker-health-check.routes.ts`
- Modify: `packages/backend/src/modules/docker/docker.routes.ts`
- Modify: `packages/backend/src/bootstrap.ts`
- Test: `packages/backend/src/modules/docker/docker-health-check.service.test.ts`

- [ ] **Step 1: Add zod schemas**

Create `docker-health-check.schemas.ts`:

```ts
import { z } from 'zod';

export const DockerHealthCheckUpsertSchema = z.object({
  enabled: z.boolean(),
  scheme: z.enum(['http', 'https']).default('http'),
  hostPort: z.number().int().min(1).max(65535).nullable().optional(),
  containerPort: z.number().int().min(1).max(65535).nullable().optional(),
  path: z.string().trim().min(1).max(500).default('/'),
  statusMin: z.number().int().min(100).max(599).default(200),
  statusMax: z.number().int().min(100).max(599).default(299),
  timeoutSeconds: z.number().int().min(1).max(120).default(10),
  intervalSeconds: z.number().int().min(5).max(3600).default(30),
  expectedBody: z.string().max(500).nullable().optional(),
  bodyMatchMode: z.enum(['includes', 'exact', 'starts_with', 'ends_with']).default('includes'),
  slowThreshold: z.number().int().min(0).max(20).default(3),
});

export type DockerHealthCheckUpsertInput = z.infer<typeof DockerHealthCheckUpsertSchema>;
```

- [ ] **Step 2: Add service validation helpers**

In `docker-health-check.service.ts`, implement helpers with these signatures:

```ts
type TargetRef =
  | { targetType: 'container'; nodeId: string; containerName: string }
  | { targetType: 'deployment'; nodeId: string; deploymentId: string };

type RouteOption = { hostPort: number; containerPort: number; label: string; primary?: boolean };

export class DockerHealthCheckService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly dispatch: NodeDispatchService,
    private readonly deployments: DockerDeploymentService,
    private readonly nodeRegistry: NodeRegistryService
  ) {}

  setEventBus(bus: EventBusService): void;
  setEvaluator(evaluator: NotificationEvaluatorService): void;
  getConfig(target: TargetRef): Promise<DockerHealthCheckDto>;
  upsertConfig(target: TargetRef, input: DockerHealthCheckUpsertInput): Promise<DockerHealthCheckDto>;
  testConfig(target: TargetRef, input?: DockerHealthCheckUpsertInput): Promise<{ status: 'online' | 'offline'; responseMs?: number; error?: string }>;
  runDueChecks(now?: Date): Promise<void>;
}
```

Validation rules:
- `statusMin <= statusMax`.
- `enabled=true` requires a `hostPort`.
- container targets must resolve to a visible non-internal container.
- deployment targets must resolve to an existing deployment on the same node.
- if a selected `hostPort` is not in the current route options, reject with `400 INVALID_HEALTH_ROUTE`.

- [ ] **Step 3: Resolve route options**

Implement container route options from Docker list/inspect port bindings:

```ts
function routeOptionsFromContainer(container: any): RouteOption[] {
  const ports = Array.isArray(container.Ports ?? container.ports) ? (container.Ports ?? container.ports) : [];
  return ports
    .filter((port: any) => Number(port.PublicPort ?? port.publicPort) > 0)
    .map((port: any) => ({
      hostPort: Number(port.PublicPort ?? port.publicPort),
      containerPort: Number(port.PrivatePort ?? port.privatePort),
      label: `${port.PublicPort ?? port.publicPort} -> ${port.PrivatePort ?? port.privatePort}`,
    }));
}
```

Implement deployment route options from `dockerDeploymentRoutes`:

```ts
function routeOptionsFromDeployment(routes: Array<{ hostPort: number; containerPort: number; isPrimary: boolean }>): RouteOption[] {
  return routes.map((route) => ({
    hostPort: route.hostPort,
    containerPort: route.containerPort,
    label: `${route.hostPort} -> ${route.containerPort}`,
    primary: route.isPrimary,
  }));
}
```

- [ ] **Step 4: Implement probe logic**

Use node address from the node record or registry payload already used by Docker services. Probe:

```ts
const url = `${config.scheme}://${nodeHost}:${config.hostPort}${config.path}`;
```

Rules:
- 2xx by default through `statusMin/statusMax`.
- body matching supports `includes`, `exact`, `starts_with`, `ends_with`.
- `timeoutSeconds` aborts the fetch.
- `slowThreshold=0` disables degraded detection.
- degraded means the check passed but response time exceeds recent baseline by `slowThreshold`.
- keep 90 days of history, matching proxy health behavior.

- [ ] **Step 5: Publish transitions**

On status change, publish:

```ts
this.eventBus?.publish('docker.health.changed', {
  action: next === 'online' ? 'health.online' : next === 'offline' ? 'health.offline' : 'health.degraded',
  nodeId,
  id: dto.id,
  targetType: dto.targetType,
  containerName: dto.containerName,
  deploymentId: dto.deploymentId,
  name: dto.targetType === 'deployment' ? deployment.name : dto.containerName,
  healthStatus: next,
});
```

Also call:

```ts
await this.evaluator?.observeStatefulEvent(
  'container',
  action,
  { type: dto.targetType === 'deployment' ? 'docker_deployment' : 'docker_container', id: resourceId, name },
  { health_status: next, nodeId }
);
```

- [ ] **Step 6: Add routes**

Create route handlers and register them from `docker.routes.ts`:

```ts
registerDockerHealthCheckRoutes(dockerRoutes);
```

Handlers must use `requireScopeForResource('docker:containers:view', 'nodeId')` for GET and `requireScopeForResource('docker:containers:edit', 'nodeId')` for PUT/test.

- [ ] **Step 7: Wire scheduler**

In `bootstrap.ts`, instantiate `DockerHealthCheckService`, inject event bus/evaluator, register in the container, and schedule:

```ts
scheduler.registerInterval('docker-health-check', 15_000, () => dockerHealthCheckService.runDueChecks());
```

- [ ] **Step 8: Write backend tests**

Create tests covering:
- container config rejects `enabled=true` without host port.
- container config rejects internal managed deployment containers.
- deployment default config selects primary route and starts enabled.
- failed probe stores `offline` history and emits `docker.health.changed`.
- passing probe stores `online` and resolves prior offline state.
- slow passing probe stores `degraded` when enough baseline samples exist.

Run:

```bash
pnpm --filter backend test -- src/modules/docker/docker-health-check.service.test.ts
```

Expected: all tests pass.

## Task 3: Integrate Docker Lists, Deployments, Notifications, And Status Page

**Files:**
- Modify: `packages/backend/src/modules/docker/docker.service.ts`
- Modify: `packages/backend/src/modules/docker/docker-deployment.service.ts`
- Modify: `packages/backend/src/modules/notifications/notification.constants.ts`
- Modify: `packages/backend/src/modules/status-page/status-page.service.ts`
- Modify: `packages/backend/src/modules/status-page/status-page.schemas.ts`
- Test: `packages/backend/src/modules/status-page/status-page.service.test.ts`
- Test: `packages/backend/src/modules/notifications/notification.constants.test.ts`

- [ ] **Step 1: Add health fields to Docker list rows**

Extend normal and synthetic deployment list rows with:

```ts
healthStatus: health?.healthStatus ?? 'disabled',
healthHistory: health?.healthHistory ?? [],
lastHealthCheckAt: health?.lastHealthCheckAt ?? null,
healthCheckEnabled: health?.enabled ?? false,
```

Use container name as the join key for normal containers and deployment id for deployment rows.

- [ ] **Step 2: Create default deployment health row**

When creating a deployment, after routes are inserted, create or update a health row:

```ts
const primary = routes.find((route) => route.isPrimary) ?? routes[0];
await dockerHealthCheckService.ensureDeploymentDefault({
  nodeId,
  deploymentId,
  hostPort: primary.hostPort,
  containerPort: primary.containerPort,
  path: deployment.healthConfig.path,
  statusMin: deployment.healthConfig.statusMin,
  statusMax: deployment.healthConfig.statusMax,
  timeoutSeconds: deployment.healthConfig.timeoutSeconds,
  intervalSeconds: deployment.healthConfig.intervalSeconds,
  enabled: true,
});
```

If constructor cycles are awkward, place `ensureDeploymentDefault` in the health service and call it from bootstrap after service construction through setter injection.

- [ ] **Step 3: Keep deployment readiness and health config aligned**

When deployment settings update health/readiness route fields, update both:
- `docker_deployments.health_config`
- matching `docker_health_checks` row

If the health-check row has a user-selected non-primary route, preserve it unless the route was deleted.

- [ ] **Step 4: Add notification events**

In the `container` category, add:

```ts
{ id: 'health.offline', label: 'Container Health Offline', defaultSeverity: 'critical', supportsThreshold: true },
{ id: 'health.degraded', label: 'Container Health Degraded', defaultSeverity: 'warning', supportsThreshold: true },
{ id: 'health.online', label: 'Container Health Online', defaultSeverity: 'info', supportsThreshold: true },
```

Add `{{health_status}}` and `{{nodeId}}` variables. Add `EVENT_BUS_MAPPINGS['docker.health.changed']` entries for those three actions.

- [ ] **Step 5: Add status-page sources**

In `status-page.schemas.ts`, change:

```ts
sourceType: z.enum(['node', 'proxy_host', 'database', 'docker_container', 'docker_deployment']),
```

In `resolveSources`, query `dockerHealthChecks` for `docker_container` and `docker_deployment`.

Mapping:
- `online` -> `operational`
- `degraded` -> `degraded`
- `offline` -> `outage`
- `unknown | disabled` -> `unknown`

Use `containerName` as Docker container label and deployment `name` for deployments.

- [ ] **Step 6: Test integration**

Add status-page tests:
- Docker container source resolves to operational with health history.
- Docker deployment source resolves to outage when health row is offline.
- disabled/unknown Docker source does not create automatic outage.

Add notification tests:
- `docker.health.changed` maps `health.offline`, `health.degraded`, `health.online`.
- resource type is `docker_deployment` for deployment events and `docker_container` for container events.

Run:

```bash
pnpm --filter backend test -- src/modules/status-page src/modules/notifications src/modules/docker
```

Expected: all touched module tests pass.

## Task 4: Frontend Shared Health UI

**Files:**
- Create: `packages/frontend/src/pages/docker-detail/DockerHealthCheckSection.tsx`
- Modify: `packages/frontend/src/services/api.ts`
- Modify: `packages/frontend/src/types/index.ts`
- Modify: `packages/frontend/src/pages/docker-detail/SettingsTab.tsx`
- Modify: `packages/frontend/src/pages/DockerDeploymentDetail.tsx`
- Modify: `packages/frontend/src/components/docker/DockerContainerRow.tsx`

- [ ] **Step 1: Add frontend types**

Add:

```ts
export type DockerHealthStatus = 'online' | 'offline' | 'degraded' | 'unknown' | 'disabled';

export interface DockerHealthCheck {
  id: string | null;
  nodeId: string;
  targetType: 'container' | 'deployment';
  containerName: string | null;
  deploymentId: string | null;
  enabled: boolean;
  scheme: 'http' | 'https';
  hostPort: number | null;
  containerPort: number | null;
  path: string;
  statusMin: number;
  statusMax: number;
  timeoutSeconds: number;
  intervalSeconds: number;
  expectedBody: string | null;
  bodyMatchMode: 'includes' | 'exact' | 'starts_with' | 'ends_with';
  slowThreshold: number;
  healthStatus: DockerHealthStatus;
  lastHealthCheckAt: string | null;
  healthHistory: Array<{ ts: string; status: string; responseMs?: number; slow?: boolean }>;
  routeOptions: Array<{ hostPort: number; containerPort: number; label: string; primary?: boolean }>;
}
```

Extend `DockerContainer` and `DockerDeployment` with health fields.

- [ ] **Step 2: Add API methods**

In `api.ts`, add:

```ts
async getContainerHealthCheck(nodeId: string, containerName: string): Promise<DockerHealthCheck>;
async updateContainerHealthCheck(nodeId: string, containerName: string, data: Partial<DockerHealthCheck>): Promise<DockerHealthCheck>;
async testContainerHealthCheck(nodeId: string, containerName: string, data?: Partial<DockerHealthCheck>): Promise<{ status: string; responseMs?: number; error?: string }>;
async getDeploymentHealthCheck(nodeId: string, deploymentId: string): Promise<DockerHealthCheck>;
async updateDeploymentHealthCheck(nodeId: string, deploymentId: string, data: Partial<DockerHealthCheck>): Promise<DockerHealthCheck>;
async testDeploymentHealthCheck(nodeId: string, deploymentId: string, data?: Partial<DockerHealthCheck>): Promise<{ status: string; responseMs?: number; error?: string }>;
```

- [ ] **Step 3: Build shared settings block**

`DockerHealthCheckSection` props:

```ts
interface DockerHealthCheckSectionProps {
  target: { type: 'container'; nodeId: string; containerName: string } | { type: 'deployment'; nodeId: string; deploymentId: string };
  title?: string;
  description?: string;
}
```

UI requirements:
- same bordered block style as webhook/settings sections.
- `Switch` for enabled.
- route `Select` from `routeOptions`.
- path input.
- status min/max inputs.
- interval/timeout inputs.
- expected body and body match mode.
- `Save` and `Test` buttons in header.
- `HealthBars` at bottom using returned history/status.
- when route options are empty, show disabled state and keep save disabled if enabled is true.

- [ ] **Step 4: Render in container settings**

In normal container `SettingsTab`, render below webhook or near similar operational configuration:

```tsx
<DockerHealthCheckSection
  target={{ type: 'container', nodeId, containerName }}
  title="Health Check"
  description="Saved with container monitoring configuration"
/>
```

- [ ] **Step 5: Render in deployment settings**

In `DockerDeploymentDetail`, replace custom health/readiness-only controls with the same component:

```tsx
<DockerHealthCheckSection
  target={{ type: 'deployment', nodeId, deploymentId: deployment.id }}
  title="Health Check"
  description="Used for active-slot health and switch readiness"
/>
```

Keep deployment-specific drain and route editing in existing deployment settings blocks.

- [ ] **Step 6: Add health bars to Docker rows**

In `DockerContainerRow`, under the main row content, render:

```tsx
<HealthBars
  history={container.healthHistory}
  currentStatus={container.healthStatus}
  barHeight="h-4"
  showLabels={false}
/>
```

Keep the row height stable and follow node/proxy/database spacing.

- [ ] **Step 7: Verify frontend**

Run:

```bash
pnpm --filter frontend exec tsc --noEmit
pnpm --filter frontend lint
```

Expected: both pass except any explicitly documented pre-existing large-chunk lint warning.

## Task 5: Status Page And Notifications UI

**Files:**
- Modify: `packages/frontend/src/pages/StatusPage.tsx`
- Modify: `packages/frontend/src/pages/settings/StatusPageSection.tsx`
- Modify: `packages/frontend/src/pages/Notifications.tsx`
- Modify: `packages/frontend/src/types/index.ts`
- Modify: `packages/frontend/src/services/api.ts`

- [ ] **Step 1: Extend source type unions**

Change:

```ts
export type StatusPageSourceType = 'node' | 'proxy_host' | 'database' | 'docker_container' | 'docker_deployment';
```

- [ ] **Step 2: Load Docker source options**

In status-page service dialog loading, fetch Docker nodes and `api.listDockerContainers(node.id)`.

Options:
- normal containers: source type `docker_container`, source id = health check id from container row.
- deployments: source type `docker_deployment`, source id = deployment id.

If a normal container lacks a health-check id, omit it from status-page options and require enabling/saving health check first.

- [ ] **Step 3: Display Docker source labels**

Labels:
- container: `container-name (node display name)`
- deployment: `deployment-name (node display name)`

Status badges use existing status page `statusBadge` helper.

- [ ] **Step 4: Update notification resource selector**

In the existing container category resource loader, include deployment rows and label them as:

```ts
`${container.name} (${node.displayName || node.hostname})`
```

The id remains the container/deployment resource id used by notification events:
- container health events: health-check id or container name, whichever backend uses consistently.
- deployment health events: deployment id.

- [ ] **Step 5: Verify UI typecheck**

Run:

```bash
pnpm --filter frontend exec tsc --noEmit
```

Expected: typecheck passes.

## Task 6: Full Verification

**Files:**
- No new files unless fixing test fixtures.

- [ ] **Step 1: Backend Docker tests**

Run:

```bash
pnpm --filter backend test -- src/modules/docker
```

Expected: pass.

- [ ] **Step 2: Backend status page and notifications tests**

Run:

```bash
pnpm --filter backend test -- src/modules/status-page src/modules/notifications
```

Expected: pass.

- [ ] **Step 3: Backend typecheck**

Run:

```bash
pnpm --filter backend exec tsc --noEmit
```

Expected: pass.

- [ ] **Step 4: Frontend typecheck**

Run:

```bash
pnpm --filter frontend exec tsc --noEmit
```

Expected: pass.

- [ ] **Step 5: Frontend lint**

Run:

```bash
pnpm --filter frontend lint
```

Expected: pass except the known large-chunk warning already accepted by the user.

- [ ] **Step 6: Full build**

Run:

```bash
pnpm run build
```

Expected: build succeeds.

- [ ] **Step 7: Manual local flow**

With local gateway/frontend and a Docker node:
- Enable health check for a normal HTTP container exposed on a host port.
- Confirm row health bars show online.
- Break the target path and confirm offline history appears after the next job run.
- Add that container to status page and confirm public preview maps it to outage.
- Create a deployment and confirm default health check is enabled on the primary route.
- Switch active slot and confirm health remains attached to the deployment, not the old slot container.
- Create notification rules for container `health.offline` and `health.online`; confirm stateful firing/resolution.

## Plan Self-Review

- Requirements coverage: health bars, normal container health config, deployment health defaults, shared UI, notifications, and status page are covered.
- Completion scan: every task specifies concrete files, behavior, and verification.
- Type consistency: `docker_health_checks` stores stable health rows; frontend `DockerHealthCheck` mirrors backend DTO names.
- Wiring completeness: schema, migration, service, routes, scheduler, Docker rows, deployment defaults, status page, notifications, and frontend API are all wired.
- Dependency ordering: backend persistence comes first, then service/routes, then integrations, then frontend.
- Scope reduction scan: normal containers and deployments are both included; deployment health remains active-slot based.
- Verification quality: tests and manual checks cover core health transitions and integrations.
