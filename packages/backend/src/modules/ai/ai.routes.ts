import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { authMiddleware, requireScope, sessionOnly } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { aiStatusRoute, getAiConfigRoute, listAiToolsRoute, updateAiConfigRoute } from './ai.openapi.js';
import { AIConfigUpdateSchema } from './ai.schemas.js';
import { AISettingsService } from './ai.settings.service.js';
import { AI_TOOLS } from './ai.tools.js';

export const aiRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

aiRoutes.use('*', authMiddleware);
aiRoutes.use('*', sessionOnly);

// GET /api/ai/status — check if AI features are enabled (any authenticated user)
aiRoutes.openapi(aiStatusRoute, async (c) => {
  const settingsService = container.resolve(AISettingsService);
  const enabled = await settingsService.isEnabled();
  return c.json({ enabled });
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
