import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { authMiddleware, rbacMiddleware } from '@/modules/auth/auth.middleware.js';
import { TemplatesService } from './templates.service.js';
import { CreateTemplateSchema, UpdateTemplateSchema } from './templates.schemas.js';
import type { AppEnv } from '@/types.js';

export const templateRoutes = new OpenAPIHono<AppEnv>();

templateRoutes.use('*', authMiddleware);

// List templates
templateRoutes.get('/', async (c) => {
  const templatesService = container.resolve(TemplatesService);
  const templates = await templatesService.listTemplates();
  return c.json(templates);
});

// Get template detail
templateRoutes.get('/:id', async (c) => {
  const templatesService = container.resolve(TemplatesService);
  const id = c.req.param('id');
  const template = await templatesService.getTemplate(id);
  if (!template) {
    return c.json({ code: 'TEMPLATE_NOT_FOUND', message: 'Template not found' }, 404);
  }
  return c.json(template);
});

// Create template (admin only)
templateRoutes.post('/', rbacMiddleware('admin'), async (c) => {
  const templatesService = container.resolve(TemplatesService);
  const user = c.get('user')!;
  const body = await c.req.json();
  const input = CreateTemplateSchema.parse(body);
  const template = await templatesService.createTemplate(input, user.id);
  return c.json(template, 201);
});

// Update template (admin only)
templateRoutes.patch('/:id', rbacMiddleware('admin'), async (c) => {
  const templatesService = container.resolve(TemplatesService);
  const id = c.req.param('id');
  const body = await c.req.json();
  const input = UpdateTemplateSchema.parse(body);
  const template = await templatesService.updateTemplate(id, input);
  return c.json(template);
});

// Delete template (admin only)
templateRoutes.delete('/:id', rbacMiddleware('admin'), async (c) => {
  const templatesService = container.resolve(TemplatesService);
  const id = c.req.param('id');
  await templatesService.deleteTemplate(id);
  return c.body(null, 204);
});
