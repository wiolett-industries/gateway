import { describe, expect, it } from 'vitest';
import { extractNodeIdFromCert } from './auth.js';

function makeCall(cn: string | null, authorized = true) {
  const peerCertificate = cn
    ? {
        subject: { CN: cn },
      }
    : {};

  return {
    handler: {
      http2Stream: {
        session: {
          socket: {
            authorized,
            authorizationError: authorized ? null : 'SELF_SIGNED_CERT_IN_CHAIN',
            getPeerCertificate: () => peerCertificate,
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

  it('supports grpc-js bidi stream call nesting and auth context', () => {
    const nodeId = '22222222-2222-4222-8222-222222222222';
    const peerCertificate = { subject: { CN: nodeId } };
    const call = {
      getAuthContext: () => ({ transportSecurityType: 'ssl', sslPeerCertificate: peerCertificate }),
      call: {
        nextCall: {
          stream: {
            session: {
              socket: {
                authorized: true,
                getPeerCertificate: () => peerCertificate,
              },
            },
          },
        },
      },
    } as any;

    expect(extractNodeIdFromCert(call)).toBe(nodeId);
  });

  it('rejects unauthorized client certificates even when a CN is present', () => {
    expect(extractNodeIdFromCert(makeCall('11111111-1111-4111-8111-111111111111', false))).toBe(null);
  });

  it('rejects missing or invalid certificate CNs', () => {
    expect(extractNodeIdFromCert(makeCall(null))).toBe(null);
    expect(extractNodeIdFromCert(makeCall('not-a-node-id'))).toBe(null);
  });
});
