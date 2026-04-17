import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { authMiddleware, requireAnyScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { NotificationDispatcherService } from './notification-dispatcher.service.js';
import { buildSampleEvent, buildTemplateContext, renderTemplate, TEMPLATE_PRESETS } from './notification-templates.js';
import { CreateWebhookSchema, UpdateWebhookSchema, WebhookListQuerySchema } from './notification-webhook.schemas.js';
import { NotificationWebhookService } from './notification-webhook.service.js';

export const webhookRoutes = new OpenAPIHono<AppEnv>();

webhookRoutes.use('*', authMiddleware);

// GET /presets — list template presets
webhookRoutes.get(
  '/presets',
  requireAnyScope(
    'notifications:webhooks:list',
    'notifications:webhooks:view',
    'notifications:webhooks:create',
    'notifications:webhooks:edit',
    'notifications:webhooks:delete',
    'notifications:view',
    'notifications:manage'
  ),
  async (c) => {
    return c.json({ data: TEMPLATE_PRESETS });
  }
);

// GET / — list webhooks
webhookRoutes.get(
  '/',
  requireAnyScope(
    'notifications:webhooks:list',
    'notifications:webhooks:view',
    'notifications:webhooks:create',
    'notifications:webhooks:edit',
    'notifications:webhooks:delete',
    'notifications:view',
    'notifications:manage'
  ),
  async (c) => {
    const service = container.resolve(NotificationWebhookService);
    const query = WebhookListQuerySchema.parse(c.req.query());
    const result = await service.list(query);
    return c.json(result);
  }
);

// GET /:id — get webhook
webhookRoutes.get(
  '/:id',
  requireAnyScope(
    'notifications:webhooks:view',
    'notifications:webhooks:list',
    'notifications:webhooks:create',
    'notifications:webhooks:edit',
    'notifications:webhooks:delete',
    'notifications:view',
    'notifications:manage'
  ),
  async (c) => {
    const service = container.resolve(NotificationWebhookService);
    const webhook = await service.getById(c.req.param('id'));
    return c.json({ data: webhook });
  }
);

// POST /preview — render a template with sample data (must be before /:id routes)
webhookRoutes.post(
  '/preview',
  requireAnyScope('notifications:webhooks:create', 'notifications:webhooks:edit', 'notifications:manage'),
  async (c) => {
    const { bodyTemplate } = await c.req.json();
    if (typeof bodyTemplate !== 'string') {
      return c.json({ error: 'bodyTemplate is required' }, 400);
    }
    const sampleEvent = buildSampleEvent();
    const context = buildTemplateContext(sampleEvent);
    const rendered = renderTemplate(bodyTemplate, context);
    return c.json({ data: { rendered, context } });
  }
);

// POST / — create webhook
webhookRoutes.post('/', requireAnyScope('notifications:webhooks:create', 'notifications:manage'), async (c) => {
  const service = container.resolve(NotificationWebhookService);
  const body = CreateWebhookSchema.parse(await c.req.json());
  const user = c.get('user')!;
  const webhook = await service.create(body, user.id);
  return c.json({ data: webhook }, 201);
});

// PUT /:id — update webhook
webhookRoutes.put('/:id', requireAnyScope('notifications:webhooks:edit', 'notifications:manage'), async (c) => {
  const service = container.resolve(NotificationWebhookService);
  const body = UpdateWebhookSchema.parse(await c.req.json());
  const user = c.get('user')!;
  const webhook = await service.update(c.req.param('id'), body, user.id);
  return c.json({ data: webhook });
});

// DELETE /:id — delete webhook
webhookRoutes.delete('/:id', requireAnyScope('notifications:webhooks:delete', 'notifications:manage'), async (c) => {
  const service = container.resolve(NotificationWebhookService);
  const user = c.get('user')!;
  await service.delete(c.req.param('id'), user.id);
  return c.body(null, 204);
});

// POST /:id/test — send test delivery
webhookRoutes.post('/:id/test', requireAnyScope('notifications:webhooks:edit', 'notifications:manage'), async (c) => {
  const dispatcher = container.resolve(NotificationDispatcherService);
  const webhookService = container.resolve(NotificationWebhookService);
  const webhook = await webhookService.getRaw(c.req.param('id'));
  const sampleEvent = buildSampleEvent();
  const result = await dispatcher.dispatch(webhook, sampleEvent, true);
  return c.json({ data: result });
});
