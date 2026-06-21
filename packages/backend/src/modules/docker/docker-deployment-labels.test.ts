import { describe, expect, it } from 'vitest';
import {
  DOCKER_DEPLOYMENT_ID_LABEL,
  DOCKER_DEPLOYMENT_MANAGED_LABEL,
  DOCKER_DEPLOYMENT_ROLE_LABEL,
  DOCKER_DEPLOYMENT_SLOT_LABEL,
  dockerDeploymentLabels,
} from './docker-deployment-labels.js';

describe('Docker deployment labels', () => {
  it('keeps deployment label keys stable for managed container detection', () => {
    expect(DOCKER_DEPLOYMENT_MANAGED_LABEL).toBe('wiolett.gateway.deployment.managed');
    expect(DOCKER_DEPLOYMENT_ID_LABEL).toBe('wiolett.gateway.deployment.id');
    expect(DOCKER_DEPLOYMENT_ROLE_LABEL).toBe('wiolett.gateway.deployment.role');
    expect(DOCKER_DEPLOYMENT_SLOT_LABEL).toBe('wiolett.gateway.deployment.slot');
  });

  it('builds app slot labels and omits slot labels for router containers', () => {
    expect(dockerDeploymentLabels('deployment-1', 'app', 'blue')).toEqual({
      [DOCKER_DEPLOYMENT_MANAGED_LABEL]: 'true',
      [DOCKER_DEPLOYMENT_ID_LABEL]: 'deployment-1',
      [DOCKER_DEPLOYMENT_ROLE_LABEL]: 'app',
      [DOCKER_DEPLOYMENT_SLOT_LABEL]: 'blue',
    });

    expect(dockerDeploymentLabels('deployment-1', 'router')).toEqual({
      [DOCKER_DEPLOYMENT_MANAGED_LABEL]: 'true',
      [DOCKER_DEPLOYMENT_ID_LABEL]: 'deployment-1',
      [DOCKER_DEPLOYMENT_ROLE_LABEL]: 'router',
    });
  });
});
