import { describe, expect, it, vi } from 'vitest';
import { createGatewayTransport } from './transport.js';

describe('gateway transport', () => {
  it('posts single events to /api/logging/ingest and batches to /api/logging/ingest/batch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 1, rejected: 0, errors: [] }), { status: 200 }));
    const transport = createGatewayTransport({
      endpoint: 'https://gateway.example.com',
      token: 'gwl_test',
      fetch: fetchMock,
    });

    await transport.send([{ severity: 'info', message: 'one' }]);
    await transport.send([
      { severity: 'info', message: 'one' },
      { severity: 'warn', message: 'two' },
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://gateway.example.com/api/logging/ingest',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://gateway.example.com/api/logging/ingest/batch',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('classifies 429 with retry-after as retryable rate limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'LOGGING_RATE_LIMIT_EXCEEDED', details: { retryAfterSeconds: 9 } }), {
        status: 429,
        headers: { 'Retry-After': '7' },
      })
    );
    const transport = createGatewayTransport({
      endpoint: 'https://gateway.example.com/',
      token: 'gwl_test',
      fetch: fetchMock,
    });

    const result = await transport.send([{ severity: 'info', message: 'one' }]);

    expect(result).toMatchObject({ ok: false, retryable: true, rateLimited: true, retryAfterMs: 7000, status: 429 });
  });

  it('classifies validation failures as permanent failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'INVALID_BODY' }), { status: 400 }));
    const transport = createGatewayTransport({
      endpoint: 'https://gateway.example.com',
      token: 'gwl_test',
      fetch: fetchMock,
    });

    const result = await transport.send([{ severity: 'info', message: 'one' }]);

    expect(result).toMatchObject({ ok: false, retryable: false, status: 400 });
  });

  it('classifies network errors as retryable', async () => {
    const error = new Error('socket closed');
    const fetchMock = vi.fn().mockRejectedValue(error);
    const transport = createGatewayTransport({
      endpoint: 'https://gateway.example.com',
      token: 'gwl_test',
      fetch: fetchMock,
    });

    await expect(transport.send([{ severity: 'info', message: 'one' }])).resolves.toEqual({
      ok: false,
      retryable: true,
      rateLimited: false,
      error,
    });
  });
});
