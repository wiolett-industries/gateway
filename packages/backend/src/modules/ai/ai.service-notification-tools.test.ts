import { describe, expect, it, vi } from 'vitest';
import { AIService } from './ai.service.js';

const BASE_USER = {
  id: 'user-1',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: [] as string[],
  isBlocked: false,
};

function createService({
  notifRuleService,
  notifWebhookService,
  notifDeliveryService,
  notifDispatcherService,
}: {
  notifRuleService?: Record<string, unknown>;
  notifWebhookService?: Record<string, unknown>;
  notifDeliveryService?: Record<string, unknown>;
  notifDispatcherService?: Record<string, unknown>;
} = {}) {
  return new AIService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { log: vi.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    notifRuleService as never,
    notifWebhookService as never,
    notifDeliveryService as never,
    notifDispatcherService as never
  );
}

describe('AIService notification tool routing', () => {
  it('returns a clear tool result when notification services are unavailable', async () => {
    const service = createService();

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['notifications:view'] }, 'list_alert_rules', {})
    ).resolves.toEqual({
      result: { error: 'Notification service not available' },
      invalidateStores: [],
    });
  });

  it('creates alert rules with existing AI defaults', async () => {
    const notifRuleService = {
      create: vi.fn().mockResolvedValue({ id: 'rule-1' }),
    };
    const service = createService({ notifRuleService });

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['notifications:manage'] }, 'create_alert_rule', {
        name: 'CPU High',
        type: 'threshold',
        category: 'node',
        severity: 'warning',
        webhookIds: ['webhook-1'],
      })
    ).resolves.toMatchObject({
      result: { id: 'rule-1' },
      invalidateStores: [],
    });
    expect(notifRuleService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'CPU High',
        durationSeconds: 0,
        fireThresholdPercent: 100,
        resolveAfterSeconds: 60,
        resolveThresholdPercent: 100,
        resourceIds: [],
        webhookIds: ['webhook-1'],
        cooldownSeconds: 900,
        enabled: true,
      }),
      'user-1'
    );
  });

  it('creates webhooks with default POST method, signing header, and enabled state', async () => {
    const notifWebhookService = {
      create: vi.fn().mockResolvedValue({ id: 'webhook-1' }),
    };
    const service = createService({ notifWebhookService });

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['notifications:manage'] }, 'create_webhook', {
        name: 'Discord',
        url: 'https://example.test/webhook',
      })
    ).resolves.toMatchObject({
      result: { id: 'webhook-1' },
      invalidateStores: [],
    });
    expect(notifWebhookService.create).toHaveBeenCalledWith(
      {
        name: 'Discord',
        url: 'https://example.test/webhook',
        method: 'POST',
        templatePreset: undefined,
        bodyTemplate: undefined,
        signingSecret: undefined,
        signingHeader: 'X-Signature-256',
        enabled: true,
        headers: {},
      },
      'user-1'
    );
  });

  it('dispatches test webhooks using the raw webhook and a sample event', async () => {
    const webhook = { id: 'webhook-1', name: 'Discord' };
    const notifWebhookService = {
      getRaw: vi.fn().mockResolvedValue(webhook),
    };
    const notifDispatcherService = {
      dispatch: vi.fn().mockResolvedValue({ success: true }),
    };
    const service = createService({ notifWebhookService, notifDispatcherService });

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['notifications:manage'] }, 'test_webhook', {
        webhookId: 'webhook-1',
      })
    ).resolves.toMatchObject({
      result: { success: true },
      invalidateStores: [],
    });
    expect(notifWebhookService.getRaw).toHaveBeenCalledWith('webhook-1');
    expect(notifDispatcherService.dispatch).toHaveBeenCalledWith(webhook, expect.any(Object), true);
  });

  it('lists webhook deliveries with clamped agent limits and passthrough filters', async () => {
    const notifDeliveryService = {
      list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    };
    const service = createService({ notifDeliveryService });

    await expect(
      service.executeTool({ ...BASE_USER, scopes: ['notifications:view'] }, 'list_webhook_deliveries', {
        webhookId: 'webhook-1',
        status: 'failed',
        limit: 999,
      })
    ).resolves.toMatchObject({
      result: { data: [], total: 0 },
      invalidateStores: [],
    });
    expect(notifDeliveryService.list).toHaveBeenCalledWith({
      page: 1,
      limit: 100,
      webhookId: 'webhook-1',
      status: 'failed',
    });
  });
});
