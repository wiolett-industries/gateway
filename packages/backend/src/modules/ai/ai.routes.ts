import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { canUseAI } from '@/lib/permissions.js';
import { authMiddleware, requireScope, sessionOnly } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { aiStatusRoute, getAiConfigRoute, listAiToolsRoute, updateAiConfigRoute } from './ai.openapi.js';
import { AIConfigUpdateSchema, SaveAIConversationSchema, UpdateAIConversationSchema } from './ai.schemas.js';
import { AISettingsService } from './ai.settings.service.js';
import { AI_TOOLS } from './ai.tools.js';
import { AIConversationService } from './ai-conversation.service.js';

export const aiRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

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
  const config = await settingsService.updateConfig(body.data);
  return c.json({ data: config });
});

// GET /api/ai/tools — list all tool definitions grouped by category (admin only)
aiRoutes.openapi({ ...listAiToolsRoute, middleware: requireScope('feat:ai:configure') }, async (c) => {
  const grouped: Record<
    string,
    Array<{ name: string; description: string; destructive: boolean; requiredScope: string }>
  > = {};

  for (const tool of AI_TOOLS) {
    if (!grouped[tool.category]) grouped[tool.category] = [];
    grouped[tool.category].push({
      name: tool.name,
      description: tool.description,
      destructive: tool.destructive,
      requiredScope: tool.requiredScope,
    });
  }

  return c.json({ data: grouped });
});
