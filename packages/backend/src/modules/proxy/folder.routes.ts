import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { authMiddleware, requireScope, sessionOnly } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import {
  CreateFolderSchema,
  GroupedHostsQuerySchema,
  MoveFolderSchema,
  MoveHostsToFolderSchema,
  ReorderFoldersSchema,
  ReorderHostsSchema,
  UpdateFolderSchema,
} from './folder.schemas.js';
import { FolderService } from './folder.service.js';

export const folderRoutes = new OpenAPIHono<AppEnv>();

folderRoutes.use('*', authMiddleware);
folderRoutes.use('*', sessionOnly);

// --- Static GET routes first ---

// Get folder tree
folderRoutes.get('/', requireScope('proxy:list'), async (c) => {
  const folderService = container.resolve(FolderService);
  const tree = await folderService.getFolderTree();
  return c.json({ data: tree });
});

// Get grouped hosts
folderRoutes.get('/grouped', requireScope('proxy:list'), async (c) => {
  const folderService = container.resolve(FolderService);
  const rawQuery = c.req.query();
  const query = GroupedHostsQuerySchema.parse(rawQuery);
  const result = await folderService.getGroupedHosts(query);
  return c.json({ data: result });
});

// --- Static POST routes ---

// Create folder
folderRoutes.post('/', requireScope('proxy:edit'), async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = CreateFolderSchema.parse(body);
  const folder = await folderService.createFolder(input, user.id);
  return c.json({ data: folder }, 201);
});

// Move hosts to folder
folderRoutes.post('/move-hosts', requireScope('proxy:edit'), async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = MoveHostsToFolderSchema.parse(body);
  await folderService.moveHostsToFolder(input, user.id);
  return c.json({ success: true });
});

// --- Static PUT routes (before /:id) ---

// Reorder folders
folderRoutes.put('/reorder', requireScope('proxy:edit'), async (c) => {
  const folderService = container.resolve(FolderService);
  const body = await c.req.json();
  const input = ReorderFoldersSchema.parse(body);
  await folderService.reorderFolders(input);
  return c.json({ success: true });
});

// Reorder hosts within a folder
folderRoutes.put('/reorder-hosts', requireScope('proxy:edit'), async (c) => {
  const folderService = container.resolve(FolderService);
  const body = await c.req.json();
  const input = ReorderHostsSchema.parse(body);
  await folderService.reorderHosts(input);
  return c.json({ success: true });
});

// --- Parameterised routes last ---

// Update folder / rename
folderRoutes.put('/:id', requireScope('proxy:edit'), async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const input = UpdateFolderSchema.parse(body);
  const folder = await folderService.updateFolder(id, input, user.id);
  return c.json({ data: folder });
});

// Move folder to new parent
folderRoutes.put('/:id/move', requireScope('proxy:edit'), async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const input = MoveFolderSchema.parse(body);
  const folder = await folderService.moveFolder(id, input, user.id);
  return c.json({ data: folder });
});

// Delete folder
folderRoutes.delete('/:id', requireScope('proxy:delete'), async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const id = c.req.param('id');
  await folderService.deleteFolder(id, user.id);
  return c.body(null, 204);
});

// Clone folder's proxy host
folderRoutes.post('/:id/clone', requireScope('proxy:edit'), async (c) => {
  // Placeholder for future clone functionality
  return c.json({ error: 'Not implemented' }, 501);
});
