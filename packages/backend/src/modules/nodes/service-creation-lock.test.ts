import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/middleware/error-handler.js';
import { assertNodeAllowsServiceCreation } from './service-creation-lock.js';

function dbWithNode(node: unknown) {
  const limit = vi.fn().mockResolvedValue(node ? [node] : []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { db: { select } as never, select, from, where, limit };
}

describe('assertNodeAllowsServiceCreation', () => {
  it('allows unlocked nodes of the expected type', async () => {
    const { db } = dbWithNode({
      id: 'node-1',
      type: 'nginx',
      serviceCreationLocked: false,
    });

    await expect(assertNodeAllowsServiceCreation(db, 'node-1', 'nginx')).resolves.toMatchObject({
      id: 'node-1',
      type: 'nginx',
    });
  });

  it('rejects locked nodes with the standard conflict error', async () => {
    const { db } = dbWithNode({
      id: 'node-1',
      type: 'docker',
      serviceCreationLocked: true,
    });

    await expect(assertNodeAllowsServiceCreation(db, 'node-1', 'docker')).rejects.toMatchObject({
      statusCode: 409,
      code: 'NODE_SERVICE_CREATION_LOCKED',
      message: 'Node is locked for new service creation',
    } satisfies Partial<AppError>);
  });

  it('rejects nodes that are not the expected service type', async () => {
    const { db } = dbWithNode({
      id: 'node-1',
      type: 'monitoring',
      serviceCreationLocked: false,
    });

    await expect(assertNodeAllowsServiceCreation(db, 'node-1', 'nginx')).rejects.toMatchObject({
      statusCode: 400,
      code: 'NOT_NGINX',
    } satisfies Partial<AppError>);
  });
});
