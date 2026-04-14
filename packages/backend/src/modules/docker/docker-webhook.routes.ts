import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { requireScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { WebhookTriggerSchema, WebhookUpsertSchema } from './docker-webhook.schemas.js';
import { DockerWebhookService } from './docker-webhook.service.js';

// ─── Config routes (mounted inside dockerRoutes, session-only) ──────

export function registerWebhookConfigRoutes(router: OpenAPIHono<AppEnv>) {
  // Get webhook config for a container
  router.get(
    '/nodes/:nodeId/containers/:containerName/webhook',
    requireScope('docker:containers:webhooks'),
    async (c) => {
      const service = container.resolve(DockerWebhookService);
      const nodeId = c.req.param('nodeId');
      const containerName = decodeURIComponent(c.req.param('containerName'));
      const data = await service.getByContainer(nodeId, containerName);
      return c.json({ data });
    }
  );

  // Create or update webhook config
  router.put(
    '/nodes/:nodeId/containers/:containerName/webhook',
    requireScope('docker:containers:webhooks'),
    async (c) => {
      const service = container.resolve(DockerWebhookService);
      const nodeId = c.req.param('nodeId');
      const containerName = decodeURIComponent(c.req.param('containerName'));
      const body = WebhookUpsertSchema.parse(await c.req.json());
      const user = c.get('user')!;
      const data = await service.upsert(nodeId, containerName, body, user.id);
      return c.json({ data });
    }
  );

  // Delete webhook config
  router.delete(
    '/nodes/:nodeId/containers/:containerName/webhook',
    requireScope('docker:containers:webhooks'),
    async (c) => {
      const service = container.resolve(DockerWebhookService);
      const nodeId = c.req.param('nodeId');
      const containerName = decodeURIComponent(c.req.param('containerName'));
      const user = c.get('user')!;
      await service.remove(nodeId, containerName, user.id);
      return c.json({ success: true });
    }
  );

  // Regenerate webhook token
  router.post(
    '/nodes/:nodeId/containers/:containerName/webhook/regenerate',
    requireScope('docker:containers:webhooks'),
    async (c) => {
      const service = container.resolve(DockerWebhookService);
      const nodeId = c.req.param('nodeId');
      const containerName = decodeURIComponent(c.req.param('containerName'));
      const user = c.get('user')!;
      const data = await service.regenerateToken(nodeId, containerName, user.id);
      return c.json({ data });
    }
  );
}

// ─── Trigger route (public — token IS the auth) ────────────────────

export const dockerWebhookTriggerRoutes = new OpenAPIHono<AppEnv>();

dockerWebhookTriggerRoutes.post('/:token', async (c) => {
  const service = container.resolve(DockerWebhookService);
  const token = c.req.param('token');

  // Look up webhook by token
  const webhook = await service.getByToken(token);
  if (!webhook?.enabled) {
    return c.json({ error: 'Invalid or disabled webhook' }, 404);
  }

  // Parse optional tag from body
  let tag: string | undefined;
  try {
    const body = await c.req.json();
    const parsed = WebhookTriggerSchema.parse(body);
    tag = parsed.tag;
  } catch {
    // Empty body or invalid JSON — that's fine, will re-pull current tag
  }

  // We need the container ID to trigger the update.
  // List containers on the node and find by name.
  const { DockerManagementService } = await import('./docker.service.js');
  const docker = container.resolve(DockerManagementService);
  const containers = await docker.listContainers(webhook.nodeId);
  const match = Array.isArray(containers)
    ? containers.find((ct: any) => {
        const name = ((ct.name ?? ct.Name ?? ct.Names?.[0]) as string)?.replace(/^\//, '');
        return name === webhook.containerName;
      })
    : null;

  if (!match) {
    return c.json({ error: `Container "${webhook.containerName}" not found on node` }, 404);
  }

  const containerId: string = match.id ?? match.Id;

  const result = await service.triggerUpdate({
    nodeId: webhook.nodeId,
    containerName: webhook.containerName,
    containerId,
    tag,
    webhookId: webhook.id,
  });

  return c.json({ data: result });
});
