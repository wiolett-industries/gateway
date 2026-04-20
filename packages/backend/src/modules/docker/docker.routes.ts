import { OpenAPIHono } from '@hono/zod-openapi';
import { authMiddleware, sessionOnly } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { registerContainerRoutes } from './docker-container.routes.js';
import { registerImageRoutes } from './docker-image.routes.js';
import { registerNetworkRoutes } from './docker-network.routes.js';
import { registerRegistryRoutes } from './docker-registry.routes.js';
import { registerTaskRoutes } from './docker-task.routes.js';
import { registerVolumeRoutes } from './docker-volume.routes.js';
import { registerWebhookConfigRoutes } from './docker-webhook.routes.js';

export const dockerRoutes = new OpenAPIHono<AppEnv>();

dockerRoutes.use('*', authMiddleware);
dockerRoutes.use('*', sessionOnly);

// Register all route groups
registerWebhookConfigRoutes(dockerRoutes);
registerContainerRoutes(dockerRoutes);
registerImageRoutes(dockerRoutes);
registerVolumeRoutes(dockerRoutes);
registerNetworkRoutes(dockerRoutes);
registerRegistryRoutes(dockerRoutes);
registerTaskRoutes(dockerRoutes);
