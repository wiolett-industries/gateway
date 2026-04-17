import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { container } from '@/container.js';
import { authMiddleware, requireAnyScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';

const DeliveryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  webhookId: z.string().uuid().optional(),
  status: z.enum(['success', 'failed', 'retrying']).optional(),
  eventType: z.string().optional(),
});

export const deliveryRoutes = new OpenAPIHono<AppEnv>();

deliveryRoutes.use('*', authMiddleware);

// GET / — list deliveries
deliveryRoutes.get(
  '/',
  requireAnyScope(
    'notifications:deliveries:list',
    'notifications:deliveries:view',
    'notifications:view',
    'notifications:manage'
  ),
  async (c) => {
    const service = container.resolve(NotificationDeliveryService);
    const query = DeliveryListQuerySchema.parse(c.req.query());
    const result = await service.list(query);
    return c.json(result);
  }
);

// GET /stats — delivery stats
deliveryRoutes.get(
  '/stats',
  requireAnyScope(
    'notifications:deliveries:list',
    'notifications:deliveries:view',
    'notifications:view',
    'notifications:manage'
  ),
  async (c) => {
    const service = container.resolve(NotificationDeliveryService);
    const webhookId = c.req.query('webhookId');
    const stats = await service.getStats(webhookId);
    return c.json({ data: stats });
  }
);

// GET /:id — get delivery detail
deliveryRoutes.get(
  '/:id',
  requireAnyScope(
    'notifications:deliveries:view',
    'notifications:deliveries:list',
    'notifications:view',
    'notifications:manage'
  ),
  async (c) => {
    const service = container.resolve(NotificationDeliveryService);
    const delivery = await service.getById(c.req.param('id'));
    if (!delivery) return c.json({ error: 'Not found' }, 404);
    return c.json({ data: delivery });
  }
);
