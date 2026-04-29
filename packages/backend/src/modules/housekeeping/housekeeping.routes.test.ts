import 'reflect-metadata';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { container, TOKENS } from '@/container.js';
import type { DrizzleClient } from '@/db/client.js';
import { errorHandler } from '@/middleware/error-handler.js';
import { HousekeepingService } from '@/services/housekeeping.service.js';
import { SchedulerService } from '@/services/scheduler.service.js';
import { SessionService } from '@/services/session.service.js';
import type { AppEnv, SessionData, User } from '@/types.js';
import { housekeepingRoutes } from './housekeeping.routes.js';

const USER: User = {
  id: '11111111-1111-4111-8111-111111111111',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: [],
  isBlocked: false,
};

const SESSION: SessionData = {
  userId: USER.id,
  user: USER,
  accessToken: 'oidc-access-token',
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
  csrfToken: 'csrf-token',
};

function createApp() {
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.route('/api/housekeeping', housekeepingRoutes);
  return app;
}

function registerSession(scopes: string[]) {
  container.registerInstance(SessionService, {
    getSession: vi.fn().mockResolvedValue(SESSION),
    validateCsrfToken: vi.fn().mockResolvedValue(true),
    updateSession: vi.fn().mockResolvedValue(undefined),
    refreshSession: vi.fn().mockResolvedValue(false),
  } as unknown as SessionService);
  container.registerInstance(TOKENS.DrizzleClient, {
    query: {
      users: {
        findFirst: vi.fn().mockResolvedValue({
          id: USER.id,
          oidcSubject: USER.oidcSubject,
          email: USER.email,
          name: USER.name,
          avatarUrl: USER.avatarUrl,
          groupId: USER.groupId,
          isBlocked: USER.isBlocked,
        }),
      },
      permissionGroups: {
        findMany: vi.fn().mockResolvedValue([{ id: USER.groupId, parentId: null, name: USER.groupName, scopes }]),
      },
    },
  } as unknown as DrizzleClient);
}

function sessionHeaders() {
  return {
    Cookie: 'session_id=session-1',
    'X-CSRF-Token': 'csrf-token',
    'Content-Type': 'application/json',
  };
}

afterEach(() => {
  container.reset();
});

describe('housekeeping route permissions', () => {
  it('allows config reads with housekeeping:view', async () => {
    registerSession(['housekeeping:view']);
    const getConfig = vi.fn().mockResolvedValue({ enabled: true, cronExpression: '0 2 * * *' });
    container.registerInstance(HousekeepingService, { getConfig } as unknown as HousekeepingService);

    const response = await createApp().request('/api/housekeeping/config', { headers: sessionHeaders() });

    expect(response.status).toBe(200);
    expect(getConfig).toHaveBeenCalled();
  });

  it('does not allow config edits with only housekeeping:view', async () => {
    registerSession(['housekeeping:view']);
    const updateConfig = vi.fn();
    container.registerInstance(HousekeepingService, { updateConfig } as unknown as HousekeepingService);
    container.registerInstance(SchedulerService, { updateSchedule: vi.fn() } as unknown as SchedulerService);

    const response = await createApp().request('/api/housekeeping/config', {
      method: 'PUT',
      headers: sessionHeaders(),
      body: JSON.stringify({ enabled: false }),
    });

    expect(response.status).toBe(403);
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it('allows manual runs with housekeeping:run', async () => {
    registerSession(['housekeeping:run']);
    const runAll = vi.fn().mockResolvedValue({ overallSuccess: true, totalDurationMs: 1, categories: [] });
    container.registerInstance(HousekeepingService, { runAll } as unknown as HousekeepingService);

    const response = await createApp().request('/api/housekeeping/run', {
      method: 'POST',
      headers: sessionHeaders(),
    });

    expect(response.status).toBe(200);
    expect(runAll).toHaveBeenCalledWith('manual', USER.id);
  });
});
