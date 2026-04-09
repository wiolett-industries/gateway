import type { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { requireScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { TemplateCreateSchema, TemplateDeploySchema, TemplateUpdateSchema } from './docker.schemas.js';
import { DockerManagementService } from './docker.service.js';
import { DockerTemplateService } from './docker-template.service.js';

export function registerTemplateRoutes(router: OpenAPIHono<AppEnv>) {
  // ─── Template routes ──────────────────────────────────────────────────

  // List templates
  router.get('/templates', requireScope('docker:templates:list'), async (c) => {
    const service = container.resolve(DockerTemplateService);
    const data = await service.list();
    return c.json({ data });
  });

  // Create template
  router.post('/templates', requireScope('docker:templates:create'), async (c) => {
    const service = container.resolve(DockerTemplateService);
    const user = c.get('user')!;
    const body = await c.req.json();
    const input = TemplateCreateSchema.parse(body);
    const data = await service.create(input, user.id);
    return c.json({ data }, 201);
  });

  // Update template
  router.put('/templates/:id', requireScope('docker:templates:edit'), async (c) => {
    const service = container.resolve(DockerTemplateService);
    const id = c.req.param('id');
    const user = c.get('user')!;
    const body = await c.req.json();
    const input = TemplateUpdateSchema.parse(body);
    const data = await service.update(id, input, user.id);
    return c.json({ data });
  });

  // Delete template
  router.delete('/templates/:id', requireScope('docker:templates:delete'), async (c) => {
    const service = container.resolve(DockerTemplateService);
    const id = c.req.param('id');
    const user = c.get('user')!;
    await service.delete(id, user.id);
    return c.json({ success: true });
  });

  // Deploy from template
  router.post('/templates/:id/deploy', requireScope('docker:containers:create'), async (c) => {
    const templateService = container.resolve(DockerTemplateService);
    const dockerService = container.resolve(DockerManagementService);
    const id = c.req.param('id');
    const user = c.get('user')!;
    const body = await c.req.json();
    const { nodeId, overrides } = TemplateDeploySchema.parse(body);

    // Get the template config and merge with overrides
    const template = await templateService.get(id);
    const config = { ...(template.config as Record<string, unknown>), ...overrides };

    const data = await dockerService.createContainer(nodeId, config, user.id);
    return c.json({ data }, 201);
  });
}
