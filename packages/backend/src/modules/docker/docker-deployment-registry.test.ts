import { describe, expect, it } from 'vitest';
import type { DockerDeploymentDesiredConfig } from '@/db/schema/index.js';
import { AppError } from '@/middleware/error-handler.js';
import {
  desiredConfigForRegistryAttempt,
  hasRegistryHost,
  isRegistryRetryableError,
} from './docker-deployment-registry.js';

describe('Docker deployment registry helpers', () => {
  it('detects whether an image already includes a registry host', () => {
    expect(hasRegistryHost('nginx:latest')).toBe(true);
    expect(hasRegistryHost('team/app:latest')).toBe(false);
    expect(hasRegistryHost('localhost/team/app:latest')).toBe(true);
    expect(hasRegistryHost('localhost:5000/team/app:latest')).toBe(true);
    expect(hasRegistryHost('registry.example.com/team/app:latest')).toBe(true);
  });

  it('prefixes registry auth URLs only for unqualified image refs', () => {
    const desiredConfig = {
      image: 'team/app:latest',
      env: { NODE_ENV: 'production' },
    } satisfies DockerDeploymentDesiredConfig;
    const registryAuth = {
      registryId: 'registry-1',
      url: 'registry.example.com',
      authJson: '{}',
    };

    expect(desiredConfigForRegistryAttempt(desiredConfig, registryAuth)).toEqual({
      image: 'registry.example.com/team/app:latest',
      env: { NODE_ENV: 'production' },
    });
    expect(desiredConfigForRegistryAttempt(desiredConfig, null)).toBe(desiredConfig);
    expect(
      desiredConfigForRegistryAttempt({ ...desiredConfig, image: 'registry.example.com/team/app:latest' }, registryAuth)
    ).toEqual({ ...desiredConfig, image: 'registry.example.com/team/app:latest' });
  });

  it('classifies registry auth and missing repository failures as retryable', () => {
    expect(isRegistryRetryableError(new Error('pull access denied for team/app'))).toBe(true);
    expect(isRegistryRetryableError(new AppError(502, 'DISPATCH_ERROR', 'no basic auth credentials'))).toBe(true);
    expect(isRegistryRetryableError('repository does not exist or may require authorization')).toBe(true);
    expect(isRegistryRetryableError(new Error('container exited with status 1'))).toBe(false);
  });
});
