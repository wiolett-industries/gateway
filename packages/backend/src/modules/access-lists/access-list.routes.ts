import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { authMiddleware, rbacMiddleware } from '@/modules/auth/auth.middleware.js';
import { AccessListService } from './access-list.service.js';
import {
  CreateAccessListSchema,
  UpdateAccessListSchema,
  AccessListQuerySchema,
} from './access-list.schemas.js';
import type { AppEnv } from '@/types.js';

export const accessListRoutes = new OpenAPIHono<AppEnv>();

accessListRoutes.use('*', authMiddleware);

// List access lists (any authenticated role)
accessListRoutes.get('/', async (c) => {
  const accessListService = container.resolve(AccessListService);
  const rawQuery = c.req.query();
  const query = AccessListQuerySchema.parse(rawQuery);
  const result = await accessListService.list(query);
  return c.json(result);
});

// Get access list detail
accessListRoutes.get('/:id', async (c) => {
  const accessListService = container.resolve(AccessListService);
  const id = c.req.param('id');
  const accessList = await accessListService.get(id);
  return c.json({ data: accessList });
});

// Create access list (admin, operator)
accessListRoutes.post('/', rbacMiddleware('admin', 'operator'), async (c) => {
  const accessListService = container.resolve(AccessListService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = CreateAccessListSchema.parse(body);
  const accessList = await accessListService.create(input, user.id);
  return c.json({ data: accessList }, 201);
});

// Update access list (admin, operator)
accessListRoutes.put('/:id', rbacMiddleware('admin', 'operator'), async (c) => {
  const accessListService = container.resolve(AccessListService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const input = UpdateAccessListSchema.parse(body);
  const accessList = await accessListService.update(id, input, user.id);
  return c.json({ data: accessList });
});

// Delete access list (admin only)
accessListRoutes.delete('/:id', rbacMiddleware('admin'), async (c) => {
  const accessListService = container.resolve(AccessListService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  await accessListService.delete(id, user.id);
  return c.body(null, 204);
});
