import { describe, expect, it } from 'vitest';
import { extractClientIp } from './audit-request-context.js';

describe('extractClientIp', () => {
  it('prefers the first x-forwarded-for hop', () => {
    const headers = new Headers({
      'x-forwarded-for': '198.51.100.10, 203.0.113.4',
      'x-real-ip': '203.0.113.4',
    });

    expect(extractClientIp(headers)).toBe('198.51.100.10');
  });

  it('falls back to direct client ip headers', () => {
    const headers = new Headers({
      'cf-connecting-ip': '203.0.113.9',
    });

    expect(extractClientIp(headers)).toBe('203.0.113.9');
  });
});
