import { describe, expect, it } from 'vitest';
import { extractDaemonCertificateIdentity, extractNodeIdFromCert, normalizeCertificateSerial } from './auth.js';

function makeCall(options: {
  cn?: string | null;
  serialNumber?: string | null;
  authorized?: boolean;
  includeAuthorized?: boolean;
  useAuthContext?: boolean;
}) {
  const peerCertificate =
    options.cn || options.serialNumber
      ? {
          subject: options.cn ? { CN: options.cn } : {},
          serialNumber: options.serialNumber ?? undefined,
        }
      : {};
  const socket: Record<string, unknown> = {
    authorizationError: options.authorized === false ? 'SELF_SIGNED_CERT_IN_CHAIN' : null,
    getPeerCertificate: () => peerCertificate,
  };
  if (options.includeAuthorized !== false) {
    socket.authorized = options.authorized ?? true;
  }

  return {
    ...(options.useAuthContext ? { getAuthContext: () => ({ sslPeerCertificate: peerCertificate }) } : {}),
    handler: {
      http2Stream: {
        session: {
          socket,
        },
      },
    },
  } as any;
}

describe('extractDaemonCertificateIdentity', () => {
  const nodeId = '11111111-1111-4111-8111-111111111111';

  it('returns node id and normalized serial from a definitely authorized client certificate', () => {
    expect(
      extractDaemonCertificateIdentity(makeCall({ cn: nodeId, serialNumber: 'AA:bb:01', authorized: true }))
    ).toEqual({ nodeId, serialNumber: 'aabb01' });
  });

  it('rejects unauthorized certificates even when CN and serial are present', () => {
    expect(extractDaemonCertificateIdentity(makeCall({ cn: nodeId, serialNumber: 'aa01', authorized: false }))).toBe(
      null
    );
  });

  it('rejects ambiguous authorization state even when auth context exposes a certificate', () => {
    expect(
      extractDaemonCertificateIdentity(
        makeCall({ cn: nodeId, serialNumber: 'aa01', includeAuthorized: false, useAuthContext: true })
      )
    ).toBe(null);
  });

  it('rejects certificates without a usable serial number', () => {
    expect(extractDaemonCertificateIdentity(makeCall({ cn: nodeId, serialNumber: null, authorized: true }))).toBe(null);
  });

  it('rejects missing or invalid certificate CNs', () => {
    expect(extractDaemonCertificateIdentity(makeCall({ cn: null, serialNumber: 'aa01', authorized: true }))).toBe(null);
    expect(
      extractDaemonCertificateIdentity(makeCall({ cn: 'not-a-node-id', serialNumber: 'aa01', authorized: true }))
    ).toBe(null);
  });
});

describe('normalizeCertificateSerial', () => {
  it('normalizes case and colon separators', () => {
    expect(normalizeCertificateSerial('AA:bb:01')).toBe('aabb01');
  });

  it('trims whitespace', () => {
    expect(normalizeCertificateSerial('  aa01  ')).toBe('aa01');
  });
});

describe('extractNodeIdFromCert', () => {
  it('returns the node id from an authorized client certificate CN', () => {
    const nodeId = '11111111-1111-4111-8111-111111111111';

    expect(extractNodeIdFromCert(makeCall({ cn: nodeId, serialNumber: 'aa01' }))).toBe(nodeId);
  });

  it('supports grpc-js bidi stream call nesting and auth context', () => {
    const nodeId = '22222222-2222-4222-8222-222222222222';
    const peerCertificate = { subject: { CN: nodeId }, serialNumber: 'aa01' };
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
    expect(
      extractNodeIdFromCert(
        makeCall({ cn: '11111111-1111-4111-8111-111111111111', serialNumber: 'aa01', authorized: false })
      )
    ).toBe(null);
  });

  it('rejects missing or invalid certificate CNs', () => {
    expect(extractNodeIdFromCert(makeCall({ cn: null, serialNumber: 'aa01' }))).toBe(null);
    expect(extractNodeIdFromCert(makeCall({ cn: 'not-a-node-id', serialNumber: 'aa01' }))).toBe(null);
  });
});

describe('extractNodeIdFromCert compatibility wrapper', () => {
  it('returns only the node id for callers that still use the old helper', () => {
    const nodeId = '11111111-1111-4111-8111-111111111111';

    expect(extractNodeIdFromCert(makeCall({ cn: nodeId, serialNumber: 'aa01', authorized: true }))).toBe(nodeId);
  });
});
