import { OpenAPIHono } from '@hono/zod-openapi';
import { openApiValidationHook } from '@/lib/openapi.js';
import { authMiddleware } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { registerContainerRoutes } from './docker-container.routes.js';
import { registerDockerDeploymentRoutes } from './docker-deployment.routes.js';
import { registerDockerFolderRoutes } from './docker-folder.routes.js';
import { registerDockerHealthCheckRoutes } from './docker-health-check.routes.js';
import { registerImageRoutes } from './docker-image.routes.js';
import { registerNetworkRoutes } from './docker-network.routes.js';
import { registerRegistryRoutes } from './docker-registry.routes.js';
import { registerTaskRoutes } from './docker-task.routes.js';
import { registerVolumeRoutes } from './docker-volume.routes.js';
import { registerWebhookConfigRoutes } from './docker-webhook.routes.js';

export const dockerRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

dockerRoutes.use('*', authMiddleware);

// Register all route groups
registerWebhookConfigRoutes(dockerRoutes);
registerDockerDeploymentRoutes(dockerRoutes);
registerDockerHealthCheckRoutes(dockerRoutes);
registerDockerFolderRoutes(dockerRoutes);
registerContainerRoutes(dockerRoutes);
registerImageRoutes(dockerRoutes);
registerVolumeRoutes(dockerRoutes);
registerNetworkRoutes(dockerRoutes);
registerRegistryRoutes(dockerRoutes);
registerTaskRoutes(dockerRoutes);
