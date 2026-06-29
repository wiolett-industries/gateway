import { describe, expect, it, vi } from 'vitest';
import { AIService } from './ai.service.js';

const BASE_USER = {
  id: 'user-1',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: ['admin:groups'] as string[],
  isBlocked: false,
};

function createService(groupService: Record<string, unknown>) {
  return new AIService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { log: vi.fn() } as never,
    {} as never,
    {} as never,
    groupService as never,
    {} as never,
    {} as never
  );
}

describe('AIService group tool routing', () => {
  it('routes permission group list/create/update/delete through the group service', async () => {
    const groupService = {
      listGroups: vi.fn().mockResolvedValue([{ id: 'group-1', name: 'Admin' }]),
      assertCanCreateGroup: vi.fn().mockResolvedValue(undefined),
      createGroup: vi.fn().mockResolvedValue({ id: 'group-2', name: 'Operators' }),
      assertCanUpdateGroup: vi.fn().mockResolvedValue(undefined),
      updateGroup: vi.fn().mockResolvedValue({ id: 'group-2', name: 'Ops' }),
      assertCanDeleteGroup: vi.fn().mockResolvedValue(undefined),
      deleteGroup: vi.fn().mockResolvedValue(undefined),
    };
    const service = createService(groupService);

    await expect(service.executeTool(BASE_USER, 'list_groups', {})).resolves.toEqual({
      result: [{ id: 'group-1', name: 'Admin' }],
      invalidateStores: [],
    });
    expect(groupService.listGroups).toHaveBeenCalledWith();

    const createInput = {
      name: 'Operators',
      description: 'Ops team',
      scopes: ['proxy:view'],
      parentId: 'parent-1',
    };
    await expect(service.executeTool(BASE_USER, 'create_group', createInput)).resolves.toEqual({
      result: { id: 'group-2', name: 'Operators' },
      invalidateStores: ['groups'],
    });
    expect(groupService.assertCanCreateGroup).toHaveBeenCalledWith(createInput, BASE_USER.scopes);
    expect(groupService.createGroup).toHaveBeenCalledWith(createInput);

    const updateInput = {
      groupId: 'group-2',
      name: 'Ops',
      description: 'Updated',
      scopes: ['proxy:view', 'ssl:cert:view'],
      parentId: null,
    };
    await expect(service.executeTool(BASE_USER, 'update_group', updateInput)).resolves.toEqual({
      result: { id: 'group-2', name: 'Ops' },
      invalidateStores: ['groups'],
    });
    expect(groupService.assertCanUpdateGroup).toHaveBeenCalledWith(
      'group-2',
      {
        name: 'Ops',
        description: 'Updated',
        scopes: ['proxy:view', 'ssl:cert:view'],
        parentId: null,
      },
      BASE_USER.scopes
    );
    expect(groupService.updateGroup).toHaveBeenCalledWith('group-2', {
      name: 'Ops',
      description: 'Updated',
      scopes: ['proxy:view', 'ssl:cert:view'],
      parentId: null,
    });

    await expect(service.executeTool(BASE_USER, 'delete_group', { groupId: 'group-2' })).resolves.toEqual({
      result: { success: true },
      invalidateStores: ['groups'],
    });
    expect(groupService.assertCanDeleteGroup).toHaveBeenCalledWith('group-2', BASE_USER.scopes);
    expect(groupService.deleteGroup).toHaveBeenCalledWith('group-2');
  });

  it('does not delete a group when descendant-scope authorization rejects it', async () => {
    const groupService = {
      assertCanDeleteGroup: vi.fn().mockRejectedValue(new Error('Cannot delete group with broader scopes')),
      deleteGroup: vi.fn().mockResolvedValue(undefined),
    };
    const service = createService(groupService);

    await expect(service.executeTool(BASE_USER, 'delete_group', { groupId: 'group-2' })).resolves.toEqual({
      error: 'Cannot delete group with broader scopes',
      invalidateStores: [],
    });
    expect(groupService.deleteGroup).not.toHaveBeenCalled();
  });
});
