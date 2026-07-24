import { hasScope } from '@/lib/permissions.js';
import { AppError } from '@/middleware/error-handler.js';

export interface DockerMigrationPermissionPlan {
  sourceNodeId: string;
  targetNodeId: string;
  keepSource: boolean;
  hasVolumes: boolean;
  createsNetworks: boolean;
  hasProxyHosts: boolean;
}

export function requiredDockerMigrationScopes(plan: DockerMigrationPermissionPlan): string[] {
  const required = new Set([
    `docker:containers:migrate:${plan.sourceNodeId}`,
    `docker:containers:migrate:${plan.targetNodeId}`,
    `docker:containers:view:${plan.sourceNodeId}`,
    `docker:containers:manage:${plan.sourceNodeId}`,
    `docker:containers:environment:${plan.sourceNodeId}`,
    `docker:containers:secrets:${plan.sourceNodeId}`,
    `docker:containers:create:${plan.targetNodeId}`,
    `docker:containers:manage:${plan.targetNodeId}`,
    `docker:containers:environment:${plan.targetNodeId}`,
    `docker:containers:secrets:${plan.targetNodeId}`,
  ]);

  if (!plan.keepSource) required.add(`docker:containers:delete:${plan.sourceNodeId}`);
  if (plan.hasVolumes) {
    required.add(`docker:volumes:view:${plan.sourceNodeId}`);
    required.add(`docker:volumes:create:${plan.targetNodeId}`);
    if (!plan.keepSource) required.add(`docker:volumes:delete:${plan.sourceNodeId}`);
  }
  if (plan.createsNetworks) {
    required.add(`docker:networks:view:${plan.sourceNodeId}`);
    required.add(`docker:networks:create:${plan.targetNodeId}`);
  }
  if (plan.hasProxyHosts) required.add('proxy:edit');
  return [...required];
}

export function missingDockerMigrationScopes(scopes: string[], plan: DockerMigrationPermissionPlan): string[] {
  return requiredDockerMigrationScopes(plan).filter((scope) => !hasScope(scopes, scope));
}

export function assertDockerMigrationPermissions(scopes: string[], plan: DockerMigrationPermissionPlan): void {
  const missingScopes = missingDockerMigrationScopes(scopes, plan);
  if (missingScopes.length > 0) {
    throw new AppError(403, 'MIGRATION_PERMISSION_DENIED', 'Missing permissions required for this migration', {
      missingScopes,
    });
  }
}

export function assertDockerMigrationReadAccess(scopes: string[], sourceNodeId: string, targetNodeId: string): void {
  const required = ['docker:tasks', `docker:containers:view:${sourceNodeId}`, `docker:containers:view:${targetNodeId}`];
  if (required.some((scope) => !hasScope(scopes, scope))) {
    throw new AppError(403, 'FORBIDDEN', 'Docker migration history requires task and node visibility');
  }
}

export function assertDockerMigrationManageAccess(scopes: string[], sourceNodeId: string, targetNodeId: string): void {
  assertDockerMigrationReadAccess(scopes, sourceNodeId, targetNodeId);
  const required = [
    'docker:tasks:manage',
    `docker:containers:migrate:${sourceNodeId}`,
    `docker:containers:migrate:${targetNodeId}`,
  ];
  if (required.some((scope) => !hasScope(scopes, scope))) {
    throw new AppError(403, 'FORBIDDEN', 'Managing a migration requires task management and migration permissions');
  }
}

export function assertDockerMigrationCleanupAccess(
  scopes: string[],
  sourceNodeId: string,
  hasVolumes: boolean,
  hasProxyHosts: boolean
): void {
  const required = [`docker:containers:delete:${sourceNodeId}`];
  if (hasVolumes) required.push(`docker:volumes:delete:${sourceNodeId}`);
  if (hasProxyHosts) required.push('proxy:edit');
  if (required.some((scope) => !hasScope(scopes, scope))) {
    throw new AppError(403, 'MIGRATION_PERMISSION_DENIED', 'Missing permissions required for migration cleanup');
  }
}
