import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { container } from '@/container.js';
import { authMiddleware, rbacMiddleware, sessionOnly } from '@/modules/auth/auth.middleware.js';
import { HousekeepingService } from '@/services/housekeeping.service.js';
import { SchedulerService } from '@/services/scheduler.service.js';
import type { AppEnv } from '@/types.js';

export const housekeepingRoutes = new OpenAPIHono<AppEnv>();

housekeepingRoutes.use('*', authMiddleware);
housekeepingRoutes.use('*', sessionOnly);
housekeepingRoutes.use('*', rbacMiddleware('admin'));

const ConfigUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    cronExpression: z
      .string()
      .regex(/^[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+$/, 'Invalid cron expression')
      .optional(),
    nginxLogs: z
      .object({
        enabled: z.boolean().optional(),
        retentionDays: z.number().int().min(1).max(365).optional(),
      })
      .optional(),
    auditLog: z
      .object({
        enabled: z.boolean().optional(),
        retentionDays: z.number().int().min(1).max(365).optional(),
      })
      .optional(),
    dismissedAlerts: z
      .object({
        enabled: z.boolean().optional(),
        retentionDays: z.number().int().min(1).max(365).optional(),
      })
      .optional(),
    dockerPrune: z.object({ enabled: z.boolean().optional() }).optional(),
    orphanedCerts: z.object({ enabled: z.boolean().optional() }).optional(),
    acmeCleanup: z.object({ enabled: z.boolean().optional() }).optional(),
  })
  .strict();

// GET /config
housekeepingRoutes.get('/config', async (c) => {
  const service = container.resolve(HousekeepingService);
  const config = await service.getConfig();
  return c.json({ data: config });
});

// PUT /config
housekeepingRoutes.put('/config', async (c) => {
  const body = await c.req.json();
  const validated = ConfigUpdateSchema.parse(body);
  const service = container.resolve(HousekeepingService);
  const config = await service.updateConfig(validated as Parameters<typeof service.updateConfig>[0]);

  // If cron changed, update the scheduler dynamically
  if (validated.cronExpression) {
    const scheduler = container.resolve(SchedulerService);
    scheduler.updateSchedule('housekeeping', validated.cronExpression);
  }

  return c.json({ data: config });
});

// GET /stats
housekeepingRoutes.get('/stats', async (c) => {
  const service = container.resolve(HousekeepingService);
  const stats = await service.getStats();
  return c.json({ data: stats });
});

// POST /run — manual trigger
housekeepingRoutes.post('/run', async (c) => {
  const user = c.get('user')!;
  const service = container.resolve(HousekeepingService);
  try {
    const result = await service.runAll('manual', user.id);
    return c.json({ data: result });
  } catch (err) {
    if (err instanceof Error && err.message.includes('already running')) {
      return c.json({ code: 'ALREADY_RUNNING', message: 'Housekeeping is already running' }, 409);
    }
    throw err;
  }
});

// GET /history
housekeepingRoutes.get('/history', async (c) => {
  const service = container.resolve(HousekeepingService);
  const history = await service.getRunHistory();
  return c.json({ data: history });
});
