import type { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { requireScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import {
  createRegistryRoute,
  deleteRegistryRoute,
  listRegistriesRoute,
  testRegistryDirectRoute,
  testRegistryRoute,
  updateRegistryRoute,
} from './docker.docs.js';
import { RegistryCreateSchema, RegistryUpdateSchema } from './docker.schemas.js';
import { DockerRegistryService } from './docker-registry.service.js';

export function registerRegistryRoutes(router: OpenAPIHono<AppEnv>) {
  // ─── Registry routes ──────────────────────────────────────────────────

  // List registries
  router.openapi({ ...listRegistriesRoute, middleware: requireScope('docker:registries:list') }, async (c) => {
    const service = container.resolve(DockerRegistryService);
    const nodeId = c.req.query('nodeId');
    const data = await service.list(nodeId);
    return c.json({ data });
  });

  // Create registry
  router.openapi({ ...createRegistryRoute, middleware: requireScope('docker:registries:create') }, async (c) => {
    const service = container.resolve(DockerRegistryService);
    const user = c.get('user')!;
    const body = await c.req.json();
    const input = RegistryCreateSchema.parse(body);
    const data = await service.create(input, user.id);
    return c.json({ data }, 201);
  });

  // Update registry
  router.openapi({ ...updateRegistryRoute, middleware: requireScope('docker:registries:edit') }, async (c) => {
    const service = container.resolve(DockerRegistryService);
    const id = c.req.param('id')!;
    const user = c.get('user')!;
    const body = await c.req.json();
    const input = RegistryUpdateSchema.parse(body);
    const data = await service.update(id, input, user.id);
    return c.json({ data });
  });

  // Delete registry
  router.openapi({ ...deleteRegistryRoute, middleware: requireScope('docker:registries:delete') }, async (c) => {
    const service = container.resolve(DockerRegistryService);
    const id = c.req.param('id')!;
    const user = c.get('user')!;
    await service.delete(id, user.id);
    return c.json({ success: true });
  });

  // Test registry connection (by credentials, before saving)
  router.openapi({ ...testRegistryDirectRoute, middleware: requireScope('docker:registries:edit') }, async (c) => {
    const service = container.resolve(DockerRegistryService);
    const body = await c.req.json();
    const data = await service.testConnectionDirect(body.url, body.username, body.password);
    return c.json({ data });
  });

  // Test registry connection (by ID)
  router.openapi({ ...testRegistryRoute, middleware: requireScope('docker:registries:edit') }, async (c) => {
    const service = container.resolve(DockerRegistryService);
    const id = c.req.param('id')!;
    const data = await service.testConnection(id);
    return c.json({ data });
  });
}
