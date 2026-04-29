import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { DrizzleClient } from '@/db/client.js';
import { GroupService } from './group.service.js';

function createService(groups: Array<{ id: string; parentId: string | null; name: string; scopes: string[] }>) {
  return new GroupService({
    query: {
      permissionGroups: {
        findMany: vi.fn().mockResolvedValue(groups),
      },
    },
  } as unknown as DrizzleClient);
}

describe('GroupService delete authorization', () => {
  it('rejects custom groups that would inherit admin:system from a parent', async () => {
    const service = createService([
      { id: 'system-admin', parentId: null, name: 'system-admin', scopes: ['admin:system', 'nodes:list'] },
    ]);

    await expect(
      service.assertCanCreateGroup({ name: 'custom-system-child', scopes: ['nodes:list'], parentId: 'system-admin' }, [
        'admin:system',
        'nodes:list',
      ])
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'SCOPE_NOT_ALLOWED',
    });
  });

  it('rejects deleting a group whose scopes exceed the actor', async () => {
    const service = createService([
      { id: 'parent', parentId: null, name: 'parent', scopes: ['nodes:list', 'admin:users'] },
    ]);

    await expect(service.assertCanDeleteGroup('parent', ['admin:groups', 'nodes:list'])).rejects.toMatchObject({
      statusCode: 403,
      code: 'SCOPE_NOT_ALLOWED',
    });
  });

  it('checks child groups because deletion unparents and cascades permissions', async () => {
    const service = createService([
      { id: 'parent', parentId: null, name: 'parent', scopes: ['nodes:list'] },
      { id: 'child', parentId: 'parent', name: 'child', scopes: ['admin:users'] },
    ]);

    await expect(service.assertCanDeleteGroup('parent', ['admin:groups', 'nodes:list'])).rejects.toMatchObject({
      statusCode: 403,
      code: 'SCOPE_NOT_ALLOWED',
    });
  });

  it('allows deleting a group tree fully covered by actor scopes', async () => {
    const service = createService([
      { id: 'parent', parentId: null, name: 'parent', scopes: ['nodes:list'] },
      { id: 'child', parentId: 'parent', name: 'child', scopes: ['proxy:view:host-1'] },
    ]);

    await expect(
      service.assertCanDeleteGroup('parent', ['admin:groups', 'nodes:list', 'proxy:view:host-1'])
    ).resolves.toBeUndefined();
  });
});
