import { describe, expect, it } from 'vitest';
import { extractNodeIdFromCert } from './auth.js';

function makeCall(cn: string | null, authorized = true) {
  return {
    handler: {
      http2Stream: {
        session: {
          socket: {
            authorized,
            authorizationError: authorized ? null : 'SELF_SIGNED_CERT_IN_CHAIN',
            getPeerCertificate: () =>
              cn
                ? {
                    subject: { CN: cn },
                  }
                : {},
          },
        },
      },
    },
  } as any;
}

describe('extractNodeIdFromCert', () => {
  it('returns the node id from an authorized client certificate CN', () => {
    const nodeId = '11111111-1111-4111-8111-111111111111';

    expect(extractNodeIdFromCert(makeCall(nodeId))).toBe(nodeId);
  });

  it('rejects unauthorized client certificates even when a CN is present', () => {
    expect(extractNodeIdFromCert(makeCall('11111111-1111-4111-8111-111111111111', false))).toBe(null);
  });

  it('rejects missing or invalid certificate CNs', () => {
    expect(extractNodeIdFromCert(makeCall(null))).toBe(null);
    expect(extractNodeIdFromCert(makeCall('not-a-node-id'))).toBe(null);
  });
});
