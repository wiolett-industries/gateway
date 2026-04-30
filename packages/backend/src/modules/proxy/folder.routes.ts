import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { authMiddleware, isProgrammaticAuth, requireScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import {
  cloneProxyFolderRoute,
  createProxyFolderRoute,
  deleteProxyFolderRoute,
  groupedProxyHostsRoute,
  listProxyFoldersRoute,
  moveProxyFolderRoute,
  moveProxyHostsRoute,
  reorderProxyFoldersRoute,
  reorderProxyHostsRoute,
  updateProxyFolderRoute,
} from './folder.docs.js';
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

export const folderRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

folderRoutes.use('*', authMiddleware);

function stripRawProxyConfig<T extends Record<string, unknown>>(host: T): Omit<T, 'rawConfig' | 'rawConfigEnabled'> {
  const { rawConfig: _rawConfig, rawConfigEnabled: _rawConfigEnabled, ...rest } = host;
  return rest;
}

export function stripGroupedRawConfigForProgrammaticResponse(
  result: Awaited<ReturnType<FolderService['getGroupedHosts']>>
) {
  const stripFolder = (folder: any): any => ({
    ...folder,
    hosts: folder.hosts.map((host: any) => stripRawProxyConfig(host)),
    children: folder.children.map(stripFolder),
  });

  return {
    ...result,
    folders: result.folders.map(stripFolder),
    ungroupedHosts: result.ungroupedHosts.map((host: any) => stripRawProxyConfig(host)),
  };
}

// --- Static GET routes first ---

// Get folder tree
folderRoutes.openapi({ ...listProxyFoldersRoute, middleware: requireScope('proxy:list') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const tree = await folderService.getFolderTree();
  return c.json({ data: tree });
});

// Get grouped hosts
folderRoutes.openapi({ ...groupedProxyHostsRoute, middleware: requireScope('proxy:list') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const rawQuery = c.req.query();
  const query = GroupedHostsQuerySchema.parse(rawQuery);
  const result = await folderService.getGroupedHosts(query);
  if (isProgrammaticAuth(c)) return c.json({ data: stripGroupedRawConfigForProgrammaticResponse(result) });
  return c.json({ data: result });
});

// --- Static POST routes ---

// Create folder
folderRoutes.openapi({ ...createProxyFolderRoute, middleware: requireScope('proxy:edit') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = CreateFolderSchema.parse(body);
  const folder = await folderService.createFolder(input, user.id);
  return c.json({ data: folder }, 201);
});

// Move hosts to folder
folderRoutes.openapi({ ...moveProxyHostsRoute, middleware: requireScope('proxy:edit') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = MoveHostsToFolderSchema.parse(body);
  await folderService.moveHostsToFolder(input, user.id);
  return c.json({ success: true });
});

// --- Static PUT routes (before /:id) ---

// Reorder folders
folderRoutes.openapi({ ...reorderProxyFoldersRoute, middleware: requireScope('proxy:edit') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const body = await c.req.json();
  const input = ReorderFoldersSchema.parse(body);
  await folderService.reorderFolders(input);
  return c.json({ success: true });
});

// Reorder hosts within a folder
folderRoutes.openapi({ ...reorderProxyHostsRoute, middleware: requireScope('proxy:edit') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const body = await c.req.json();
  const input = ReorderHostsSchema.parse(body);
  await folderService.reorderHosts(input);
  return c.json({ success: true });
});

// --- Parameterised routes last ---

// Update folder / rename
folderRoutes.openapi({ ...updateProxyFolderRoute, middleware: requireScope('proxy:edit') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  const body = await c.req.json();
  const input = UpdateFolderSchema.parse(body);
  const folder = await folderService.updateFolder(id, input, user.id);
  return c.json({ data: folder });
});

// Move folder to new parent
folderRoutes.openapi({ ...moveProxyFolderRoute, middleware: requireScope('proxy:edit') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  const body = await c.req.json();
  const input = MoveFolderSchema.parse(body);
  const folder = await folderService.moveFolder(id, input, user.id);
  return c.json({ data: folder });
});

// Delete folder
folderRoutes.openapi({ ...deleteProxyFolderRoute, middleware: requireScope('proxy:delete') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  await folderService.deleteFolder(id, user.id);
  return c.body(null, 204);
});

// Clone folder's proxy host
folderRoutes.openapi({ ...cloneProxyFolderRoute, middleware: requireScope('proxy:edit') }, async (c) => {
  // Placeholder for future clone functionality
  return c.json({ error: 'Not implemented' }, 501);
});
