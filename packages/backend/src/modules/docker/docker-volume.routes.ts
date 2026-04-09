import type { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { requireScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { VolumeCreateSchema } from './docker.schemas.js';
import { DockerManagementService } from './docker.service.js';

export function registerVolumeRoutes(router: OpenAPIHono<AppEnv>) {
  // ─── Volume routes ───────────────────────────────────────────────────

  // List volumes
  router.get('/nodes/:nodeId/volumes', requireScope('docker:volumes:list'), async (c) => {
    const service = container.resolve(DockerManagementService);
    const nodeId = c.req.param('nodeId');
    const data = await service.listVolumes(nodeId);
    return c.json({ data });
  });

  // Create volume
  router.post('/nodes/:nodeId/volumes', requireScope('docker:volumes:create'), async (c) => {
    const service = container.resolve(DockerManagementService);
    const nodeId = c.req.param('nodeId');
    const user = c.get('user')!;
    const body = await c.req.json();
    const config = VolumeCreateSchema.parse(body);
    const data = await service.createVolume(nodeId, config, user.id);
    return c.json({ data }, 201);
  });

  // Remove volume
  router.delete('/nodes/:nodeId/volumes/:name', requireScope('docker:volumes:delete'), async (c) => {
    const service = container.resolve(DockerManagementService);
    const nodeId = c.req.param('nodeId');
    const name = c.req.param('name');
    const user = c.get('user')!;
    const force = c.req.query('force') === 'true';
    await service.removeVolume(nodeId, name, force, user.id);
    return c.json({ success: true });
  });
}
