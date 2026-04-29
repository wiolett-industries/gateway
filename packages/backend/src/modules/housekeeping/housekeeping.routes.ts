import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { authMiddleware, requireScope, sessionOnly } from '@/modules/auth/auth.middleware.js';
import { HousekeepingService } from '@/services/housekeeping.service.js';
import { SchedulerService } from '@/services/scheduler.service.js';
import type { AppEnv } from '@/types.js';
import {
  getHousekeepingConfigRoute,
  HousekeepingConfigUpdateSchema,
  housekeepingHistoryRoute,
  housekeepingStatsRoute,
  runHousekeepingRoute,
  updateHousekeepingConfigRoute,
} from './housekeeping.docs.js';

export const housekeepingRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

housekeepingRoutes.use('*', authMiddleware);
housekeepingRoutes.use('*', sessionOnly);

// GET /config
housekeepingRoutes.openapi(
  { ...getHousekeepingConfigRoute, middleware: requireScope('housekeeping:view') },
  async (c) => {
    const service = container.resolve(HousekeepingService);
    const config = await service.getConfig();
    return c.json({ data: config });
  }
);

// PUT /config
housekeepingRoutes.openapi(
  { ...updateHousekeepingConfigRoute, middleware: requireScope('housekeeping:configure') },
  async (c) => {
    const body = await c.req.json();
    const validated = HousekeepingConfigUpdateSchema.parse(body);
    const service = container.resolve(HousekeepingService);
    const config = await service.updateConfig(validated as Parameters<typeof service.updateConfig>[0]);

    // If cron changed, update the scheduler dynamically
    if (validated.cronExpression) {
      const scheduler = container.resolve(SchedulerService);
      scheduler.updateSchedule('housekeeping', validated.cronExpression);
    }

    return c.json({ data: config });
  }
);

// GET /stats
housekeepingRoutes.openapi({ ...housekeepingStatsRoute, middleware: requireScope('housekeeping:view') }, async (c) => {
  const service = container.resolve(HousekeepingService);
  const stats = await service.getStats();
  return c.json({ data: stats });
});

// POST /run — manual trigger
housekeepingRoutes.openapi({ ...runHousekeepingRoute, middleware: requireScope('housekeeping:run') }, async (c) => {
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
housekeepingRoutes.openapi(
  { ...housekeepingHistoryRoute, middleware: requireScope('housekeeping:view') },
  async (c) => {
    const service = container.resolve(HousekeepingService);
    const history = await service.getRunHistory();
    return c.json({ data: history });
  }
);
