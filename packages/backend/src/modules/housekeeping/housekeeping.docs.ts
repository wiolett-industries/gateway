import { z } from '@hono/zod-openapi';
import { appRoute, jsonBody, okJson, UnknownDataResponseSchema } from '@/lib/openapi.js';

export const HousekeepingConfigUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    cronExpression: z
      .string()
      .regex(/^[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+$/, 'Invalid cron expression')
      .optional(),
    nginxLogs: z
      .object({ enabled: z.boolean().optional(), retentionDays: z.number().int().min(1).max(365).optional() })
      .optional(),
    auditLog: z
      .object({ enabled: z.boolean().optional(), retentionDays: z.number().int().min(1).max(365).optional() })
      .optional(),
    dismissedAlerts: z
      .object({ enabled: z.boolean().optional(), retentionDays: z.number().int().min(1).max(365).optional() })
      .optional(),
    dockerPrune: z.object({ enabled: z.boolean().optional() }).optional(),
    orphanedCerts: z.object({ enabled: z.boolean().optional() }).optional(),
    acmeCleanup: z.object({ enabled: z.boolean().optional() }).optional(),
  })
  .strict();

export const getHousekeepingConfigRoute = appRoute({
  method: 'get',
  path: '/config',
  tags: ['Housekeeping'],
  summary: 'Get housekeeping config',
  responses: okJson(UnknownDataResponseSchema),
});

export const updateHousekeepingConfigRoute = appRoute({
  method: 'put',
  path: '/config',
  tags: ['Housekeeping'],
  summary: 'Update housekeeping config',
  request: jsonBody(HousekeepingConfigUpdateSchema),
  responses: okJson(UnknownDataResponseSchema),
});

export const housekeepingStatsRoute = appRoute({
  method: 'get',
  path: '/stats',
  tags: ['Housekeeping'],
  summary: 'Get housekeeping stats',
  responses: okJson(UnknownDataResponseSchema),
});

export const runHousekeepingRoute = appRoute({
  method: 'post',
  path: '/run',
  tags: ['Housekeeping'],
  summary: 'Run housekeeping now',
  responses: okJson(UnknownDataResponseSchema),
});

export const housekeepingHistoryRoute = appRoute({
  method: 'get',
  path: '/history',
  tags: ['Housekeeping'],
  summary: 'List housekeeping run history',
  responses: okJson(UnknownDataResponseSchema),
});
