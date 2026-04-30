import { describe, expect, it, vi } from 'vitest';
import { GatewayLogger } from './logger.js';

describe('gateway trace logger', () => {
  it('adds trace id to trace logs and trace plus span id to span logs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 2, rejected: 0, errors: [] }), { status: 200 }));
    const logger = new GatewayLogger({
      endpoint: 'https://gateway.example.com',
      token: 'gwl_test',
      fetch: fetchMock,
      batching: { maxBatchSize: 100, flushDebounceMs: 60_000 },
    });

    const trace = logger.createTrace({ traceId: 'trace_123', labels: { flow: 'checkout' } });
    const span = trace.createSpan({ spanId: 'span_456', labels: { provider: 'stripe' } });
    trace.info('Checkout started');
    span.error('Capture failed');
    await logger.flush();

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload.logs).toEqual([
      expect.objectContaining({ traceId: 'trace_123', labels: { flow: 'checkout' } }),
      expect.objectContaining({
        traceId: 'trace_123',
        spanId: 'span_456',
        labels: { flow: 'checkout', provider: 'stripe' },
      }),
    ]);
    await logger.close();
  });

  it('generates trace and span ids when not provided', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 1, rejected: 0, errors: [] }), { status: 200 }));
    const logger = new GatewayLogger({
      endpoint: 'https://gateway.example.com',
      token: 'gwl_test',
      fetch: fetchMock,
    });

    const trace = logger.createTrace();
    const span = trace.createSpan();

    expect(trace.traceId).toMatch(/[0-9a-f-]{36}/);
    expect(span.traceId).toBe(trace.traceId);
    expect(span.spanId).toMatch(/[0-9a-f-]{36}/);
    await logger.close();
  });
});
