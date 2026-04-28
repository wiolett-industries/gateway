import { describe, expect, it } from 'vitest';
import { mergeContext, normalizeEvent } from './context.js';

describe('logging sdk context', () => {
  it('merges root, child, and event context with event values taking precedence', () => {
    const merged = mergeContext(
      {
        service: 'api',
        source: 'main',
        labels: { region: 'eu', app: 'billing' },
        fields: { version: '2.4.1', provider: 'root' },
      },
      {
        service: 'billing-api',
        labels: { module: 'payments' },
        fields: { provider: 'stripe' },
      },
      {
        labels: { region: 'us' },
        fields: { statusCode: 502 },
      }
    );

    expect(merged).toEqual({
      service: 'billing-api',
      source: 'main',
      labels: { region: 'us', app: 'billing', module: 'payments' },
      fields: { version: '2.4.1', provider: 'stripe', statusCode: 502 },
    });
  });

  it('normalizes labels to strings and dates to ISO strings', () => {
    const normalized = normalizeEvent({
      severity: 'info',
      message: 'hello',
      timestamp: new Date('2026-04-28T12:00:00.000Z'),
      labels: { ok: true, count: 3, skip: undefined },
      fields: { at: new Date('2026-04-28T12:01:00.000Z') },
    });

    expect(normalized).toEqual({
      severity: 'info',
      message: 'hello',
      timestamp: '2026-04-28T12:00:00.000Z',
      labels: { ok: 'true', count: '3' },
      fields: { at: '2026-04-28T12:01:00.000Z' },
    });
  });
});
