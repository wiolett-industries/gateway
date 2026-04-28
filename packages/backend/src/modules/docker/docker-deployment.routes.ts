import type { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { requireScopeForResource } from '@/modules/auth/auth.middleware.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import type { AppEnv } from '@/types.js';
import {
  createDeploymentRoute,
  createDeploymentSecretRoute,
  deleteDeploymentRoute,
  deleteDeploymentSecretRoute,
  deleteDeploymentWebhookRoute,
  deployDeploymentRoute,
  deploymentActionRoute,
  deploymentWebhookRoute,
  getDeploymentRoute,
  listDeploymentSecretsRoute,
  listDeploymentsRoute,
  regenerateDeploymentWebhookRoute,
  rollbackDeploymentRoute,
  stopDeploymentSlotRoute,
  switchDeploymentRoute,
  updateDeploymentRoute,
  updateDeploymentSecretRoute,
  upsertDeploymentWebhookRoute,
} from './docker.docs.js';
import { SecretCreateSchema, SecretUpdateSchema } from './docker.schemas.js';
import {
  DockerDeploymentCreateSchema,
  DockerDeploymentDeploySchema,
  DockerDeploymentSwitchSchema,
  DockerDeploymentUpdateSchema,
} from './docker-deployment.schemas.js';
import { DockerDeploymentService } from './docker-deployment.service.js';
import { DockerSecretService } from './docker-secret.service.js';
import { WebhookUpsertSchema } from './docker-webhook.schemas.js';

function deploymentSecretContainerName(deploymentId: string) {
  return `deployment:${deploymentId}`;
}

export function registerDockerDeploymentRoutes(router: OpenAPIHono<AppEnv>) {
  router.openapi(
    { ...listDeploymentsRoute, middleware: requireScopeForResource('docker:containers:list', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const data = await service.list(c.req.param('nodeId')!);
      return c.json({ data });
    }
  );

  router.openapi(
    { ...createDeploymentRoute, middleware: requireScopeForResource('docker:containers:create', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.create(
        c.req.param('nodeId')!,
        DockerDeploymentCreateSchema.parse(await c.req.json()),
        user.id
      );
      return c.json({ data }, 201);
    }
  );

  router.openapi(
    { ...getDeploymentRoute, middleware: requireScopeForResource('docker:containers:view', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const data = await service.get(c.req.param('nodeId')!, c.req.param('deploymentId')!);
      return c.json({ data });
    }
  );

  router.openapi(
    { ...updateDeploymentRoute, middleware: requireScopeForResource('docker:containers:edit', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.update(
        c.req.param('nodeId')!,
        c.req.param('deploymentId')!,
        DockerDeploymentUpdateSchema.parse(await c.req.json()),
        user.id
      );
      return c.json({ data });
    }
  );

  router.openapi(
    { ...deleteDeploymentRoute, middleware: requireScopeForResource('docker:containers:delete', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      await service.remove(c.req.param('nodeId')!, c.req.param('deploymentId')!, user.id);
      return c.json({ success: true });
    }
  );

  router.openapi(
    { ...deploymentActionRoute('start'), middleware: requireScopeForResource('docker:containers:manage', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.start(c.req.param('nodeId')!, c.req.param('deploymentId')!, user.id);
      return c.json({ data });
    }
  );

  router.openapi(
    { ...deploymentActionRoute('stop'), middleware: requireScopeForResource('docker:containers:manage', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.stop(c.req.param('nodeId')!, c.req.param('deploymentId')!, user.id);
      return c.json({ data });
    }
  );

  router.openapi(
    { ...deploymentActionRoute('restart'), middleware: requireScopeForResource('docker:containers:manage', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.restart(c.req.param('nodeId')!, c.req.param('deploymentId')!, user.id);
      return c.json({ data });
    }
  );

  router.openapi(
    { ...deploymentActionRoute('kill'), middleware: requireScopeForResource('docker:containers:manage', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.kill(c.req.param('nodeId')!, c.req.param('deploymentId')!, user.id);
      return c.json({ data });
    }
  );

  router.openapi(
    { ...deployDeploymentRoute, middleware: requireScopeForResource('docker:containers:manage', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.deploy(
        c.req.param('nodeId')!,
        c.req.param('deploymentId')!,
        DockerDeploymentDeploySchema.parse(await c.req.json().catch(() => ({}))),
        user.id
      );
      return c.json({ data });
    }
  );

  router.openapi(
    { ...switchDeploymentRoute, middleware: requireScopeForResource('docker:containers:manage', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.switchToSlot(
        c.req.param('nodeId')!,
        c.req.param('deploymentId')!,
        DockerDeploymentSwitchSchema.parse(await c.req.json()),
        user.id
      );
      return c.json({ data });
    }
  );

  router.openapi(
    { ...rollbackDeploymentRoute, middleware: requireScopeForResource('docker:containers:manage', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const body = await c.req.json().catch(() => ({}));
      const data = await service.rollback(
        c.req.param('nodeId')!,
        c.req.param('deploymentId')!,
        body.force === true,
        user.id
      );
      return c.json({ data });
    }
  );

  router.openapi(
    { ...stopDeploymentSlotRoute, middleware: requireScopeForResource('docker:containers:manage', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const slot = DockerDeploymentSwitchSchema.shape.slot.parse(c.req.param('slot')!);
      await service.stopSlot(c.req.param('nodeId')!, c.req.param('deploymentId')!, slot, user.id);
      return c.json({ success: true });
    }
  );

  router.openapi(
    { ...listDeploymentSecretsRoute, middleware: requireScopeForResource('docker:containers:secrets', 'nodeId') },
    async (c) => {
      const deploymentService = container.resolve(DockerDeploymentService);
      const secretService = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId')!;
      const deploymentId = c.req.param('deploymentId')!;
      await deploymentService.get(nodeId, deploymentId);
      const scopes = c.get('effectiveScopes') || [];
      const canReveal = TokensService.hasScope(scopes, `docker:containers:secrets:${nodeId}`);
      const data = await secretService.list(nodeId, deploymentSecretContainerName(deploymentId), canReveal);
      return c.json({ data });
    }
  );

  router.openapi(
    { ...createDeploymentSecretRoute, middleware: requireScopeForResource('docker:containers:secrets', 'nodeId') },
    async (c) => {
      const deploymentService = container.resolve(DockerDeploymentService);
      const secretService = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId')!;
      const deploymentId = c.req.param('deploymentId')!;
      await deploymentService.get(nodeId, deploymentId);
      const user = c.get('user')!;
      const { key, value } = SecretCreateSchema.parse(await c.req.json());
      const data = await secretService.create(nodeId, deploymentSecretContainerName(deploymentId), key, value, user.id);
      return c.json({ data }, 201);
    }
  );

  router.openapi(
    { ...updateDeploymentSecretRoute, middleware: requireScopeForResource('docker:containers:secrets', 'nodeId') },
    async (c) => {
      const deploymentService = container.resolve(DockerDeploymentService);
      const secretService = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId')!;
      const deploymentId = c.req.param('deploymentId')!;
      await deploymentService.get(nodeId, deploymentId);
      const user = c.get('user')!;
      const { value } = SecretUpdateSchema.parse(await c.req.json());
      const data = await secretService.update(
        c.req.param('secretId')!,
        nodeId,
        value,
        user.id,
        deploymentSecretContainerName(deploymentId)
      );
      return c.json({ data });
    }
  );

  router.openapi(
    { ...deleteDeploymentSecretRoute, middleware: requireScopeForResource('docker:containers:secrets', 'nodeId') },
    async (c) => {
      const deploymentService = container.resolve(DockerDeploymentService);
      const secretService = container.resolve(DockerSecretService);
      const nodeId = c.req.param('nodeId')!;
      const deploymentId = c.req.param('deploymentId')!;
      await deploymentService.get(nodeId, deploymentId);
      const user = c.get('user')!;
      await secretService.delete(
        c.req.param('secretId')!,
        nodeId,
        user.id,
        deploymentSecretContainerName(deploymentId)
      );
      return c.json({ success: true });
    }
  );

  router.openapi(
    { ...deploymentWebhookRoute, middleware: requireScopeForResource('docker:containers:webhooks', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const data = await service.getWebhook(c.req.param('nodeId')!, c.req.param('deploymentId')!);
      return c.json({ data });
    }
  );

  router.openapi(
    { ...upsertDeploymentWebhookRoute, middleware: requireScopeForResource('docker:containers:webhooks', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.upsertWebhook(
        c.req.param('nodeId')!,
        c.req.param('deploymentId')!,
        WebhookUpsertSchema.parse(await c.req.json()),
        user.id
      );
      return c.json({ data });
    }
  );

  router.openapi(
    { ...deleteDeploymentWebhookRoute, middleware: requireScopeForResource('docker:containers:webhooks', 'nodeId') },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      await service.deleteWebhook(c.req.param('nodeId')!, c.req.param('deploymentId')!, user.id);
      return c.json({ success: true });
    }
  );

  router.openapi(
    {
      ...regenerateDeploymentWebhookRoute,
      middleware: requireScopeForResource('docker:containers:webhooks', 'nodeId'),
    },
    async (c) => {
      const service = container.resolve(DockerDeploymentService);
      const user = c.get('user')!;
      const data = await service.regenerateWebhook(c.req.param('nodeId')!, c.req.param('deploymentId')!, user.id);
      return c.json({ data });
    }
  );
}
