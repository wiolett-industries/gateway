import { describe, expect, it } from 'vitest';
import { createNodeEnrollmentToken, parseNodeEnrollmentToken } from './node-enrollment-token.js';

describe('node enrollment token helpers', () => {
  it('creates parseable v2 tokens with a selector', () => {
    const enrollmentToken = createNodeEnrollmentToken();

    expect(enrollmentToken.token).toMatch(/^gw_node_v2_[0-9a-f]{16}_[0-9a-f]{48}$/);
    expect(parseNodeEnrollmentToken(enrollmentToken.token)).toEqual({
      kind: 'v2',
      selector: enrollmentToken.selector,
    });
  });

  it('keeps pre-v2 node tokens in the legacy path', () => {
    expect(parseNodeEnrollmentToken(`gw_node_${'a'.repeat(48)}`)).toEqual({ kind: 'legacy' });
  });

  it('rejects malformed v2 tokens instead of falling back to a scan', () => {
    expect(parseNodeEnrollmentToken('gw_node_v2_short_secret')).toEqual({ kind: 'invalid' });
  });

  it('rejects malformed legacy-like tokens instead of falling back to a scan', () => {
    expect(parseNodeEnrollmentToken('gw_node_nothex')).toEqual({ kind: 'invalid' });
  });
});
