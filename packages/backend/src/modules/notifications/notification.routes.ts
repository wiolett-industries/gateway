import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@/types.js';
import { alertRuleRoutes } from './notification-alert-rule.routes.js';
import { webhookRoutes } from './notification-webhook.routes.js';
import { deliveryRoutes } from './notification-delivery.routes.js';

export const notificationRoutes = new OpenAPIHono<AppEnv>();

notificationRoutes.route('/alert-rules', alertRuleRoutes);
notificationRoutes.route('/webhooks', webhookRoutes);
notificationRoutes.route('/deliveries', deliveryRoutes);
