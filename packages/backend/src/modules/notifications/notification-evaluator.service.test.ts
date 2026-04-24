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

function createEvaluator(certs: any[], rules = [BASE_RULE]) {
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
      getEnabledThresholdRules: async () => rules,
      getEnabledEventRules: async () => [],
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
