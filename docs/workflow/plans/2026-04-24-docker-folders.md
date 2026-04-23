# Docker Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` by default, or `subagent-driven-development` when the `multi-agent-workflows` plugin is installed and you want same-session multi-agent execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace compose-label UI grouping on the Docker containers page with first-class persisted Docker folders, including one protected system folder per compose deployment.

**Architecture:** Add Docker-specific folder and assignment tables plus a backend service that manages folder CRUD, protected compose deployment folders, and container-to-folder placement keyed by `nodeId + containerName`. Keep daemon-backed container listing as-is, sync compose deployment folders during container list fetches, and build the folder tree UI in the frontend using the existing proxy folder interaction model.

**Tech Stack:** Hono, Drizzle ORM, Postgres, Zustand, React, dnd-kit

---

### Task 1: Backend Docker Folder Persistence

**Files:**
- Create: `packages/backend/src/db/schema/docker-container-folders.ts`
- Create: `packages/backend/src/db/schema/docker-container-folder-assignments.ts`
- Modify: `packages/backend/src/db/schema/index.ts`
- Create: `packages/backend/src/db/migrations/0011_docker_container_folders.sql`
- Modify: `packages/backend/src/db/migrations/meta/_journal.json`

- [ ] Add Docker folder and assignment tables with protected system-folder metadata and assignment uniqueness on `nodeId + containerName`.
- [ ] Export the new schema objects through the shared schema index.
- [ ] Add the SQL migration and journal entry.

### Task 2: Backend Docker Folder Service and Routes

**Files:**
- Create: `packages/backend/src/modules/docker/docker-folder.schemas.ts`
- Create: `packages/backend/src/modules/docker/docker-folder.service.ts`
- Create: `packages/backend/src/modules/docker/docker-folder.routes.ts`
- Modify: `packages/backend/src/modules/docker/docker.routes.ts`
- Modify: `packages/backend/src/modules/docker/docker.service.ts`
- Modify: `packages/backend/src/bootstrap.ts`

- [ ] Implement folder CRUD, tree loading, container move/reorder operations, protected-folder guards, and compose deployment auto-sync.
- [ ] Sync compose deployment folders during `listContainers()` and annotate returned containers with `folderId`.
- [ ] Register Docker folder routes and service wiring in bootstrap.

### Task 3: Frontend Docker Folder Data Layer

**Files:**
- Modify: `packages/frontend/src/types/index.ts`
- Modify: `packages/frontend/src/services/api.ts`
- Create: `packages/frontend/src/stores/docker-folders.ts`

- [ ] Add Docker folder and move payload types.
- [ ] Add Docker folder API methods.
- [ ] Add a Zustand store for Docker folder tree loading, CRUD, move/reorder actions, and expansion state.

### Task 4: Frontend Docker Folder UI

**Files:**
- Create: `packages/frontend/src/components/docker/DockerContainerRow.tsx`
- Create: `packages/frontend/src/components/docker/DockerFolderGroup.tsx`
- Create: `packages/frontend/src/components/docker/DockerMoveToFolderDialog.tsx`
- Create: `packages/frontend/src/components/docker/DockerDragOverlay.tsx`
- Modify: `packages/frontend/src/pages/DockerContainers.tsx`

- [ ] Replace compose-based `DataTable` grouping with a proxy-style folder tree view backed by persisted Docker folders.
- [ ] Keep drag-and-drop for containers, but block moves into or out of protected compose deployment folders.
- [ ] Add folder create/rename/delete controls and move dialog behavior matching proxy hosts, except protected folders stay locked.

### Task 5: Verification

**Files:**
- Create: `packages/backend/src/modules/docker/docker-folder.service.test.ts` or `packages/backend/src/services/...` equivalent if needed

- [ ] Add focused backend tests for validator-free protected folder rules and compose sync behavior.
- [ ] Run backend typecheck.
- [ ] Run frontend typecheck.
- [ ] Run any focused backend tests added for Docker folders.
