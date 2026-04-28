import { describe, expect, it, vi } from 'vitest';
import { createGatewayLogger } from './logger.js';

describe('gateway logger', () => {
  it('queues severity helper events with merged context', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 1, rejected: 0, errors: [] }), { status: 200 }));
    const logger = createGatewayLogger({
      endpoint: 'https://gateway.example.com',
      token: 'gwl_test',
      service: 'api',
      labels: { app: 'billing' },
      fetch: fetchMock,
      batching: { flushDebounceMs: 10 },
    });

    const payments = logger.child({
      service: 'billing-api',
      labels: { module: 'payments' },
      fields: { provider: 'stripe' },
    });
    payments.error('Capture failed', {
      labels: { region: 'us' },
      fields: { statusCode: 502 },
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      severity: 'error',
      message: 'Capture failed',
      service: 'billing-api',
      labels: { app: 'billing', module: 'payments', region: 'us' },
      fields: { provider: 'stripe', statusCode: 502 },
    });
    await logger.close();
    vi.useRealTimers();
  });

  it('flush sends queued logs manually', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 1, rejected: 0, errors: [] }), { status: 200 }));
    const logger = createGatewayLogger({
      endpoint: 'https://gateway.example.com',
      token: 'gwl_test',
      fetch: fetchMock,
      batching: { flushIntervalMs: 60_000, flushDebounceMs: 60_000 },
    });

    logger.info('hello');
    await logger.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await logger.close();
  });

  it('withContext passes a derived logger', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 1, rejected: 0, errors: [] }), { status: 200 }));
    const logger = createGatewayLogger({
      endpoint: 'https://gateway.example.com',
      token: 'gwl_test',
      labels: { app: 'billing' },
      fetch: fetchMock,
      batching: { flushIntervalMs: 60_000, flushDebounceMs: 60_000 },
    });

    await logger.withContext({ requestId: 'req_123', labels: { route: '/payments' } }, async (log) => {
      log.info('request started');
    });
    await logger.flush();

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      requestId: 'req_123',
      labels: { app: 'billing', route: '/payments' },
    });
    await logger.close();
  });
});
