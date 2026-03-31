import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { container } from '@/container.js';
import { createChildLogger } from '@/lib/logger.js';
import { authMiddleware, requireScope, sessionOnly } from '@/modules/auth/auth.middleware.js';
import { UpdateService } from '@/services/update.service.js';
import type { AppEnv } from '@/types.js';

const logger = createChildLogger('SystemRoutes');

export const systemRoutes = new OpenAPIHono<AppEnv>();

systemRoutes.use('*', authMiddleware);
systemRoutes.use('*', sessionOnly);

// GET /version — current version + cached update status (any authenticated user)
systemRoutes.get('/version', async (c) => {
  const updateService = container.resolve(UpdateService);
  const status = await updateService.getCachedStatus();
  return c.json({ data: status });
});

// POST /check-update — manual check against GitLab (admin only)
systemRoutes.post('/check-update', requireScope('admin:update'), async (c) => {
  const updateService = container.resolve(UpdateService);
  const status = await updateService.checkForUpdates();
  return c.json({ data: status });
});

// POST /update — trigger self-update (admin only)
systemRoutes.post('/update', requireScope('admin:update'), async (c) => {
  const body = await c.req.json();
  const { version } = z
    .object({
      version: z.string().regex(/^v?\d+\.\d+\.\d+$/, 'Invalid version format'),
    })
    .parse(body);

  const updateService = container.resolve(UpdateService);

  // Verify update is actually available and version matches
  const status = await updateService.getCachedStatus();
  if (!status.updateAvailable) {
    return c.json({ code: 'NO_UPDATE', message: 'No update available' }, 400);
  }
  if (version !== status.latestVersion) {
    return c.json({ code: 'VERSION_MISMATCH', message: 'Requested version does not match available update' }, 400);
  }

  // Respond immediately, then trigger the update asynchronously.
  // The container will be replaced — the response must be sent first.
  setTimeout(() => {
    updateService.performUpdate(version).catch((err) => {
      logger.error('Update failed', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    });
  }, 500);

  return c.json({ data: { status: 'updating', targetVersion: version } });
});

// GET /release-notes/:version — fetch release notes for a specific version
systemRoutes.get('/release-notes/:version', requireScope('admin:update'), async (c) => {
  const version = c.req.param('version');
  if (!/^v?\d+\.\d+\.\d+$/.test(version)) {
    return c.json({ code: 'INVALID_VERSION', message: 'Invalid version format' }, 400);
  }
  const updateService = container.resolve(UpdateService);
  try {
    const notes = await updateService.getReleaseNotes(version);
    return c.json({ data: { version, notes } });
  } catch {
    return c.json({ code: 'FETCH_FAILED', message: `Failed to fetch release notes for ${version}` }, 502);
  }
});

// GET /release-notes — fetch release notes for all versions between current and latest
systemRoutes.get('/release-notes', requireScope('admin:update'), async (c) => {
  const updateService = container.resolve(UpdateService);
  const status = await updateService.getCachedStatus();
  if (!status.latestVersion || !status.updateAvailable) {
    return c.json({ data: [] });
  }
  try {
    const notes = await updateService.getReleaseNotesSince(status.currentVersion, status.latestVersion);
    return c.json({ data: notes });
  } catch {
    // Fallback to cached latest release notes
    return c.json({ data: status.releaseNotes ? [{ version: status.latestVersion, notes: status.releaseNotes }] : [] });
  }
});
