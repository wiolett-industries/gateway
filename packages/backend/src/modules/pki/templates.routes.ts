import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { authMiddleware, requireScope } from '@/modules/auth/auth.middleware.js';
import type { AppEnv } from '@/types.js';
import { CreateTemplateSchema, UpdateTemplateSchema } from './templates.schemas.js';
import { TemplatesService } from './templates.service.js';

export const templateRoutes = new OpenAPIHono<AppEnv>();

templateRoutes.use('*', authMiddleware);

// List templates
templateRoutes.get('/', requireScope('pki:templates:list'), async (c) => {
  const templatesService = container.resolve(TemplatesService);
  const templates = await templatesService.listTemplates();
  return c.json(templates);
});

// Get template detail
templateRoutes.get('/:id', requireScope('pki:templates:view'), async (c) => {
  const templatesService = container.resolve(TemplatesService);
  const id = c.req.param('id');
  const template = await templatesService.getTemplate(id);
  if (!template) {
    return c.json({ code: 'TEMPLATE_NOT_FOUND', message: 'Template not found' }, 404);
  }
  return c.json(template);
});

// Create template (admin only)
templateRoutes.post('/', requireScope('pki:templates:create'), async (c) => {
  const templatesService = container.resolve(TemplatesService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = CreateTemplateSchema.parse(body);
  const template = await templatesService.createTemplate(input, user.id);
  return c.json(template, 201);
});

// Update template (admin only)
templateRoutes.patch('/:id', requireScope('pki:templates:edit'), async (c) => {
  const templatesService = container.resolve(TemplatesService);
  const id = c.req.param('id');
  const body = await c.req.json();
  const input = UpdateTemplateSchema.parse(body);
  const template = await templatesService.updateTemplate(id, input);
  return c.json(template);
});

// Delete template (admin only)
templateRoutes.delete('/:id', requireScope('pki:templates:delete'), async (c) => {
  const templatesService = container.resolve(TemplatesService);
  const id = c.req.param('id');
  await templatesService.deleteTemplate(id);
  return c.body(null, 204);
});
