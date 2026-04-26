import type { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { requireScopeForResource } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { DockerHealthCheckUpsertSchema } from './docker.schemas.js';
import { DockerHealthCheckService } from './docker-health-check.service.js';

export function registerDockerHealthCheckRoutes(router: OpenAPIHono<AppEnv>) {
  router.get(
    '/nodes/:nodeId/containers/:containerName/health-check',
    requireScopeForResource('docker:containers:view', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerHealthCheckService);
      const data = await service.getContainer(c.req.param('nodeId'), decodeURIComponent(c.req.param('containerName')));
      return c.json({ data });
    }
  );

  router.put(
    '/nodes/:nodeId/containers/:containerName/health-check',
    requireScopeForResource('docker:containers:edit', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerHealthCheckService);
      const data = await service.upsertContainer(
        c.req.param('nodeId'),
        decodeURIComponent(c.req.param('containerName')),
        DockerHealthCheckUpsertSchema.parse(await c.req.json())
      );
      return c.json({ data });
    }
  );

  router.post(
    '/nodes/:nodeId/containers/:containerName/health-check/test',
    requireScopeForResource('docker:containers:edit', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerHealthCheckService);
      const body = await c.req.json().catch(() => null);
      const data = await service.testContainer(
        c.req.param('nodeId'),
        decodeURIComponent(c.req.param('containerName')),
        body ? DockerHealthCheckUpsertSchema.parse(body) : undefined
      );
      return c.json({ data });
    }
  );

  router.get(
    '/nodes/:nodeId/deployments/:deploymentId/health-check',
    requireScopeForResource('docker:containers:view', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerHealthCheckService);
      const data = await service.getDeployment(c.req.param('nodeId'), c.req.param('deploymentId'));
      return c.json({ data });
    }
  );

  router.put(
    '/nodes/:nodeId/deployments/:deploymentId/health-check',
    requireScopeForResource('docker:containers:edit', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerHealthCheckService);
      const data = await service.upsertDeployment(
        c.req.param('nodeId'),
        c.req.param('deploymentId'),
        DockerHealthCheckUpsertSchema.parse(await c.req.json())
      );
      return c.json({ data });
    }
  );

  router.post(
    '/nodes/:nodeId/deployments/:deploymentId/health-check/test',
    requireScopeForResource('docker:containers:edit', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerHealthCheckService);
      const body = await c.req.json().catch(() => null);
      const data = await service.testDeployment(
        c.req.param('nodeId'),
        c.req.param('deploymentId'),
        body ? DockerHealthCheckUpsertSchema.parse(body) : undefined
      );
      return c.json({ data });
    }
  );
}
