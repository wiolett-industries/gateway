import { describe, expect, it } from 'vitest';
import { isAlwaysBlockedOutboundIp, isPrivateIp, normalizeIp } from './ip-cidr.js';

describe('ip-cidr helpers', () => {
  it('normalizes IPv4-mapped IPv6 addresses to IPv4 before policy checks', () => {
    expect(normalizeIp('[::ffff:7f00:1]')).toBe('127.0.0.1');
    expect(normalizeIp('::ffff:0a00:0001')).toBe('10.0.0.1');
    expect(isAlwaysBlockedOutboundIp(normalizeIp('[::ffff:7f00:1]')!)).toBe(true);
    expect(isPrivateIp(normalizeIp('[::ffff:0a00:0001]')!)).toBe(true);
  });
});
