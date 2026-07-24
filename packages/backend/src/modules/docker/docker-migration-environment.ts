import { AppError } from '@/middleware/error-handler.js';
import type { DockerEnvironmentService } from './docker-environment.service.js';
import type { MigrationRow } from './docker-migration-runtime.js';
import type { DockerSecretService } from './docker-secret.service.js';

export interface MigrationEnvironmentOverlays {
  storedEnvironment: Record<string, string>;
  secrets: Record<string, string>;
}

export async function migrationEnvironmentOverlays(
  environment: DockerEnvironmentService,
  secretsService: DockerSecretService,
  row: MigrationRow
): Promise<MigrationEnvironmentOverlays> {
  const key = row.resourceType === 'deployment' ? `deployment:${row.deploymentId}` : row.resourceName;
  const [storedEnvironment, secrets] = await Promise.all([
    environment.getDecryptedMap(row.sourceNodeId, key),
    secretsService.getDecryptedMap(row.sourceNodeId, key),
  ]);
  for (const secretKey of Object.keys(secrets)) {
    if (Object.hasOwn(storedEnvironment, secretKey)) duplicate(secretKey);
  }
  return { storedEnvironment, secrets };
}

export function mergeMigrationEnvironment(
  base: Record<string, string> | undefined,
  overlays: MigrationEnvironmentOverlays
): Record<string, string> {
  for (const secretKey of Object.keys(overlays.secrets)) {
    if (Object.hasOwn(base ?? {}, secretKey)) duplicate(secretKey);
  }
  return { ...(base ?? {}), ...overlays.storedEnvironment, ...overlays.secrets };
}

function duplicate(key: string): never {
  throw new AppError(409, 'MIGRATION_DUPLICATE_ENV_KEY', `Environment and secret both define ${key}`);
}
