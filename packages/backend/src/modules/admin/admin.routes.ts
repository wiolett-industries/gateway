import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { canManageUser, isScopeSubset } from '@/lib/permissions.js';
import {
  CreateUserSchema,
  UpdateAuthProvisioningSettingsSchema,
  UpdateBlockSchema,
  UpdateUserGroupSchema,
} from '@/modules/admin/admin.schemas.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import { authMiddleware, requireScope } from '@/modules/auth/auth.middleware.js';
import { AuthService } from '@/modules/auth/auth.service.js';
import { AuthSettingsService } from '@/modules/auth/auth.settings.service.js';
import { GroupService } from '@/modules/groups/group.service.js';
import { SessionService } from '@/services/session.service.js';
import type { AppEnv } from '@/types.js';

export const adminRoutes = new OpenAPIHono<AppEnv>();

adminRoutes.use('*', authMiddleware);

// List all users
adminRoutes.get('/users', requireScope('admin:users'), async (c) => {
  const authService = container.resolve(AuthService);
  const userList = await authService.listUsers();
  return c.json(userList);
});

adminRoutes.get('/auth-settings', requireScope('admin:users'), async (c) => {
  const authSettingsService = container.resolve(AuthSettingsService);
  const groupService = container.resolve(GroupService);
  const actorScopes = c.get('effectiveScopes') || [];

  const [settings, groups] = await Promise.all([authSettingsService.getConfig(), groupService.listGroups()]);
  const assignableGroups = groups.filter((group) => isScopeSubset(group.scopes as string[], actorScopes));

  return c.json({
    ...settings,
    availableGroups: assignableGroups.map((group) => ({
      id: group.id,
      name: group.name,
      isBuiltin: group.isBuiltin,
    })),
  });
});

adminRoutes.put('/auth-settings', requireScope('admin:users'), async (c) => {
  const authSettingsService = container.resolve(AuthSettingsService);
  const groupService = container.resolve(GroupService);
  const auditService = container.resolve(AuditService);
  const currentUser = c.get('user')!;
  const actorScopes = c.get('effectiveScopes') || [];
  const body = await c.req.json();
  const input = UpdateAuthProvisioningSettingsSchema.parse(body);

  if (input.oidcDefaultGroupId) {
    const destGroup = await groupService.getGroup(input.oidcDefaultGroupId);
    if (!isScopeSubset(destGroup.scopes as string[], actorScopes)) {
      return c.json(
        { code: 'PRIVILEGE_BOUNDARY', message: 'Cannot assign a group with permissions you do not possess' },
        403
      );
    }
  }

  try {
    const updated = await authSettingsService.updateConfig(input);
    const groups = await groupService.listGroups();
    const assignableGroups = groups.filter((group) => isScopeSubset(group.scopes as string[], actorScopes));

    await auditService.log({
      userId: currentUser.id,
      action: 'auth.settings_update',
      resourceType: 'settings',
      resourceId: 'auth',
      details: input,
      ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip'),
      userAgent: c.req.header('user-agent'),
    });

    return c.json({
      ...updated,
      availableGroups: assignableGroups.map((group) => ({
        id: group.id,
        name: group.name,
        isBuiltin: group.isBuiltin,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update authentication settings';
    if (message === 'Permission group not found') {
      return c.json({ code: 'NOT_FOUND', message }, 404);
    }
    throw err;
  }
});

// Create user before first login
adminRoutes.post('/users', requireScope('admin:users'), async (c) => {
  const authService = container.resolve(AuthService);
  const groupService = container.resolve(GroupService);
  const auditService = container.resolve(AuditService);
  const currentUser = c.get('user')!;
  const actorScopes = c.get('effectiveScopes') || [];
  const body = await c.req.json();
  const input = CreateUserSchema.parse(body);

  const destGroup = await groupService.getGroup(input.groupId);
  if (!isScopeSubset(destGroup.scopes as string[], actorScopes)) {
    return c.json(
      { code: 'PRIVILEGE_BOUNDARY', message: 'Cannot assign a group with permissions you do not possess' },
      403
    );
  }

  try {
    const createdUser = await authService.createUser(input);

    await auditService.log({
      userId: currentUser.id,
      action: 'user.create',
      resourceType: 'user',
      resourceId: createdUser.id,
      details: { email: createdUser.email, groupId: createdUser.groupId },
      ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip'),
      userAgent: c.req.header('user-agent'),
    });

    return c.json(createdUser, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create user';
    if (message === 'User with this email already exists') {
      return c.json({ code: 'CONFLICT', message }, 409);
    }
    if (message === 'Permission group not found') {
      return c.json({ code: 'NOT_FOUND', message }, 404);
    }
    throw err;
  }
});

// Update user group
adminRoutes.patch('/users/:id/group', requireScope('admin:users'), async (c) => {
  const authService = container.resolve(AuthService);
  const groupService = container.resolve(GroupService);
  const auditService = container.resolve(AuditService);
  const currentUser = c.get('user')!;
  const actorScopes = c.get('effectiveScopes') || [];
  const userId = c.req.param('id');
  const body = await c.req.json();
  const { groupId } = UpdateUserGroupSchema.parse(body);

  if (userId === currentUser.id) {
    return c.json({ code: 'SELF_DEMOTION', message: 'Cannot change your own group' }, 400);
  }

  // Check privilege boundary against target's CURRENT scopes
  const targetUser = await authService.getUserById(userId);
  if (!targetUser) {
    return c.json({ code: 'NOT_FOUND', message: 'User not found' }, 404);
  }
  if (targetUser.oidcSubject.startsWith('system:')) {
    return c.json({ code: 'SYSTEM_USER', message: 'Cannot modify the system user' }, 403);
  }
  const denyReason = canManageUser(actorScopes, targetUser.scopes);
  if (denyReason) {
    return c.json({ code: 'PRIVILEGE_BOUNDARY', message: denyReason }, 403);
  }

  // Check privilege boundary against DESTINATION group's scopes
  const destGroup = await groupService.getGroup(groupId);
  if (!isScopeSubset(destGroup.scopes as string[], actorScopes)) {
    return c.json(
      { code: 'PRIVILEGE_BOUNDARY', message: 'Cannot assign a group with permissions you do not possess' },
      403
    );
  }

  const updatedUser = await authService.updateUserGroup(userId, groupId);

  // Destroy all sessions so the user picks up new scopes on next login
  const sessionService = container.resolve(SessionService);
  await sessionService.destroyAllUserSessions(userId);

  await auditService.log({
    userId: currentUser.id,
    action: 'user.group_change',
    resourceType: 'user',
    resourceId: userId,
    details: { newGroupId: groupId },
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
  });

  return c.json(updatedUser);
});

// Block / unblock user
adminRoutes.patch('/users/:id/block', requireScope('admin:users'), async (c) => {
  const authService = container.resolve(AuthService);
  const auditService = container.resolve(AuditService);
  const currentUser = c.get('user')!;
  const actorScopes = c.get('effectiveScopes') || [];
  const userId = c.req.param('id');
  const body = await c.req.json();
  const { blocked } = UpdateBlockSchema.parse(body);

  if (userId === currentUser.id) {
    return c.json({ code: 'SELF_BLOCK', message: 'Cannot block yourself' }, 400);
  }

  // Check privilege boundary
  const targetUser = await authService.getUserById(userId);
  if (!targetUser) {
    return c.json({ code: 'NOT_FOUND', message: 'User not found' }, 404);
  }
  if (targetUser.oidcSubject.startsWith('system:')) {
    return c.json({ code: 'SYSTEM_USER', message: 'Cannot modify the system user' }, 403);
  }
  const denyReason = canManageUser(actorScopes, targetUser.scopes);
  if (denyReason) {
    return c.json({ code: 'PRIVILEGE_BOUNDARY', message: denyReason }, 403);
  }

  if (blocked) {
    await authService.blockUser(userId);
  } else {
    await authService.unblockUser(userId);
  }

  await auditService.log({
    userId: currentUser.id,
    action: blocked ? 'user.block' : 'user.unblock',
    resourceType: 'user',
    resourceId: userId,
    details: { blocked },
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
  });

  return c.json({ message: blocked ? 'User blocked' : 'User unblocked' });
});

// Delete user
adminRoutes.delete('/users/:id', requireScope('admin:users'), async (c) => {
  const authService = container.resolve(AuthService);
  const auditService = container.resolve(AuditService);
  const currentUser = c.get('user')!;
  const actorScopes = c.get('effectiveScopes') || [];
  const userId = c.req.param('id');

  if (userId === currentUser.id) {
    return c.json({ code: 'SELF_DELETE', message: 'Cannot delete your own account' }, 400);
  }

  // Check privilege boundary
  const targetUser = await authService.getUserById(userId);
  if (!targetUser) {
    return c.json({ code: 'NOT_FOUND', message: 'User not found' }, 404);
  }
  if (targetUser.oidcSubject.startsWith('system:')) {
    return c.json({ code: 'SYSTEM_USER', message: 'Cannot delete the system user' }, 403);
  }
  const denyReason = canManageUser(actorScopes, targetUser.scopes);
  if (denyReason) {
    return c.json({ code: 'PRIVILEGE_BOUNDARY', message: denyReason }, 403);
  }

  await authService.deleteUser(userId);

  await auditService.log({
    userId: currentUser.id,
    action: 'user.delete',
    resourceType: 'user',
    resourceId: userId,
    details: {},
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
  });

  return c.json({ message: 'User deleted' });
});
