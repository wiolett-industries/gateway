import type { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { requireScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { ImagePullSchema } from './docker.schemas.js';
import { DockerManagementService } from './docker.service.js';
import { DockerRegistryService } from './docker-registry.service.js';

export function registerImageRoutes(router: OpenAPIHono<AppEnv>) {
  // ─── Image routes ────────────────────────────────────────────────────

  // List images
  router.get('/nodes/:nodeId/images', requireScope('docker:images:list'), async (c) => {
    const service = container.resolve(DockerManagementService);
    const nodeId = c.req.param('nodeId');
    const data = await service.listImages(nodeId);
    return c.json({ data });
  });

  // Pull image
  router.post('/nodes/:nodeId/images/pull', requireScope('docker:images:pull'), async (c) => {
    const service = container.resolve(DockerManagementService);
    const registryService = container.resolve(DockerRegistryService);
    const nodeId = c.req.param('nodeId');
    const user = c.get('user')!;
    const body = await c.req.json();
    const { imageRef, registryId } = body;
    ImagePullSchema.parse({ imageRef });

    // Resolve registry credentials and prefix image ref if using private registry
    let finalImageRef = imageRef;
    let registryAuth: string | undefined;
    if (registryId) {
      const auth = await registryService.getAuthForPull(registryId);
      if (auth) {
        registryAuth = auth.authJson;
        // Prefix image ref with registry URL if not already prefixed
        if (!imageRef.includes('/') || !imageRef.split('/')[0].includes('.')) {
          finalImageRef = `${auth.url}/${imageRef}`;
        }
      }
    }

    const data = await service.pullImage(nodeId, finalImageRef, registryAuth, user.id);
    return c.json({ data });
  });

  // Pull image (synchronous — waits for completion, validates image exists)
  router.post('/nodes/:nodeId/images/pull-sync', requireScope('docker:images:pull'), async (c) => {
    const registryService = container.resolve(DockerRegistryService);
    const nodeId = c.req.param('nodeId');
    const body = await c.req.json();
    const { imageRef, registryId } = body;
    ImagePullSchema.parse({ imageRef });

    let finalImageRef = imageRef;
    let registryAuth: string | undefined;
    if (registryId) {
      const auth = await registryService.getAuthForPull(registryId);
      if (auth) {
        registryAuth = auth.authJson;
        if (!imageRef.includes('/') || !imageRef.split('/')[0].includes('.')) {
          finalImageRef = `${auth.url}/${imageRef}`;
        }
      }
    }

    const { NodeDispatchService } = await import('@/services/node-dispatch.service.js');
    const dispatch = container.resolve(NodeDispatchService);
    const result = await dispatch.sendDockerImageCommand(
      nodeId,
      'pull',
      { imageRef: finalImageRef, registryAuthJson: registryAuth },
      600000
    );
    if (!result.success) {
      return c.json({ error: result.error || `Failed to pull ${finalImageRef}` }, 400);
    }
    return c.json({ data: { success: true, imageRef: finalImageRef } });
  });

  // Remove image
  router.delete('/nodes/:nodeId/images/:imageId', requireScope('docker:images:delete'), async (c) => {
    const service = container.resolve(DockerManagementService);
    const nodeId = c.req.param('nodeId');
    const imageId = c.req.param('imageId');
    const user = c.get('user')!;
    const force = c.req.query('force') === 'true';
    await service.removeImage(nodeId, imageId, force, user.id);
    return c.json({ success: true });
  });

  // Prune images
  router.post('/nodes/:nodeId/images/prune', requireScope('docker:images:delete'), async (c) => {
    const service = container.resolve(DockerManagementService);
    const nodeId = c.req.param('nodeId');
    const user = c.get('user')!;
    const data = await service.pruneImages(nodeId, user.id);
    return c.json({ data });
  });
}
