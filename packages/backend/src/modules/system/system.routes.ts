import { z } from 'zod';
import { OpenAPIHono } from '@hono/zod-openapi';
import { container } from '@/container.js';
import { createChildLogger } from '@/lib/logger.js';
import { authMiddleware, rbacMiddleware } from '@/modules/auth/auth.middleware.js';
import { UpdateService } from '@/services/update.service.js';
import type { AppEnv } from '@/types.js';

const logger = createChildLogger('SystemRoutes');

export const systemRoutes = new OpenAPIHono<AppEnv>();

systemRoutes.use('*', authMiddleware);

// GET /version — current version + cached update status (any authenticated user)
systemRoutes.get('/version', async (c) => {
  const updateService = container.resolve(UpdateService);
  const status = await updateService.getCachedStatus();
  return c.json({ data: status });
});

// POST /check-update — manual check against GitLab (admin only)
systemRoutes.post('/check-update', rbacMiddleware('admin'), async (c) => {
  const updateService = container.resolve(UpdateService);
  const status = await updateService.checkForUpdates();
  return c.json({ data: status });
});

// POST /update — trigger self-update (admin only)
systemRoutes.post('/update', rbacMiddleware('admin'), async (c) => {
  const body = await c.req.json();
  const { version } = z.object({ version: z.string().min(1) }).parse(body);

  const updateService = container.resolve(UpdateService);

  // Verify update is actually available
  const status = await updateService.getCachedStatus();
  if (!status.updateAvailable) {
    return c.json({ code: 'NO_UPDATE', message: 'No update available' }, 400);
  }

  // Respond immediately, then trigger the update asynchronously.
  // The container will be replaced — the response must be sent first.
  setTimeout(() => {
    updateService.performUpdate(version).catch((err) => {
      logger.error('Update failed', { error: err });
    });
  }, 500);

  return c.json({ data: { status: 'updating', targetVersion: version } });
});

// GET /release-notes/:version — fetch release notes for a specific version
systemRoutes.get('/release-notes/:version', rbacMiddleware('admin'), async (c) => {
  const version = c.req.param('version');
  const updateService = container.resolve(UpdateService);
  const notes = await updateService.getReleaseNotes(version);
  return c.json({ data: { version, notes } });
});
