import { AppError } from '@/middleware/error-handler.js';
import type { DockerMigrationDispatchAdapter } from './docker-migration-dispatch.js';
import type { MigrationRow, StoredMigrationPlan } from './docker-migration-runtime.js';

export function migrationSourceMayNeedRestore(row: MigrationRow): boolean {
  return [
    'stopping_source',
    'preparing_volumes',
    'transferring',
    'creating_target',
    'verifying_target',
    'starting_target',
    'cutover',
    'proxy_cutover',
    'cleanup_source',
    'finalizing',
    'done',
  ].includes(row.phase);
}

function restartPolicy(manifest: Record<string, any> | undefined, resourceName: string): string {
  const policy = manifest?.hostConfig?.RestartPolicy?.Name;
  if (typeof policy !== 'string') {
    throw new AppError(
      500,
      'MIGRATION_PLAN_INVALID',
      `Source restart policy is missing from the migration plan for ${resourceName}`
    );
  }
  return policy;
}

export async function restoreMigrationSource(
  dispatch: DockerMigrationDispatchAdapter,
  row: MigrationRow,
  plan: StoredMigrationPlan
): Promise<void> {
  if (row.resourceType === 'container') {
    await dispatch.containerAction(row.sourceNodeId, 'live_update', row.resourceName, {
      configJson: JSON.stringify({ restartPolicy: restartPolicy(plan.manifest, row.resourceName) }),
    });
    if (row.sourceState === 'running') {
      await dispatch.containerAction(row.sourceNodeId, 'start', row.resourceName);
    }
    return;
  }

  if (!plan.deployment) throw new AppError(500, 'MIGRATION_PLAN_INVALID', 'Deployment snapshot is missing');
  const failures: unknown[] = [];
  for (const [role, name] of Object.entries({ router: plan.deployment.routerName, ...plan.deployment.slots })) {
    if (typeof name !== 'string' || !name) continue;
    try {
      await dispatch.containerAction(row.sourceNodeId, 'live_update', name, {
        configJson: JSON.stringify({ restartPolicy: restartPolicy(plan.deploymentManifests?.[role], name) }),
      });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Source deployment restoration was incomplete');
  if (row.sourceState === 'ready') {
    await dispatch.deploymentAction(row.sourceNodeId, 'start', row.deploymentId!, {
      configJson: JSON.stringify({ deployment: plan.deployment.deployment, force: true }),
      force: true,
    });
  }
}
