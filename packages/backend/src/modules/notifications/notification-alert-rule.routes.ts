import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import type { AppEnv } from '@/types.js';
import { authMiddleware, requireScope } from '@/modules/auth/auth.middleware.js';
import { ALERT_CATEGORIES } from './notification.constants.js';
import { NotificationAlertRuleService } from './notification-alert-rule.service.js';
import { NotificationEvaluatorService } from './notification-evaluator.service.js';
import { AlertRuleListQuerySchema, CreateAlertRuleSchema, UpdateAlertRuleSchema } from './notification-alert-rule.schemas.js';

export const alertRuleRoutes = new OpenAPIHono<AppEnv>();

alertRuleRoutes.use('*', authMiddleware);

function invalidateCache() {
  try { container.resolve(NotificationEvaluatorService).invalidateRuleCache(); } catch { /* not yet registered */ }
}

// GET /categories — list alert categories with their metrics, events, and variables
alertRuleRoutes.get('/categories', requireScope('notifications:view'), async (c) => {
  return c.json({ data: ALERT_CATEGORIES });
});

// GET / — list alert rules
alertRuleRoutes.get('/', requireScope('notifications:view'), async (c) => {
  const service = container.resolve(NotificationAlertRuleService);
  const query = AlertRuleListQuerySchema.parse(c.req.query());
  const result = await service.list(query);
  return c.json(result);
});

// GET /:id — get alert rule
alertRuleRoutes.get('/:id', requireScope('notifications:view'), async (c) => {
  const service = container.resolve(NotificationAlertRuleService);
  const rule = await service.getById(c.req.param('id'));
  return c.json({ data: rule });
});

// POST / — create alert rule
alertRuleRoutes.post('/', requireScope('notifications:manage'), async (c) => {
  const service = container.resolve(NotificationAlertRuleService);
  const body = CreateAlertRuleSchema.parse(await c.req.json());
  const user = c.get('user')!;
  const rule = await service.create(body, user.id);
  invalidateCache();
  return c.json({ data: rule }, 201);
});

// PUT /:id — update alert rule
alertRuleRoutes.put('/:id', requireScope('notifications:manage'), async (c) => {
  const service = container.resolve(NotificationAlertRuleService);
  const body = UpdateAlertRuleSchema.parse(await c.req.json());
  const user = c.get('user')!;
  const rule = await service.update(c.req.param('id'), body, user.id);
  invalidateCache();
  return c.json({ data: rule });
});

// DELETE /:id — delete alert rule
alertRuleRoutes.delete('/:id', requireScope('notifications:manage'), async (c) => {
  const service = container.resolve(NotificationAlertRuleService);
  const user = c.get('user')!;
  await service.delete(c.req.param('id'), user.id);
  invalidateCache();
  return c.body(null, 204);
});
