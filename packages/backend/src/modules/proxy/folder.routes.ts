import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { authMiddleware, rbacMiddleware } from '@/modules/auth/auth.middleware.js';
import { FolderService } from './folder.service.js';
import {
  CreateFolderSchema,
  UpdateFolderSchema,
  MoveFolderSchema,
  ReorderFoldersSchema,
  GroupedHostsQuerySchema,
  MoveHostsToFolderSchema,
  ReorderHostsSchema,
} from './folder.schemas.js';
import type { AppEnv } from '@/types.js';

export const folderRoutes = new OpenAPIHono<AppEnv>();

folderRoutes.use('*', authMiddleware);

// Get folder tree (any authenticated)
folderRoutes.get('/', async (c) => {
  const folderService = container.resolve(FolderService);
  const tree = await folderService.getFolderTree();
  return c.json({ data: tree });
});

// Get grouped hosts (any authenticated) — main endpoint for proxy hosts page
folderRoutes.get('/grouped', async (c) => {
  const folderService = container.resolve(FolderService);
  const rawQuery = c.req.query();
  const query = GroupedHostsQuerySchema.parse(rawQuery);
  const result = await folderService.getGroupedHosts(query);
  return c.json({ data: result });
});

// Create folder (admin, operator)
folderRoutes.post('/', rbacMiddleware('admin', 'operator'), async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = CreateFolderSchema.parse(body);
  const folder = await folderService.createFolder(input, user.id);
  return c.json({ data: folder }, 201);
});

// Update folder / rename (admin, operator)
folderRoutes.put('/:id', rbacMiddleware('admin', 'operator'), async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const input = UpdateFolderSchema.parse(body);
  const folder = await folderService.updateFolder(id, input, user.id);
  return c.json({ data: folder });
});

// Move folder to new parent (admin, operator)
folderRoutes.put('/:id/move', rbacMiddleware('admin', 'operator'), async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const input = MoveFolderSchema.parse(body);
  const folder = await folderService.moveFolder(id, input, user.id);
  return c.json({ data: folder });
});

// Reorder folders (admin, operator)
folderRoutes.put('/reorder', rbacMiddleware('admin', 'operator'), async (c) => {
  const folderService = container.resolve(FolderService);
  const body = await c.req.json();
  const input = ReorderFoldersSchema.parse(body);
  await folderService.reorderFolders(input);
  return c.json({ success: true });
});

// Delete folder (admin)
folderRoutes.delete('/:id', rbacMiddleware('admin'), async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  await folderService.deleteFolder(id, user.id);
  return c.body(null, 204);
});

// Reorder hosts within a folder (admin, operator)
folderRoutes.put('/reorder-hosts', rbacMiddleware('admin', 'operator'), async (c) => {
  const folderService = container.resolve(FolderService);
  const body = await c.req.json();
  const input = ReorderHostsSchema.parse(body);
  await folderService.reorderHosts(input);
  return c.json({ success: true });
});

// Move hosts to folder (admin, operator)
folderRoutes.post('/move-hosts', rbacMiddleware('admin', 'operator'), async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = MoveHostsToFolderSchema.parse(body);
  await folderService.moveHostsToFolder(input, user.id);
  return c.json({ success: true });
});
