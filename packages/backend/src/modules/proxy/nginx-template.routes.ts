import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { openApiValidationHook } from '@/lib/openapi.js';
import { authMiddleware, requireScope, sessionOnly } from '@/modules/auth/auth.middleware.js';
import { NodeDispatchService } from '@/services/node-dispatch.service.js';
import type { AppEnv } from '@/types.js';
import {
  cloneNginxTemplateRoute,
  createNginxTemplateRoute,
  deleteNginxTemplateRoute,
  getNginxTemplateRoute,
  listNginxTemplatesRoute,
  previewNginxTemplateRoute,
  testNginxTemplateRoute,
  updateNginxTemplateRoute,
} from './nginx-template.docs.js';
import {
  CreateNginxTemplateSchema,
  PreviewNginxTemplateSchema,
  UpdateNginxTemplateSchema,
} from './nginx-template.schemas.js';
import { NginxTemplateService } from './nginx-template.service.js';

export const nginxTemplateRoutes = new OpenAPIHono<AppEnv>({ defaultHook: openApiValidationHook });

nginxTemplateRoutes.use('*', authMiddleware);
nginxTemplateRoutes.use('*', sessionOnly);

// List all nginx templates
nginxTemplateRoutes.openapi({ ...listNginxTemplatesRoute, middleware: requireScope('proxy:list') }, async (c) => {
  const service = container.resolve(NginxTemplateService);
  const templates = await service.listTemplates();
  return c.json({ data: templates });
});

// Get single template
nginxTemplateRoutes.openapi({ ...getNginxTemplateRoute, middleware: requireScope('proxy:list') }, async (c) => {
  const service = container.resolve(NginxTemplateService);
  const id = c.req.param('id')!;
  const template = await service.getTemplate(id);
  return c.json({ data: template });
});

// Create template
nginxTemplateRoutes.openapi({ ...createNginxTemplateRoute, middleware: requireScope('proxy:edit') }, async (c) => {
  const service = container.resolve(NginxTemplateService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = CreateNginxTemplateSchema.parse(body);
  const template = await service.createTemplate(input, user.id);
  return c.json({ data: template }, 201);
});

// Update template
nginxTemplateRoutes.openapi({ ...updateNginxTemplateRoute, middleware: requireScope('proxy:edit') }, async (c) => {
  const service = container.resolve(NginxTemplateService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  const body = await c.req.json();
  const input = UpdateNginxTemplateSchema.parse(body);
  const template = await service.updateTemplate(id, input, user.id);
  return c.json({ data: template });
});

// Delete template
nginxTemplateRoutes.openapi({ ...deleteNginxTemplateRoute, middleware: requireScope('proxy:delete') }, async (c) => {
  const service = container.resolve(NginxTemplateService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  await service.deleteTemplate(id, user.id);
  return c.body(null, 204);
});

// Clone template
nginxTemplateRoutes.openapi({ ...cloneNginxTemplateRoute, middleware: requireScope('proxy:edit') }, async (c) => {
  const service = container.resolve(NginxTemplateService);
  const user = c.get('user')!;
  const id = c.req.param('id')!;
  const clone = await service.cloneTemplate(id, user.id);
  return c.json({ data: clone }, 201);
});

// Preview template with sample or real host data
nginxTemplateRoutes.openapi({ ...previewNginxTemplateRoute, middleware: requireScope('proxy:list') }, async (c) => {
  const service = container.resolve(NginxTemplateService);
  const body = await c.req.json();
  const input = PreviewNginxTemplateSchema.parse(body);

  let rendered: string;
  if (input.hostId) {
    // Render with real host data — need ProxyService to resolve host config
    const { ProxyService } = await import('./proxy.service.js');
    const proxyService = container.resolve(ProxyService);
    const host = await proxyService.getProxyHost(input.hostId);
    // Build a minimal ProxyHostConfig for rendering
    rendered = service.renderTemplate(input.content, {
      id: host.id,
      type: host.type,
      domainNames: host.domainNames,
      enabled: host.enabled,
      forwardHost: host.forwardHost,
      forwardPort: host.forwardPort,
      forwardScheme: host.forwardScheme ?? 'http',
      sslEnabled: host.sslEnabled,
      sslForced: host.sslForced,
      http2Support: host.http2Support,
      websocketSupport: host.websocketSupport,
      redirectUrl: host.redirectUrl,
      redirectStatusCode: host.redirectStatusCode ?? 301,
      customHeaders: (host.customHeaders ?? []) as { name: string; value: string }[],
      cacheEnabled: host.cacheEnabled,
      cacheOptions: host.cacheOptions as Record<string, unknown> | null,
      rateLimitEnabled: host.rateLimitEnabled,
      rateLimitOptions: host.rateLimitOptions as Record<string, unknown> | null,
      customRewrites: (host.customRewrites ?? []) as { source: string; destination: string; type: string }[],
      advancedConfig: host.advancedConfig,
      accessList: null, // simplified for preview
      sslCertPath: host.sslEnabled ? `/etc/nginx/certs/${host.id}.crt` : null,
      sslKeyPath: host.sslEnabled ? `/etc/nginx/certs/${host.id}.key` : null,
      sslChainPath: null,
    });
  } else {
    rendered = service.previewWithSampleData(input.content);
  }

  return c.json({ data: { rendered } });
});

// Test template — render + send to daemon for nginx -t (test_only mode)
nginxTemplateRoutes.openapi({ ...testNginxTemplateRoute, middleware: requireScope('proxy:edit') }, async (c) => {
  const service = container.resolve(NginxTemplateService);
  const nodeDispatch = container.resolve(NodeDispatchService);
  const body = await c.req.json();
  const input = PreviewNginxTemplateSchema.parse(body);

  const rendered = service.previewWithSampleData(input.content);

  try {
    const nodeId = await nodeDispatch.getFirstNginxNodeId();
    if (!nodeId) {
      return c.json({ data: { rendered, valid: false, errors: ['No nginx node available'] } });
    }
    // Send rendered config to daemon for test-only validation (writes temp, tests, removes)
    const testId = `test-${Date.now()}`;
    const result = await nodeDispatch.applyConfig(nodeId, testId, rendered, true);
    return c.json({ data: { rendered, valid: result.success, errors: result.error ? [result.error] : [] } });
  } catch (err) {
    return c.json({
      data: {
        rendered,
        valid: false,
        errors: [err instanceof Error ? err.message : 'Test failed'],
      },
    });
  }
});
