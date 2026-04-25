import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import { authMiddleware, requireScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { CreateGroupSchema, UpdateGroupSchema } from './group.schemas.js';
import { GroupService } from './group.service.js';

export const groupRoutes = new OpenAPIHono<AppEnv>();

groupRoutes.use('*', authMiddleware);
groupRoutes.use('*', requireScope('admin:groups'));

// List all groups
groupRoutes.get('/', async (c) => {
  const groupService = container.resolve(GroupService);
  const groups = await groupService.listGroups();
  return c.json(groups);
});

// Get single group
groupRoutes.get('/:id', async (c) => {
  const groupService = container.resolve(GroupService);
  const id = c.req.param('id');
  const group = await groupService.getGroup(id);
  return c.json(group);
});

// Create custom group
groupRoutes.post('/', async (c) => {
  const groupService = container.resolve(GroupService);
  const auditService = container.resolve(AuditService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = CreateGroupSchema.parse(body);

  const userScopes = c.get('effectiveScopes') || [];
  await groupService.assertCanCreateGroup(input, userScopes);

  const group = await groupService.createGroup(input);

  await auditService.log({
    userId: user.id,
    action: 'group.create',
    resourceType: 'permission_group',
    resourceId: group.id,
    details: { name: group.name, scopes: input.scopes },
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
  });

  return c.json(group, 201);
});

// Update custom group
groupRoutes.put('/:id', async (c) => {
  const groupService = container.resolve(GroupService);
  const auditService = container.resolve(AuditService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const input = UpdateGroupSchema.parse(body);

  const userScopes = c.get('effectiveScopes') || [];
  await groupService.assertCanUpdateGroup(id, input, userScopes);

  const group = await groupService.updateGroup(id, input);

  await auditService.log({
    userId: user.id,
    action: 'group.update',
    resourceType: 'permission_group',
    resourceId: id,
    details: { changes: input },
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
  });

  return c.json(group);
});

// Delete custom group
groupRoutes.delete('/:id', async (c) => {
  const groupService = container.resolve(GroupService);
  const auditService = container.resolve(AuditService);
  const user = c.get('user')!;
  const id = c.req.param('id');

  // getGroup will throw 404 if not found, and deleteGroup will throw if built-in or has members
  const group = await groupService.getGroup(id);
  await groupService.deleteGroup(id);

  await auditService.log({
    userId: user.id,
    action: 'group.delete',
    resourceType: 'permission_group',
    resourceId: id,
    details: { name: group.name },
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
  });

  return c.json({ message: 'Group deleted' });
});
