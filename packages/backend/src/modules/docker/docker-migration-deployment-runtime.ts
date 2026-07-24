import type { DockerMigrationDispatchAdapter } from './docker-migration-dispatch.js';
import { migrationEnvMap } from './docker-migration-runtime.js';

export async function sourceDeploymentSlotEnvironments(
  dispatch: DockerMigrationDispatchAdapter,
  nodeId: string,
  payload: Record<string, any>
): Promise<Record<string, Record<string, string>>> {
  const result: Record<string, Record<string, string>> = {};
  for (const [slot, name] of Object.entries(payload.slots ?? {})) {
    if (typeof name !== 'string' || !name) continue;
    const inspect = await dispatch.containerAction(nodeId, 'inspect', name);
    result[slot] = migrationEnvMap((inspect.Config as Record<string, any> | undefined)?.Env);
  }
  return result;
}
