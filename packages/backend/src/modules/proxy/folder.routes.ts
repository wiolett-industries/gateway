import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { getResourceScopedIds, hasScope, hasScopeBase } from '@/lib/permissions.js';
import { AppError } from '@/middleware/error-handler.js';
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

function requireFolderListAccess(scopes: string[]) {
  if (!hasScopeBase(scopes, 'proxy:view') && !hasScope(scopes, 'proxy:folders:manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Missing required scope: proxy:view or proxy:folders:manage');
  }
}

// --- Static GET routes first ---

// Get folder tree
folderRoutes.openapi(listProxyFoldersRoute, async (c) => {
  const folderService = container.resolve(FolderService);
  const scopes = c.get('effectiveScopes') || [];
  requireFolderListAccess(scopes);
  const canManageFolders = hasScope(scopes, 'proxy:folders:manage');
  const tree = await folderService.getFolderTree(
    canManageFolders || hasScope(scopes, 'proxy:view')
      ? { includeAllFolders: canManageFolders }
      : { allowedHostIds: getResourceScopedIds(scopes, 'proxy:view') }
  );
  return c.json({ data: tree });
});

// Get grouped hosts
folderRoutes.openapi(groupedProxyHostsRoute, async (c) => {
  const folderService = container.resolve(FolderService);
  const rawQuery = c.req.query();
  const query = GroupedHostsQuerySchema.parse(rawQuery);
  const scopes = c.get('effectiveScopes') || [];
  requireFolderListAccess(scopes);
  const canManageFolders = hasScope(scopes, 'proxy:folders:manage');
  const result = await folderService.getGroupedHosts(
    query,
    hasScope(scopes, 'proxy:view')
      ? { includeAllFolders: canManageFolders }
      : { allowedHostIds: getResourceScopedIds(scopes, 'proxy:view'), includeAllFolders: canManageFolders }
  );
  if (isProgrammaticAuth(c)) return c.json({ data: stripGroupedRawConfigForProgrammaticResponse(result) });
  return c.json({ data: result });
});

// --- Static POST routes ---

// Create folder
folderRoutes.openapi({ ...createProxyFolderRoute, middleware: requireScope('proxy:folders:manage') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = CreateFolderSchema.parse(body);
  const folder = await folderService.createFolder(input, user.id);
  return c.json({ data: folder }, 201);
});

// Move hosts to folder
folderRoutes.openapi({ ...moveProxyHostsRoute, middleware: requireScope('proxy:folders:manage') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = MoveHostsToFolderSchema.parse(body);
  const scopes = c.get('effectiveScopes') || [];
  for (const hostId of input.hostIds) {
    if (!hasScope(scopes, `proxy:edit:${hostId}`)) {
      throw new AppError(403, 'FORBIDDEN', `Missing required scope: proxy:edit:${hostId}`);
    }
  }
  await folderService.moveHostsToFolder(input, user.id);
  return c.json({ success: true });
});

// --- Static PUT routes (before /:id) ---

// Reorder folders
folderRoutes.openapi({ ...reorderProxyFoldersRoute, middleware: requireScope('proxy:folders:manage') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const body = await c.req.json();
  const input = ReorderFoldersSchema.parse(body);
  await folderService.reorderFolders(input);
  return c.json({ success: true });
});

// Reorder hosts within a folder
folderRoutes.openapi({ ...reorderProxyHostsRoute, middleware: requireScope('proxy:folders:manage') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const body = await c.req.json();
  const input = ReorderHostsSchema.parse(body);
  const scopes = c.get('effectiveScopes') || [];
  for (const item of input.items) {
    if (!hasScope(scopes, `proxy:edit:${item.id}`)) {
      throw new AppError(403, 'FORBIDDEN', `Missing required scope: proxy:edit:${item.id}`);
    }
  }
  await folderService.reorderHosts(input);
  return c.json({ success: true });
});

// --- Parameterised routes last ---

// Update folder / rename
folderRoutes.openapi({ ...updateProxyFolderRoute, middleware: requireScope('proxy:folders:manage') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  const body = await c.req.json();
  const input = UpdateFolderSchema.parse(body);
  const folder = await folderService.updateFolder(id, input, user.id);
  return c.json({ data: folder });
});

// Move folder to new parent
folderRoutes.openapi({ ...moveProxyFolderRoute, middleware: requireScope('proxy:folders:manage') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  const body = await c.req.json();
  const input = MoveFolderSchema.parse(body);
  const folder = await folderService.moveFolder(id, input, user.id);
  return c.json({ data: folder });
});

// Delete folder
folderRoutes.openapi({ ...deleteProxyFolderRoute, middleware: requireScope('proxy:folders:manage') }, async (c) => {
  const folderService = container.resolve(FolderService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  await folderService.deleteFolder(id, user.id);
  return c.body(null, 204);
});

// Clone folder's proxy host
folderRoutes.openapi({ ...cloneProxyFolderRoute, middleware: requireScope('proxy:folders:manage') }, async (c) => {
  // Placeholder for future clone functionality
  return c.json({ error: 'Not implemented' }, 501);
});
