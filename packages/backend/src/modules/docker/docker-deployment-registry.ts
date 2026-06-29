import type { DockerDeploymentDesiredConfig } from '@/db/schema/index.js';
import type { DockerRegistryAuthCandidate } from './docker-registry.service.js';

export function isRegistryRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /pull access denied|repository does not exist|insufficient_scope|authorization|authentication|no basic auth|denied/i.test(
    message
  );
}

export function hasRegistryHost(imageRef: string) {
  const firstSegment = imageRef.split('/')[0] ?? '';
  return firstSegment === 'localhost' || firstSegment.includes('.') || firstSegment.includes(':');
}

export function desiredConfigForRegistryAttempt(
  desiredConfig: DockerDeploymentDesiredConfig,
  registryAuth: DockerRegistryAuthCandidate | null
): DockerDeploymentDesiredConfig {
  if (!registryAuth || hasRegistryHost(desiredConfig.image)) return desiredConfig;
  return { ...desiredConfig, image: `${registryAuth.url}/${desiredConfig.image}` };
}
