import { describe, expect, it } from 'vitest';
import type { dockerMigrations } from '@/db/schema/index.js';
import { DockerMigrationCreateInputSchema } from './docker-migration.schemas.js';
import { DOCKER_MIGRATION_LEASE_EXPIRY_MS, DOCKER_MIGRATION_LEASE_HEARTBEAT_MS } from './docker-migration.service.js';
import { sanitizeDockerMigration } from './docker-migration-records.js';

describe('Docker migration durable records', () => {
  it('uses destructive full migration as the API default', () => {
    const parsed = DockerMigrationCreateInputSchema.parse({
      resource: { type: 'container', containerName: 'api' },
      sourceNodeId: '00000000-0000-4000-8000-000000000001',
      targetNodeId: '00000000-0000-4000-8000-000000000002',
      preflightFingerprint: '0123456789abcdef',
    });
    expect(parsed.keepSource).toBe(false);
  });

  it('uses a 15 second heartbeat and 60 second lease expiry', () => {
    expect(DOCKER_MIGRATION_LEASE_HEARTBEAT_MS).toBe(15_000);
    expect(DOCKER_MIGRATION_LEASE_EXPIRY_MS).toBe(60_000);
  });

  it('never exposes persistence internals or preflight fingerprints', () => {
    const now = new Date();
    const row = {
      id: '00000000-0000-4000-8000-000000000003',
      resourceType: 'container',
      resourceName: 'api',
      deploymentId: null,
      sourceNodeId: '00000000-0000-4000-8000-000000000001',
      targetNodeId: '00000000-0000-4000-8000-000000000002',
      keepSource: false,
      sourceState: 'running',
      sourceFingerprint: 'private-fingerprint',
      status: 'running',
      phase: 'transferring',
      preflight: { targetNodeSlug: 'target-node', environment: ['SECRET=value'] },
      plan: { target: { containerId: 'target-container-id' }, targetNodeSlug: 'renamed-target-node' },
      verification: {},
      proxySnapshot: {},
      progress: { completedPhases: [] },
      cancellationRequestedAt: null,
      cancellationRequestedById: null,
      leaseOwner: 'private-owner',
      leaseHeartbeatAt: now,
      leaseExpiresAt: now,
      errorCode: null,
      errorMessage: null,
      createdById: null,
      cutoverAt: null,
      createdAt: now,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    } satisfies typeof dockerMigrations.$inferSelect;

    expect(sanitizeDockerMigration(row)).not.toHaveProperty('sourceFingerprint');
    expect(sanitizeDockerMigration(row)).not.toHaveProperty('preflight');
    expect(sanitizeDockerMigration(row)).not.toHaveProperty('leaseOwner');
    expect(sanitizeDockerMigration(row)).toMatchObject({
      targetNodeSlug: 'renamed-target-node',
      targetResourceId: 'target-container-id',
    });
    expect(JSON.stringify(sanitizeDockerMigration(row))).not.toContain('SECRET=value');
  });
});
