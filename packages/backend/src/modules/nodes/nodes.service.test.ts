import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { NodesService } from './nodes.service.js';

describe('NodesService enrollment token creation', () => {
  function createService(options?: {
    gatewayGrpcPublicTarget?: string | null;
    gatewayGrpcLocalIp?: string | null;
    grpcPort?: number;
  }) {
    const insertedValues = vi.fn();
    const node = { id: 'node-1', type: 'docker', hostname: 'node.local', status: 'pending' };
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn((value) => {
          insertedValues(value);
          return {
            returning: vi.fn(async () => [node]),
          };
        }),
      })),
    } as any;
    const auditService = { log: vi.fn(async () => undefined) } as any;
    const registry = { getNode: vi.fn() } as any;
    const grpcIdentityService = {
      getGatewayCertSha256: vi.fn(
        async () => 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      ),
    } as any;
    const nodeDispatch = {} as any;
    const service = new NodesService(db, auditService, registry, grpcIdentityService, nodeDispatch);
    if (options) {
      service.setGeneralSettingsService(
        {
          getGatewayEndpointSettings: vi.fn(async () => ({
            gatewayPublicIps: [],
            gatewayGrpcPublicTarget: options.gatewayGrpcPublicTarget ?? null,
            gatewayGrpcLocalIp: options.gatewayGrpcLocalIp ?? null,
          })),
        } as any,
        options.grpcPort ?? 9443
      );
    }
    return { service, insertedValues, grpcIdentityService };
  }

  it('returns a v2 enrollment token and persists its selector with the hashed token', async () => {
    const { service, insertedValues } = createService();

    const result = await service.create({ type: 'docker', hostname: 'node.local' }, 'user-1');

    expect(result.enrollmentToken).toMatch(/^gw_node_v2_[0-9a-f]{16}_[0-9a-f]{48}$/);
    expect(insertedValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'docker',
        hostname: 'node.local',
        slug: 'node-local',
        enrollmentTokenSelector: result.enrollmentToken.split('_')[3],
        status: 'pending',
      })
    );

    const persistedHash = insertedValues.mock.calls[0]?.[0]?.enrollmentTokenHash;
    expect(await bcrypt.compare(result.enrollmentToken, persistedHash)).toBe(true);
    expect(result.gatewayCertSha256).toBe('sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  });

  it('keeps the slug when an appearance save repeats the current display name', async () => {
    const existing = {
      id: 'node-1',
      type: 'docker',
      hostname: 'node.local',
      displayName: 'Primary node',
      appearanceColor: null,
      slug: 'primary-node-2',
    };
    const updatedValues = vi.fn();
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => [existing]) })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values) => {
          updatedValues(values);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{ ...existing, ...values }]),
            })),
          };
        }),
      })),
    } as any;
    const service = new NodesService(
      db,
      { log: vi.fn(async () => undefined) } as any,
      { getNode: vi.fn() } as any,
      { getGatewayCertSha256: vi.fn() } as any,
      {} as any
    );

    const result = await service.update(
      existing.id,
      { displayName: existing.displayName, appearanceColor: 'blue' },
      'user-1'
    );

    expect(updatedValues).toHaveBeenCalledWith(expect.not.objectContaining({ slug: expect.anything() }));
    expect(result.slug).toBe(existing.slug);
  });

  it('returns only the public enrollment target when local gRPC IP is not configured', async () => {
    const { service } = createService({
      gatewayGrpcPublicTarget: 'gateway.example.com:9443',
      gatewayGrpcLocalIp: null,
    });

    const result = await service.create({ type: 'docker', hostname: 'node.local' }, 'user-1');

    expect(result.gatewayEnrollmentTargets).toEqual({
      public: { label: 'Public node', gateway: 'gateway.example.com:9443' },
    });
  });

  it('returns local and public enrollment targets when local gRPC IP is configured', async () => {
    const { service } = createService({
      gatewayGrpcPublicTarget: 'gateway.example.com',
      gatewayGrpcLocalIp: '10.0.0.5',
      grpcPort: 9443,
    });

    const result = await service.create({ type: 'docker', hostname: 'node.local' }, 'user-1');

    expect(result.gatewayEnrollmentTargets).toEqual({
      public: { label: 'Public node', gateway: 'gateway.example.com:9443' },
      local: { label: 'Local node', gateway: '10.0.0.5:9443' },
    });
  });
});
