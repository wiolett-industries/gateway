import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { canUseAI } from '@/lib/permissions.js';
import { authMiddleware, requireScope, sessionOnly } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { aiStatusRoute, getAiConfigRoute, listAiToolsRoute, updateAiConfigRoute } from './ai.openapi.js';
import { AISandboxService } from './ai.sandbox.service.js';
import { AISandboxArtifactService } from './ai.sandbox-artifact.service.js';
import { AIConfigUpdateSchema, SaveAIConversationSchema, UpdateAIConversationSchema } from './ai.schemas.js';
import { AISettingsService } from './ai.settings.service.js';
import { AI_TOOLS } from './ai.tools.js';
import { AIConversationService } from './ai-conversation.service.js';

export const aiRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

function humanizeToolName(name: string): string {
  const acronyms = new Set(['ai', 'api', 'ca', 'crl', 'dns', 'http', 'https', 'id', 'ip', 'pki', 'ssl', 'url']);
  return name
    .split('_')
    .map((part) => (acronyms.has(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

function toolSubject(name: string): string {
  return humanizeToolName(
    name.replace(
      /^(list|get|create|update|delete|remove|manage|query|run|scan|reveal|test|pull|start|stop|restart|inspect)_/,
      ''
    )
  ).toLowerCase();
}

function userFacingToolDescription(name: string, category: string, destructive: boolean): string {
  if (name === 'discover_tools') return 'Find available Gateway tool groups and capabilities.';
  if (name === 'get_current_context') return 'Read the page and resource currently open in the UI.';
  if (name === 'find_resource') return 'Search Gateway resources by name, type, or identifier.';
  if (name === 'internal_documentation') return 'Search the assistant documentation for Gateway operations.';
  if (name === 'wait') return 'Pause briefly before checking an operation again.';
  if (name === 'web_search') return 'Search the web when current external information is needed.';

  const subject = toolSubject(name);
  if (name.startsWith('list_')) return `View ${subject} records.`;
  if (name.startsWith('get_') || name.startsWith('inspect_')) return `View details for ${subject}.`;
  if (name.startsWith('create_')) return `Create ${subject}.`;
  if (name.startsWith('update_') || name.startsWith('manage_')) return `Change ${subject}.`;
  if (name.startsWith('delete_') || name.startsWith('remove_')) return `Delete ${subject}.`;
  if (name.startsWith('query_') || name.startsWith('run_') || name.startsWith('scan_')) return `Run ${subject}.`;
  if (name.startsWith('pull_')) return `Pull ${subject}.`;
  if (name.startsWith('start_')) return `Start ${subject}.`;
  if (name.startsWith('stop_')) return `Stop ${subject}.`;
  if (name.startsWith('restart_')) return `Restart ${subject}.`;
  if (name.startsWith('reveal_')) return `Reveal ${subject}.`;
  if (name.startsWith('test_')) return `Test ${subject}.`;

  return `${destructive ? 'Change' : 'Use'} ${category.toLowerCase()} capabilities.`;
}

aiRoutes.use('*', authMiddleware);
aiRoutes.use('*', sessionOnly);

// GET /api/ai/status — check if AI features are enabled (any authenticated user)
aiRoutes.openapi(aiStatusRoute, async (c) => {
  const settingsService = container.resolve(AISettingsService);
  const enabled = await settingsService.isEnabled();
  return c.json({ enabled });
});

aiRoutes.get('/conversations', requireScope('feat:ai:use'), async (c) => {
  const service = container.resolve(AIConversationService);
  const user = c.get('user')!;
  const data = await service.listConversations(user.id);
  return c.json({ data });
});

aiRoutes.get('/conversations/:id', requireScope('feat:ai:use'), async (c) => {
  const service = container.resolve(AIConversationService);
  const user = c.get('user')!;
  const data = await service.getConversation(user.id, c.req.param('id'));
  if (!data) return c.json({ code: 'NOT_FOUND', message: 'Conversation not found' }, 404);
  return c.json({ data });
});

aiRoutes.post('/conversations', requireScope('feat:ai:use'), async (c) => {
  const user = c.get('user')!;
  if (!canUseAI(user.scopes)) return c.json({ code: 'AI_NOT_ALLOWED', message: 'AI assistant is not allowed' }, 403);

  const body = SaveAIConversationSchema.safeParse(await c.req.json());
  if (!body.success) {
    return c.json({ code: 'VALIDATION_ERROR', message: body.error.message }, 400);
  }

  const service = container.resolve(AIConversationService);
  const data = await service.saveConversation(user.id, body.data);
  return c.json({ data });
});

aiRoutes.put('/conversations/:id', requireScope('feat:ai:use'), async (c) => {
  const body = UpdateAIConversationSchema.safeParse(await c.req.json());
  if (!body.success) {
    return c.json({ code: 'VALIDATION_ERROR', message: body.error.message }, 400);
  }

  const service = container.resolve(AIConversationService);
  const user = c.get('user')!;
  const data = await service.updateConversation(user.id, c.req.param('id'), body.data);
  if (!data) return c.json({ code: 'NOT_FOUND', message: 'Conversation not found' }, 404);
  return c.json({ data });
});

aiRoutes.delete('/conversations/:id', requireScope('feat:ai:use'), async (c) => {
  const service = container.resolve(AIConversationService);
  const user = c.get('user')!;
  const deleted = await service.deleteConversation(user.id, c.req.param('id'));
  if (!deleted) return c.json({ code: 'NOT_FOUND', message: 'Conversation not found' }, 404);
  return c.json({ data: { deleted: true } });
});

aiRoutes.delete('/conversations/by-title/:title', requireScope('feat:ai:use'), async (c) => {
  const service = container.resolve(AIConversationService);
  const user = c.get('user')!;
  const deleted = await service.deleteConversationByTitle(user.id, decodeURIComponent(c.req.param('title')));
  return c.json({ data: { deleted } });
});

// GET /api/ai/config — full config for admin display (admin only)
aiRoutes.openapi({ ...getAiConfigRoute, middleware: requireScope('feat:ai:configure') }, async (c) => {
  const settingsService = container.resolve(AISettingsService);
  const config = await settingsService.getConfigForAdmin();
  return c.json({ data: config });
});

// PUT /api/ai/config — update config (admin only)
aiRoutes.openapi({ ...updateAiConfigRoute, middleware: requireScope('feat:ai:configure') }, async (c) => {
  const body = AIConfigUpdateSchema.safeParse(await c.req.json());
  if (!body.success) {
    return c.json({ code: 'VALIDATION_ERROR', message: body.error.message }, 400);
  }

  const settingsService = container.resolve(AISettingsService);
  await settingsService.updateConfig(body.data);
  const config = await settingsService.getConfigForAdmin();
  return c.json({ data: config });
});

// GET /api/ai/tools — list all tool definitions grouped by category (admin only)
aiRoutes.openapi({ ...listAiToolsRoute, middleware: requireScope('feat:ai:configure') }, async (c) => {
  const grouped: Record<
    string,
    Array<{
      name: string;
      displayName: string;
      displayDescription: string;
      destructive: boolean;
      requiredScope: string;
    }>
  > = {};

  for (const tool of AI_TOOLS) {
    if (!grouped[tool.category]) grouped[tool.category] = [];
    grouped[tool.category].push({
      name: tool.name,
      displayName: humanizeToolName(tool.name),
      displayDescription: userFacingToolDescription(tool.name, tool.category, tool.destructive),
      destructive: tool.destructive,
      requiredScope: tool.requiredScope,
    });
  }

  return c.json({ data: grouped });
});

aiRoutes.get('/sandbox/status', requireScope('ai:sandbox:use'), async (c) => {
  const service = container.resolve(AISandboxService);
  const status = service.status();
  return c.json({ data: { ...status, state: status.status } });
});

aiRoutes.get('/sandbox/jobs', requireScope('ai:sandbox:use'), async (c) => {
  const service = container.resolve(AISandboxService);
  const user = c.get('user')!;
  const activeOnly = c.req.query('activeOnly') === 'true';
  const statusRaw = c.req.query('status');
  const status =
    statusRaw &&
    ['queued', 'running', 'exited', 'killed', 'timeout', 'failed', 'revoked', 'expired'].includes(statusRaw)
      ? statusRaw
      : undefined;
  const limitRaw = Number(c.req.query('limit') ?? 50);
  const data = await service.listJobs(user, {
    activeOnly,
    status,
    limit: Number.isFinite(limitRaw) ? limitRaw : 50,
  });
  return c.json({ data });
});

aiRoutes.post('/sandbox/jobs/:id/kill', requireScope('ai:sandbox:use'), async (c) => {
  const service = container.resolve(AISandboxService);
  const user = c.get('user')!;
  const data = await service.killProcess(user, c.req.param('id'));
  return c.json({ data });
});

aiRoutes.get('/sandbox/jobs/:id/output', requireScope('ai:sandbox:use'), async (c) => {
  const service = container.resolve(AISandboxService);
  const user = c.get('user')!;
  const tailRaw = Number(c.req.query('tail') ?? 200);
  const data = await service.readProcessOutput(user, c.req.param('id'), Number.isFinite(tailRaw) ? tailRaw : 200);
  return c.json({ data });
});

aiRoutes.get('/sandbox/artifacts/:id/download', requireScope('ai:sandbox:use'), async (c) => {
  const service = container.resolve(AISandboxArtifactService);
  const user = c.get('user')!;
  const artifact = await service.getDownload(user.id, c.req.param('id'));
  c.header('Content-Type', artifact.metadata.mediaType);
  c.header('Content-Length', String(artifact.metadata.sizeBytes));
  c.header('Content-Disposition', `attachment; filename="${contentDispositionFilename(artifact.metadata.filename)}"`);
  return c.body(Readable.toWeb(createReadStream(artifact.filePath)) as ReadableStream);
});

function contentDispositionFilename(filename: string): string {
  return filename.replace(/["\r\n\\]/g, '_');
}
