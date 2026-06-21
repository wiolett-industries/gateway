import type { DockerDeploymentSummary } from './docker-deployment.service.js';

export function toSyntheticRow(deployment: DockerDeploymentSummary) {
  const active = deployment.slots.find((slot) => slot.slot === deployment.activeSlot);
  const primary = deployment.routes.find((route) => route.isPrimary) ?? deployment.routes[0];
  return {
    id: deployment.id,
    name: deployment.name,
    image: active?.image ?? deployment.desiredConfig.image,
    state: deployment.status === 'ready' ? active?.status || 'running' : deployment.status,
    status: `active ${deployment.activeSlot}`,
    created: Math.floor(new Date(deployment.createdAt).getTime() / 1000),
    ports: deployment.routes.map((route) => ({
      privatePort: route.containerPort,
      publicPort: route.hostPort,
      type: 'tcp',
    })),
    labels: {},
    kind: 'deployment',
    deploymentId: deployment.id,
    activeSlot: deployment.activeSlot,
    primaryRoute: primary ? { hostPort: primary.hostPort, containerPort: primary.containerPort } : null,
    activeSlotContainerId: active?.containerId ?? null,
    healthCheckId: deployment.healthCheck?.id ?? null,
    healthCheckEnabled: deployment.healthCheck?.enabled ?? false,
    healthStatus: deployment.healthCheck?.healthStatus ?? 'unknown',
    lastHealthCheckAt: deployment.healthCheck?.lastHealthCheckAt ?? null,
    folderId: null,
    folderIsSystem: false,
    folderSortOrder: 0,
    ...(deployment._transition ? { _transition: deployment._transition } : {}),
  };
}
