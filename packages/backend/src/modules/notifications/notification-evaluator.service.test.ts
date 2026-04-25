import { describe, expect, it } from 'vitest';
import { sslCertificates } from '@/db/schema/index.js';
import { NotificationEvaluatorService } from './notification-evaluator.service.js';

const BASE_RULE = {
  id: 'rule-1',
  name: 'Certificate Expiry',
  enabled: true,
  type: 'threshold',
  category: 'certificate',
  severity: 'warning',
  metric: 'days_until_expiry',
  operator: '<=',
  thresholdValue: 14,
  durationSeconds: 0,
  fireThresholdPercent: 100,
  resolveAfterSeconds: 0,
  resolveThresholdPercent: 100,
  resourceIds: [],
  webhookIds: [],
};

const BASE_EVENT_RULE = {
  id: 'event-rule-1',
  name: 'Node Offline',
  enabled: true,
  type: 'event',
  category: 'node',
  severity: 'critical',
  metric: null,
  operator: null,
  thresholdValue: null,
  durationSeconds: 0,
  fireThresholdPercent: 100,
  resolveAfterSeconds: 0,
  resolveThresholdPercent: 100,
  eventPattern: 'offline',
  resourceIds: [],
  webhookIds: [],
};

function createEvaluator(certs: any[], thresholdRules = [BASE_RULE], eventRules: any[] = []) {
  const states: any[] = [];
  const db = {
    query: {
      sslCertificates: {
        findMany: async () => certs.filter((cert) => cert.status === 'active'),
      },
    },
    select: () => ({
      from: (table: unknown) => ({
        where: async () =>
          table === sslCertificates
            ? certs.filter((cert) => cert.status === 'active')
            : states.filter((state) => state.status === 'firing'),
      }),
    }),
  };

  const evaluator = new NotificationEvaluatorService(
    db as any,
    {
      getEnabledThresholdRules: async () => thresholdRules,
      getEnabledEventRules: async () => eventRules,
    } as any,
    { getRawByIds: async () => [] } as any,
    { dispatch: async () => undefined } as any,
    null,
    { getNode: () => null } as any
  );

  (evaluator as any).recordProbeOutcome = async () => undefined;
  (evaluator as any).getActiveAlertState = async (ruleId: string, resourceType: string, resourceId: string) =>
    states.find(
      (state) =>
        state.ruleId === ruleId &&
        state.resourceType === resourceType &&
        state.resourceId === resourceId &&
        state.status === 'firing'
    ) ?? null;
  (evaluator as any).fireAlert = async (
    rule: any,
    resourceType: string,
    resourceId: string,
    resourceName: string,
    context: Record<string, unknown>
  ) => {
    states.push({
      id: `state-${states.length + 1}`,
      ruleId: rule.id,
      resourceType,
      resourceId,
      resourceName,
      status: 'firing',
      firedAt: new Date('2026-04-01T00:00:00Z'),
      context,
    });
  };
  (evaluator as any).resolveAlert = async (
    stateId: string,
    _rule: any,
    _resourceType: string,
    _resourceId: string,
    _resourceName: string,
    context: Record<string, unknown>
  ) => {
    const state = states.find((candidate) => candidate.id === stateId);
    if (state) {
      state.status = 'resolved';
      state.context = context;
    }
  };

  return { evaluator, states };
}

describe('NotificationEvaluatorService certificate expiry evaluation', () => {
  it('fires when an active SSL certificate is within the configured threshold', async () => {
    const { evaluator, states } = createEvaluator([
      {
        id: 'cert-1',
        name: 'example.com',
        domainNames: ['example.com'],
        status: 'active',
        notAfter: new Date('2026-04-10T00:00:00Z'),
      },
    ]);

    await evaluator.evaluateCertificateExpiry(new Date('2026-04-01T00:00:00Z'));

    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      resourceType: 'certificate',
      resourceId: 'cert-1',
      status: 'firing',
      context: {
        days_until_expiry: 9,
        expiry_date: '2026-04-10T00:00:00.000Z',
        threshold: 14,
        operator: '<=',
      },
    });
  });

  it('resolves when certificate expiry moves outside the threshold', async () => {
    const cert = {
      id: 'cert-1',
      name: 'example.com',
      domainNames: ['example.com'],
      status: 'active',
      notAfter: new Date('2026-04-10T00:00:00Z'),
    };
    const { evaluator, states } = createEvaluator([cert]);

    await evaluator.evaluateCertificateExpiry(new Date('2026-04-01T00:00:00Z'));
    cert.notAfter = new Date('2026-05-15T00:00:00Z');
    await evaluator.evaluateCertificateExpiry(new Date('2026-04-01T00:00:00Z'));

    expect(states).toHaveLength(1);
    expect(states[0].status).toBe('resolved');
    expect(states[0].context).toMatchObject({
      days_until_expiry: 44,
      threshold: 14,
      operator: '<=',
    });
  });

  it('resolves stale firing state when the certificate is no longer active', async () => {
    const cert = {
      id: 'cert-1',
      name: 'example.com',
      domainNames: ['example.com'],
      status: 'active',
      notAfter: new Date('2026-04-10T00:00:00Z'),
    };
    const { evaluator, states } = createEvaluator([cert]);

    await evaluator.evaluateCertificateExpiry(new Date('2026-04-01T00:00:00Z'));
    cert.status = 'error';
    await evaluator.evaluateCertificateExpiry(new Date('2026-04-01T00:00:00Z'));

    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      status: 'resolved',
      context: {
        resolution_reason: 'certificate_inactive_or_deleted',
      },
    });
  });
});

describe('NotificationEvaluatorService stateful event evaluation', () => {
  it('fires a stateful event rule when the observed state matches', async () => {
    const { evaluator, states } = createEvaluator([], [], [BASE_EVENT_RULE]);

    await evaluator.observeStatefulEvent(
      'node',
      'offline',
      { type: 'node', id: 'node-1', name: 'worker-1' },
      { hostname: 'worker-1' }
    );

    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      ruleId: 'event-rule-1',
      resourceType: 'node',
      resourceId: 'node-1',
      status: 'firing',
      context: {
        event: 'offline',
        current_state: 'offline',
        hostname: 'worker-1',
      },
    });
  });

  it('resolves a stateful event rule when the observed state clears', async () => {
    const { evaluator, states } = createEvaluator([], [], [BASE_EVENT_RULE]);

    await evaluator.observeStatefulEvent('node', 'offline', { type: 'node', id: 'node-1', name: 'worker-1' });
    await evaluator.observeStatefulEvent('node', 'online', { type: 'node', id: 'node-1', name: 'worker-1' });

    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      status: 'resolved',
      context: {
        event: 'offline',
        current_state: 'online',
      },
    });
  });
});

describe('NotificationEvaluatorService ratio window evaluation', () => {
  it('uses a pre-window sample as coverage anchor for jittered polling intervals', async () => {
    const { evaluator } = createEvaluator([]);
    const now = 1_000_000;
    const zrangebyscore = async () => [`${now - 60_002}:1`, `${now - 30_000}:1`, `${now}:1`];
    (evaluator as any).redis = { zrangebyscore };

    const originalNow = Date.now;
    Date.now = () => now;
    try {
      const result = await (evaluator as any).evaluateRatioWindow('rule-1', 'node-1', 60_000, 100, 'breach');

      expect(result).toMatchObject({
        hasCoverage: true,
        sampleCount: 3,
        matchingSamples: 3,
        thresholdMet: true,
      });
    } finally {
      Date.now = originalNow;
    }
  });
});
