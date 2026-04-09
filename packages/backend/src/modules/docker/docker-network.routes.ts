import type { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { requireScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { NetworkConnectSchema, NetworkCreateSchema } from './docker.schemas.js';
import { DockerManagementService } from './docker.service.js';

export function registerNetworkRoutes(router: OpenAPIHono<AppEnv>) {
  // ─── Network routes ──────────────────────────────────────────────────

  // List networks
  router.get('/nodes/:nodeId/networks', requireScope('docker:networks:list'), async (c) => {
    const service = container.resolve(DockerManagementService);
    const nodeId = c.req.param('nodeId');
    const data = await service.listNetworks(nodeId);
    return c.json({ data });
  });

  // Create network
  router.post('/nodes/:nodeId/networks', requireScope('docker:networks:create'), async (c) => {
    const service = container.resolve(DockerManagementService);
    const nodeId = c.req.param('nodeId');
    const user = c.get('user')!;
    const body = await c.req.json();
    const config = NetworkCreateSchema.parse(body);
    const data = await service.createNetwork(nodeId, config, user.id);
    return c.json({ data }, 201);
  });

  // Remove network
  router.delete('/nodes/:nodeId/networks/:networkId', requireScope('docker:networks:delete'), async (c) => {
    const service = container.resolve(DockerManagementService);
    const nodeId = c.req.param('nodeId');
    const networkId = c.req.param('networkId');
    const user = c.get('user')!;
    await service.removeNetwork(nodeId, networkId, user.id);
    return c.json({ success: true });
  });

  // Connect container to network
  router.post('/nodes/:nodeId/networks/:networkId/connect', requireScope('docker:networks:edit'), async (c) => {
    const service = container.resolve(DockerManagementService);
    const nodeId = c.req.param('nodeId');
    const networkId = c.req.param('networkId');
    const user = c.get('user')!;
    const body = await c.req.json();
    const { containerId } = NetworkConnectSchema.parse(body);
    await service.connectContainerToNetwork(nodeId, networkId, containerId, user.id);
    return c.json({ success: true });
  });

  // Disconnect container from network
  router.post('/nodes/:nodeId/networks/:networkId/disconnect', requireScope('docker:networks:edit'), async (c) => {
    const service = container.resolve(DockerManagementService);
    const nodeId = c.req.param('nodeId');
    const networkId = c.req.param('networkId');
    const user = c.get('user')!;
    const body = await c.req.json();
    const { containerId } = NetworkConnectSchema.parse(body);
    await service.disconnectContainerFromNetwork(nodeId, networkId, containerId, user.id);
    return c.json({ success: true });
  });
}
