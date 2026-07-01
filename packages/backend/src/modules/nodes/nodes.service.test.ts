import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { NodesService } from './nodes.service.js';

describe('NodesService enrollment token creation', () => {
  it('returns a v2 enrollment token and persists its selector with the hashed token', async () => {
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

    const result = await new NodesService(db, auditService, registry, grpcIdentityService, nodeDispatch).create(
      { type: 'docker', hostname: 'node.local' },
      'user-1'
    );

    expect(result.enrollmentToken).toMatch(/^gw_node_v2_[0-9a-f]{16}_[0-9a-f]{48}$/);
    expect(insertedValues).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'docker',
        hostname: 'node.local',
        enrollmentTokenSelector: result.enrollmentToken.split('_')[3],
        status: 'pending',
      })
    );

    const persistedHash = insertedValues.mock.calls[0]?.[0]?.enrollmentTokenHash;
    expect(await bcrypt.compare(result.enrollmentToken, persistedHash)).toBe(true);
    expect(result.gatewayCertSha256).toBe('sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  });
});
