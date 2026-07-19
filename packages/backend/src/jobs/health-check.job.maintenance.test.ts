import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthCheckJob } from './health-check.job.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HealthCheckJob maintenance race', () => {
  it('does not publish or evaluate a completed check when conditional persistence is rejected', async () => {
    const host = {
      id: 'host-1',
      domainNames: ['example.com'],
      enabled: true,
      maintenanceEnabled: false,
      healthCheckEnabled: true,
      healthStatus: 'online',
      healthHistory: [],
      healthCheckSlowThreshold: 3,
      healthCheckExpectedStatus: null,
      healthCheckExpectedBody: null,
      healthCheckUrl: '/',
      forwardScheme: 'http',
      forwardHost: '127.0.0.1',
      forwardPort: 8080,
    };
    const returning = vi.fn().mockResolvedValue([]);
    const db = {
      query: { proxyHosts: { findMany: vi.fn().mockResolvedValue([host]) } },
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(() => ({ returning })) })),
      })),
    } as any;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, text: vi.fn().mockResolvedValue('ok') }));
    const publish = vi.fn();
    const observeStatefulEvent = vi.fn();
    const job = new HealthCheckJob(db);
    job.setEventBus({ publish } as any);
    job.setEvaluator({ observeStatefulEvent } as any);

    await job.run();

    expect(returning).toHaveBeenCalledOnce();
    expect(observeStatefulEvent).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
