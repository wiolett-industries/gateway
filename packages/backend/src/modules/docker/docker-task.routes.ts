import type { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { requireScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { DockerTaskService } from './docker-task.service.js';

export function registerTaskRoutes(router: OpenAPIHono<AppEnv>) {
  // ─── Task routes ──────────────────────────────────────────────────────

  // List tasks
  router.get('/tasks', requireScope('docker:tasks'), async (c) => {
    const service = container.resolve(DockerTaskService);
    const nodeId = c.req.query('nodeId');
    const status = c.req.query('status');
    const type = c.req.query('type');
    const data = await service.list({ nodeId, status, type });
    return c.json({ data });
  });

  // Get single task
  router.get('/tasks/:id', requireScope('docker:tasks'), async (c) => {
    const service = container.resolve(DockerTaskService);
    const id = c.req.param('id');
    const data = await service.get(id);
    return c.json({ data });
  });
}
