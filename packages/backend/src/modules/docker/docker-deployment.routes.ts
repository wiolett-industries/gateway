import type { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { requireScopeForResource } from '@/modules/auth/auth.middleware.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import type { AppEnv } from '@/types.js';
import {
  DockerDeploymentCreateSchema,
  DockerDeploymentDeploySchema,
  DockerDeploymentSwitchSchema,
  DockerDeploymentUpdateSchema,
} from './docker-deployment.schemas.js';
import { DockerDeploymentService } from './docker-deployment.service.js';
import { DockerSecretService } from './docker-secret.service.js';
import { SecretCreateSchema, SecretUpdateSchema } from './docker.schemas.js';
import { WebhookUpsertSchema } from './docker-webhook.schemas.js';

function deploymentSecretContainerName(deploymentId: string) {
  return `deployment:${deploymentId}`;
}

export function registerDockerDeploymentRoutes(router: OpenAPIHono<AppEnv>) {
  router.get('/nodes/:nodeId/deployments', requireScopeForResource('docker:containers:list', 'nodeId'), async (c) => {
    const service = container.resolve(DockerDeploymentService);
    const data = await service.list(c.req.param('nodeId'));
    return c.json({ data });
  });

  router.post(
    '/nodes/:nodeId/deployments',
    requireScopeForResource('docker:containers:create', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.create(
        c.req.param('nodeId'),
        DockerDeploymentCreateSchema.parse(await c.req.json()),
        user.id
      );
      return c.json({ data }, 201);
    }
  );

  router.get(
    '/nodes/:nodeId/deployments/:deploymentId',
    requireScopeForResource('docker:containers:view', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const data = await service.get(c.req.param('nodeId'), c.req.param('deploymentId'));
      return c.json({ data });
    }
  );

  router.put(
    '/nodes/:nodeId/deployments/:deploymentId',
    requireScopeForResource('docker:containers:edit', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.update(
        c.req.param('nodeId'),
        c.req.param('deploymentId'),
        DockerDeploymentUpdateSchema.parse(await c.req.json()),
        user.id
      );
      return c.json({ data });
    }
  );

  router.delete(
    '/nodes/:nodeId/deployments/:deploymentId',
    requireScopeForResource('docker:containers:delete', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      await service.remove(c.req.param('nodeId'), c.req.param('deploymentId'), user.id);
      return c.json({ success: true });
    }
  );

  router.post(
    '/nodes/:nodeId/deployments/:deploymentId/start',
    requireScopeForResource('docker:containers:manage', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.start(c.req.param('nodeId'), c.req.param('deploymentId'), user.id);
      return c.json({ data });
    }
  );

  router.post(
    '/nodes/:nodeId/deployments/:deploymentId/stop',
    requireScopeForResource('docker:containers:manage', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.stop(c.req.param('nodeId'), c.req.param('deploymentId'), user.id);
      return c.json({ data });
    }
  );

  router.post(
    '/nodes/:nodeId/deployments/:deploymentId/restart',
    requireScopeForResource('docker:containers:manage', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.restart(c.req.param('nodeId'), c.req.param('deploymentId'), user.id);
      return c.json({ data });
    }
  );

  router.post(
    '/nodes/:nodeId/deployments/:deploymentId/kill',
    requireScopeForResource('docker:containers:manage', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.kill(c.req.param('nodeId'), c.req.param('deploymentId'), user.id);
      return c.json({ data });
    }
  );

  router.post(
    '/nodes/:nodeId/deployments/:deploymentId/deploy',
    requireScopeForResource('docker:containers:manage', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.deploy(
        c.req.param('nodeId'),
        c.req.param('deploymentId'),
        DockerDeploymentDeploySchema.parse(await c.req.json().catch(() => ({}))),
        user.id
      );
      return c.json({ data });
    }
  );

  router.post(
    '/nodes/:nodeId/deployments/:deploymentId/switch',
    requireScopeForResource('docker:containers:manage', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.switchToSlot(
        c.req.param('nodeId'),
        c.req.param('deploymentId'),
        DockerDeploymentSwitchSchema.parse(await c.req.json()),
        user.id
      );
      return c.json({ data });
    }
  );

  router.post(
    '/nodes/:nodeId/deployments/:deploymentId/rollback',
    requireScopeForResource('docker:containers:manage', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const body = await c.req.json().catch(() => ({}));
      const data = await service.rollback(
        c.req.param('nodeId'),
        c.req.param('deploymentId'),
        body.force === true,
        user.id
      );
      return c.json({ data });
    }
  );

  router.post(
    '/nodes/:nodeId/deployments/:deploymentId/slots/:slot/stop',
    requireScopeForResource('docker:containers:manage', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const slot = DockerDeploymentSwitchSchema.shape.slot.parse(c.req.param('slot'));
      await service.stopSlot(c.req.param('nodeId'), c.req.param('deploymentId'), slot, user.id);
      return c.json({ success: true });
    }
  );

  router.get(
    '/nodes/:nodeId/deployments/:deploymentId/secrets',
    requireScopeForResource('docker:containers:secrets', 'nodeId'),
    async (c) => {
      const deploymentService = container.resolve(DockerDeploymentService);
      const secretService = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId');
      const deploymentId = c.req.param('deploymentId');
      await deploymentService.get(nodeId, deploymentId);
      const scopes = c.get('effectiveScopes') || [];
      const canReveal = TokensService.hasScope(scopes, `docker:containers:secrets:${nodeId}`);
      const data = await secretService.list(nodeId, deploymentSecretContainerName(deploymentId), canReveal);
      return c.json({ data });
    }
  );

  router.post(
    '/nodes/:nodeId/deployments/:deploymentId/secrets',
    requireScopeForResource('docker:containers:secrets', 'nodeId'),
    async (c) => {
      const deploymentService = container.resolve(DockerDeploymentService);
      const secretService = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId');
      const deploymentId = c.req.param('deploymentId');
      await deploymentService.get(nodeId, deploymentId);
      const user = c.get('user')!;
      const { key, value } = SecretCreateSchema.parse(await c.req.json());
      const data = await secretService.create(nodeId, deploymentSecretContainerName(deploymentId), key, value, user.id);
      return c.json({ data }, 201);
    }
  );

  router.put(
    '/nodes/:nodeId/deployments/:deploymentId/secrets/:secretId',
    requireScopeForResource('docker:containers:secrets', 'nodeId'),
    async (c) => {
      const deploymentService = container.resolve(DockerDeploymentService);
      const secretService = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId');
      const deploymentId = c.req.param('deploymentId');
      await deploymentService.get(nodeId, deploymentId);
      const user = c.get('user')!;
      const { value } = SecretUpdateSchema.parse(await c.req.json());
      const data = await secretService.update(
        c.req.param('secretId'),
        nodeId,
        value,
        user.id,
        deploymentSecretContainerName(deploymentId)
      );
      return c.json({ data });
    }
  );

  router.delete(
    '/nodes/:nodeId/deployments/:deploymentId/secrets/:secretId',
    requireScopeForResource('docker:containers:secrets', 'nodeId'),
    async (c) => {
      const deploymentService = container.resolve(DockerDeploymentService);
      const secretService = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId');
      const deploymentId = c.req.param('deploymentId');
      await deploymentService.get(nodeId, deploymentId);
      const user = c.get('user')!;
      await secretService.delete(c.req.param('secretId'), nodeId, user.id, deploymentSecretContainerName(deploymentId));
      return c.json({ success: true });
    }
  );

  router.get(
    '/nodes/:nodeId/deployments/:deploymentId/webhook',
    requireScopeForResource('docker:containers:webhooks', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const data = await service.getWebhook(c.req.param('nodeId'), c.req.param('deploymentId'));
      return c.json({ data });
    }
  );

  router.put(
    '/nodes/:nodeId/deployments/:deploymentId/webhook',
    requireScopeForResource('docker:containers:webhooks', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.upsertWebhook(
        c.req.param('nodeId'),
        c.req.param('deploymentId'),
        WebhookUpsertSchema.parse(await c.req.json()),
        user.id
      );
      return c.json({ data });
    }
  );

  router.delete(
    '/nodes/:nodeId/deployments/:deploymentId/webhook',
    requireScopeForResource('docker:containers:webhooks', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      await service.deleteWebhook(c.req.param('nodeId'), c.req.param('deploymentId'), user.id);
      return c.json({ success: true });
    }
  );

  router.post(
    '/nodes/:nodeId/deployments/:deploymentId/webhook/regenerate',
    requireScopeForResource('docker:containers:webhooks', 'nodeId'),
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.regenerateWebhook(c.req.param('nodeId'), c.req.param('deploymentId'), user.id);
      return c.json({ data });
    }
  );
}
