import type { DockerDeploymentSlot } from '@/db/schema/index.js';

export const DOCKER_DEPLOYMENT_MANAGED_LABEL = 'wiolett.gateway.deployment.managed';
export const DOCKER_DEPLOYMENT_ID_LABEL = 'wiolett.gateway.deployment.id';
export const DOCKER_DEPLOYMENT_ROLE_LABEL = 'wiolett.gateway.deployment.role';
export const DOCKER_DEPLOYMENT_SLOT_LABEL = 'wiolett.gateway.deployment.slot';

export function dockerDeploymentLabels(deploymentId: string, role: 'router' | 'app', slot?: DockerDeploymentSlot) {
  return {
    [DOCKER_DEPLOYMENT_MANAGED_LABEL]: 'true',
    [DOCKER_DEPLOYMENT_ID_LABEL]: deploymentId,
    [DOCKER_DEPLOYMENT_ROLE_LABEL]: role,
    ...(slot ? { [DOCKER_DEPLOYMENT_SLOT_LABEL]: slot } : {}),
  };
}
