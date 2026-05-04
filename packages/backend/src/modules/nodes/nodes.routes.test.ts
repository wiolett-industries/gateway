import 'reflect-metadata';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '@/middleware/error-handler.js';
import type { AppEnv } from '@/types.js';

const mocks = vi.hoisted(() => ({
  scopes: [] as string[],
  nodesService: {
    list: vi.fn(),
  },
}));

vi.mock('@/container.js', () => ({
  container: {
    resolve: vi.fn(() => mocks.nodesService),
  },
}));

vi.mock('@/modules/auth/auth.middleware.js', () => ({
  authMiddleware: async (c: any, next: () => Promise<void>) => {
    c.set('effectiveScopes', mocks.scopes);
    await next();
  },
  requireScope: () => async (_c: any, next: () => Promise<void>) => next(),
  requireScopeForResource: () => async (_c: any, next: () => Promise<void>) => next(),
  sessionOnly: async (_c: any, next: () => Promise<void>) => next(),
}));

vi.mock('@/modules/monitoring/log-relay.service.js', () => ({
  daemonLogRelay: {},
  getDaemonLogHistory: vi.fn(),
  logRelay: {},
}));

import { nodesRoutes } from './nodes.routes.js';

function createApp() {
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.route('/', nodesRoutes);
  return app;
}

describe('nodesRoutes list access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scopes = [];
    mocks.nodesService.list.mockResolvedValue({ data: [], page: 1, limit: 100, total: 0, totalPages: 0 });
  });

  it('allows broad Docker view scopes to discover Docker nodes', async () => {
    mocks.scopes = ['docker:containers:view'];

    const response = await createApp().request('/?type=docker&limit=100');

    expect(response.status).toBe(200);
    expect(mocks.nodesService.list).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'docker', limit: 100 }),
      undefined
    );
  });

  it('allows resource-scoped Docker view scopes to discover their Docker node', async () => {
    mocks.scopes = ['docker:containers:view:node-1'];

    const response = await createApp().request('/?type=docker&limit=100');

    expect(response.status).toBe(200);
    expect(mocks.nodesService.list).toHaveBeenCalledWith(expect.objectContaining({ type: 'docker', limit: 100 }), {
      allowedIds: ['node-1'],
    });
  });

  it('still rejects node listing without node or Docker access', async () => {
    mocks.scopes = [];

    const response = await createApp().request('/?type=docker&limit=100');

    expect(response.status).toBe(403);
    expect(mocks.nodesService.list).not.toHaveBeenCalled();
  });
});
