import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { MiddlewareHandler } from 'hono';
import { container } from '@/container.js';
import { authMiddleware, rbacMiddleware } from '@/modules/auth/auth.middleware.js';
import { AISettingsService } from './ai.settings.service.js';
import { AIConfigUpdateSchema } from './ai.schemas.js';
import { AI_TOOLS } from './ai.tools.js';
import type { AppEnv } from '@/types.js';

/** Block API tokens from accessing AI endpoints — session auth only. */
const sessionOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer gw_')) {
    throw new HTTPException(403, { message: 'AI endpoints require session authentication. API tokens are not allowed.' });
  }
  await next();
};

export const aiRoutes = new Hono<AppEnv>();

aiRoutes.use('*', authMiddleware);
aiRoutes.use('*', sessionOnly);

// GET /api/ai/status — check if AI features are enabled (any authenticated user)
aiRoutes.get('/status', async (c) => {
  const settingsService = container.resolve(AISettingsService);
  const enabled = await settingsService.isEnabled();
  return c.json({ enabled });
});

// GET /api/ai/config — full config for admin display (admin only)
aiRoutes.get('/config', rbacMiddleware('admin'), async (c) => {
  const settingsService = container.resolve(AISettingsService);
  const config = await settingsService.getConfigForAdmin();
  return c.json({ data: config });
});

// PUT /api/ai/config — update config (admin only)
aiRoutes.put('/config', rbacMiddleware('admin'), async (c) => {
  const body = AIConfigUpdateSchema.safeParse(await c.req.json());
  if (!body.success) {
    return c.json({ code: 'VALIDATION_ERROR', message: body.error.message }, 400);
  }

  const settingsService = container.resolve(AISettingsService);
  const config = await settingsService.updateConfig(body.data);
  return c.json({ data: config });
});

// GET /api/ai/tools — list all tool definitions grouped by category (admin only)
aiRoutes.get('/tools', rbacMiddleware('admin'), async (c) => {
  const grouped: Record<string, Array<{ name: string; description: string; destructive: boolean; requiredRole: string }>> = {};

  for (const tool of AI_TOOLS) {
    if (!grouped[tool.category]) grouped[tool.category] = [];
    grouped[tool.category].push({
      name: tool.name,
      description: tool.description,
      destructive: tool.destructive,
      requiredRole: tool.requiredRole,
    });
  }

  return c.json({ data: grouped });
});
