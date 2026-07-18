import { describe, expect, it, vi } from 'vitest';
import { assertContainerNotUsedByProxy, assertDeploymentNotUsedByProxy } from './docker-proxy-link.guard.js';

function dbWithRows(rows: unknown[]) {
  const limit = vi.fn(async () => rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return { select: vi.fn(() => ({ from })) };
}

describe('Docker proxy link deletion guards', () => {
  it('blocks deletion of a linked container', async () => {
    await expect(
      assertContainerNotUsedByProxy(
        dbWithRows([{ id: 'proxy-1', domainNames: ['api.example.com'] }]) as never,
        'node-1',
        'api'
      )
    ).rejects.toMatchObject({ code: 'PROXY_UPSTREAM_IN_USE', statusCode: 409 });
  });

  it('blocks deletion of a linked deployment', async () => {
    await expect(
      assertDeploymentNotUsedByProxy(
        dbWithRows([{ id: 'proxy-1', domainNames: ['app.example.com'] }]) as never,
        'deployment-1'
      )
    ).rejects.toMatchObject({ code: 'PROXY_UPSTREAM_IN_USE', statusCode: 409 });
  });

  it('allows deletion when no proxy uses the resource', async () => {
    await expect(assertContainerNotUsedByProxy(dbWithRows([]) as never, 'node-1', 'api')).resolves.toBeUndefined();
  });
});
