import type { dockerMigrations } from '@/db/schema/index.js';

type MigrationRow = typeof dockerMigrations.$inferSelect;

export function sanitizeDockerMigration(row: MigrationRow) {
  const preflight = row.preflight as { targetNodeSlug?: unknown };
  const plan = row.plan as { target?: { containerId?: unknown }; targetNodeSlug?: unknown };
  const targetNodeSlug =
    typeof plan.targetNodeSlug === 'string'
      ? plan.targetNodeSlug
      : typeof preflight.targetNodeSlug === 'string'
        ? preflight.targetNodeSlug
        : null;
  const targetResourceId =
    row.resourceType === 'deployment'
      ? row.deploymentId
      : typeof plan.target?.containerId === 'string'
        ? plan.target.containerId
        : null;

  return {
    id: row.id,
    resourceType: row.resourceType,
    resourceName: row.resourceName,
    deploymentId: row.deploymentId,
    sourceNodeId: row.sourceNodeId,
    targetNodeId: row.targetNodeId,
    targetNodeSlug,
    targetResourceId,
    keepSource: row.keepSource,
    sourceState: row.sourceState,
    status: row.status,
    phase: row.phase,
    progress: row.progress,
    verification: row.verification,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    cancellationRequestedAt: row.cancellationRequestedAt,
    cutoverAt: row.cutoverAt,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}
