import { afterEach, describe, expect, it, vi } from 'vitest';
import { container } from '@/container.js';
import { EventBusService } from '@/services/event-bus.service.js';
import type { User } from '@/types.js';

const mocks = vi.hoisted(() => ({
  resolveLiveSessionUser: vi.fn(),
  resolveLiveUser: vi.fn(),
}));

vi.mock('@/modules/auth/live-session-user.js', () => ({
  resolveLiveSessionUser: mocks.resolveLiveSessionUser,
  resolveLiveUser: mocks.resolveLiveUser,
}));

import { authenticateEventsConnection, createEventsWSHandlers } from './events.ws.js';

const USER: User = {
  id: '11111111-1111-4111-8111-111111111111',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: ['nodes:details'],
  isBlocked: false,
};

function createWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  container.reset();
});

describe('events websocket authentication', () => {
  it('rejects blocked session users', async () => {
    mocks.resolveLiveSessionUser.mockResolvedValue({
      user: { ...USER, isBlocked: true },
      effectiveScopes: USER.scopes,
    });
    const ws = createWs();
    const handlers = createEventsWSHandlers();

    handlers.onOpen(new Event('open'), ws as any);
    await authenticateEventsConnection(ws as any, 'session-1');
    handlers.onClose(new Event('close'), ws as any);

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'error', message: 'unauthenticated' }));
    expect(ws.close).toHaveBeenCalledWith(4001, 'unauthenticated');
  });

  it('filters CA change events by CA type view scope', async () => {
    const eventBus = new EventBusService();
    container.registerInstance(EventBusService, eventBus);
    mocks.resolveLiveSessionUser.mockResolvedValue({
      user: { ...USER, scopes: ['pki:ca:view:intermediate'] },
      effectiveScopes: ['pki:ca:view:intermediate'],
    });
    const ws = createWs();
    const handlers = createEventsWSHandlers();

    handlers.onOpen(new Event('open'), ws as any);
    await authenticateEventsConnection(ws as any, 'session-1');
    handlers.onMessage(
      new MessageEvent('message', { data: JSON.stringify({ type: 'subscribe', channels: ['ca.changed'] }) }),
      ws as any
    );

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribed', channels: ['ca.changed'], rejected: [] })
    );

    eventBus.publish('ca.changed', { id: 'root-1', action: 'updated', type: 'root' });
    eventBus.publish('ca.changed', { id: 'int-1', action: 'updated', type: 'intermediate' });

    expect(ws.send).not.toHaveBeenCalledWith(
      JSON.stringify({
        type: 'event',
        channel: 'ca.changed',
        payload: { id: 'root-1', action: 'updated', type: 'root' },
      })
    );
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'event',
        channel: 'ca.changed',
        payload: { id: 'int-1', action: 'updated', type: 'intermediate' },
      })
    );

    handlers.onClose(new Event('close'), ws as any);
  });

  it('rejects unknown and unmapped event channels by default', async () => {
    const eventBus = new EventBusService();
    container.registerInstance(EventBusService, eventBus);
    mocks.resolveLiveSessionUser.mockResolvedValue({
      user: USER,
      effectiveScopes: USER.scopes,
    });
    const ws = createWs();
    const handlers = createEventsWSHandlers();

    handlers.onOpen(new Event('open'), ws as any);
    await authenticateEventsConnection(ws as any, 'session-1');
    handlers.onMessage(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'subscribe',
          channels: ['unmapped.channel', 'logging.environment.changed', 'system.update.changed'],
        }),
      }),
      ws as any
    );

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'subscribed',
        channels: [],
        rejected: ['unmapped.channel', 'logging.environment.changed', 'system.update.changed'],
      })
    );

    handlers.onClose(new Event('close'), ws as any);
  });

  it('filters logging events by environment-scoped log access', async () => {
    const eventBus = new EventBusService();
    container.registerInstance(EventBusService, eventBus);
    mocks.resolveLiveSessionUser.mockResolvedValue({
      user: { ...USER, scopes: ['logs:read:env-1'] },
      effectiveScopes: ['logs:read:env-1'],
    });
    const ws = createWs();
    const handlers = createEventsWSHandlers();

    handlers.onOpen(new Event('open'), ws as any);
    await authenticateEventsConnection(ws as any, 'session-1');
    handlers.onMessage(
      new MessageEvent('message', { data: JSON.stringify({ type: 'subscribe', channels: ['logging.logs.ingested'] }) }),
      ws as any
    );

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribed', channels: ['logging.logs.ingested'], rejected: [] })
    );

    eventBus.publish('logging.logs.ingested', { environmentId: 'env-2', count: 5 });
    eventBus.publish('logging.logs.ingested', { environmentId: 'env-1', count: 1 });

    expect(ws.send).not.toHaveBeenCalledWith(
      JSON.stringify({
        type: 'event',
        channel: 'logging.logs.ingested',
        payload: { environmentId: 'env-2', count: 5 },
      })
    );
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'event',
        channel: 'logging.logs.ingested',
        payload: { environmentId: 'env-1', count: 1 },
      })
    );

    handlers.onClose(new Event('close'), ws as any);
  });

  it('does not treat database credential reveal as database event visibility', async () => {
    const eventBus = new EventBusService();
    container.registerInstance(EventBusService, eventBus);
    mocks.resolveLiveSessionUser.mockResolvedValue({
      user: { ...USER, scopes: ['databases:credentials:reveal:db-1'] },
      effectiveScopes: ['databases:credentials:reveal:db-1'],
    });
    const ws = createWs();
    const handlers = createEventsWSHandlers();

    handlers.onOpen(new Event('open'), ws as any);
    await authenticateEventsConnection(ws as any, 'session-1');
    handlers.onMessage(
      new MessageEvent('message', { data: JSON.stringify({ type: 'subscribe', channels: ['database.changed'] }) }),
      ws as any
    );

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribed', channels: [], rejected: ['database.changed'] })
    );

    eventBus.publish('database.changed', { id: 'db-1', action: 'updated' });

    expect(ws.send).not.toHaveBeenCalledWith(
      JSON.stringify({
        type: 'event',
        channel: 'database.changed',
        payload: { id: 'db-1', action: 'updated' },
      })
    );

    handlers.onClose(new Event('close'), ws as any);
  });

  it('does not treat database delete as database event visibility', async () => {
    const eventBus = new EventBusService();
    container.registerInstance(EventBusService, eventBus);
    mocks.resolveLiveSessionUser.mockResolvedValue({
      user: { ...USER, scopes: ['databases:delete:db-1'] },
      effectiveScopes: ['databases:delete:db-1'],
    });
    const ws = createWs();
    const handlers = createEventsWSHandlers();

    handlers.onOpen(new Event('open'), ws as any);
    await authenticateEventsConnection(ws as any, 'session-1');
    handlers.onMessage(
      new MessageEvent('message', { data: JSON.stringify({ type: 'subscribe', channels: ['database.changed'] }) }),
      ws as any
    );

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribed', channels: [], rejected: ['database.changed'] })
    );

    eventBus.publish('database.changed', { id: 'db-1', action: 'deleted' });

    expect(ws.send).not.toHaveBeenCalledWith(
      JSON.stringify({
        type: 'event',
        channel: 'database.changed',
        payload: { id: 'db-1', action: 'deleted' },
      })
    );

    handlers.onClose(new Event('close'), ws as any);
  });

  it('lets proxy folder managers receive folder layout events without host visibility', async () => {
    const eventBus = new EventBusService();
    container.registerInstance(EventBusService, eventBus);
    mocks.resolveLiveSessionUser.mockResolvedValue({
      user: { ...USER, scopes: ['proxy:folders:manage'] },
      effectiveScopes: ['proxy:folders:manage'],
    });
    const ws = createWs();
    const handlers = createEventsWSHandlers();

    handlers.onOpen(new Event('open'), ws as any);
    await authenticateEventsConnection(ws as any, 'session-1');
    handlers.onMessage(
      new MessageEvent('message', { data: JSON.stringify({ type: 'subscribe', channels: ['proxy.host.changed'] }) }),
      ws as any
    );

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribed', channels: ['proxy.host.changed'], rejected: [] })
    );

    eventBus.publish('proxy.host.changed', { id: 'host-1', action: 'updated', domain: 'example.test' });
    eventBus.publish('proxy.host.changed', { action: 'folder_updated', folderId: 'folder-1' });

    expect(ws.send).not.toHaveBeenCalledWith(
      JSON.stringify({
        type: 'event',
        channel: 'proxy.host.changed',
        payload: { id: 'host-1', action: 'updated', domain: 'example.test' },
      })
    );
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'event',
        channel: 'proxy.host.changed',
        payload: { action: 'folder_updated', folderId: 'folder-1' },
      })
    );

    handlers.onClose(new Event('close'), ws as any);
  });

  it('lets resource-scoped proxy viewers receive proxy folder layout events', async () => {
    const eventBus = new EventBusService();
    container.registerInstance(EventBusService, eventBus);
    mocks.resolveLiveSessionUser.mockResolvedValue({
      user: { ...USER, scopes: ['proxy:view:host-1'] },
      effectiveScopes: ['proxy:view:host-1'],
    });
    const ws = createWs();
    const handlers = createEventsWSHandlers();

    handlers.onOpen(new Event('open'), ws as any);
    await authenticateEventsConnection(ws as any, 'session-1');
    handlers.onMessage(
      new MessageEvent('message', { data: JSON.stringify({ type: 'subscribe', channels: ['proxy.host.changed'] }) }),
      ws as any
    );

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribed', channels: ['proxy.host.changed'], rejected: [] })
    );

    eventBus.publish('proxy.host.changed', { id: 'host-2', action: 'updated', domain: 'other.test' });
    eventBus.publish('proxy.host.changed', { action: 'hosts_moved', folderId: 'folder-1' });

    expect(ws.send).not.toHaveBeenCalledWith(
      JSON.stringify({
        type: 'event',
        channel: 'proxy.host.changed',
        payload: { id: 'host-2', action: 'updated', domain: 'other.test' },
      })
    );
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'event',
        channel: 'proxy.host.changed',
        payload: { action: 'hosts_moved', folderId: 'folder-1' },
      })
    );

    handlers.onClose(new Event('close'), ws as any);
  });
});
