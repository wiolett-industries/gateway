import { describe, expect, it, vi } from 'vitest';
import { createEnrollmentHandlers } from './enrollment.js';

const nodeId = '11111111-1111-4111-8111-111111111111';
const expiresAt = new Date('2030-01-01T00:00:00.000Z');

function makeDbNode(
  node: null | { certificateSerial?: string | null; status?: string; hostname?: string },
  updateSet = vi.fn()
) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () =>
            node
              ? [
                  {
                    certificateSerial: 'certificateSerial' in node ? node.certificateSerial : 'aa01',
                    hostname: node.hostname ?? 'node-1',
                    status: node.status ?? 'online',
                  },
                ]
              : []
          ),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value) => {
        updateSet(value);
        return {
          where: vi.fn(async () => undefined),
        };
      }),
    })),
  } as any;
}

function makeCall(options: {
  requestedNodeId?: string;
  cn?: string;
  serialNumber?: string;
  authorized?: boolean;
  includeAuthorized?: boolean;
  peer?: string;
}) {
  const socket: Record<string, unknown> = {
    authorizationError: options.authorized === false ? 'SELF_SIGNED_CERT_IN_CHAIN' : null,
    getPeerCertificate: () => ({
      subject: { CN: options.cn ?? nodeId },
      serialNumber: options.serialNumber ?? 'aa01',
    }),
  };
  if (options.includeAuthorized !== false) {
    socket.authorized = options.authorized ?? true;
  }

  return {
    request: { nodeId: options.requestedNodeId ?? nodeId },
    getPeer: () => options.peer ?? '127.0.0.1:50000',
    handler: {
      http2Stream: {
        session: {
          socket,
        },
      },
    },
  } as any;
}

function makeDeps(db: any, connected = true) {
  const commandStream = {
    end: vi.fn(),
    destroy: vi.fn(),
    getPeer: () => '127.0.0.1:12345',
  };
  const logStream = {
    end: vi.fn(),
    destroy: vi.fn(),
  };

  return {
    db,
    commandStream,
    logStream,
    registry: {
      getNode: vi.fn(() =>
        connected
          ? {
              commandStream,
              logStream,
            }
          : null
      ),
      deregister: vi.fn(async () => undefined),
    },
    systemCA: {
      issueNodeCert: vi.fn(async () => ({
        serial: 'new01',
        expiresAt,
        certPem: 'cert-pem',
        keyPem: 'key-pem',
      })),
    },
    dispatch: {},
    auditService: {},
    caService: {},
    cryptoService: {},
  } as any;
}

describe('RenewCertificate daemon certificate identity', () => {
  it('renews a certificate when authorized cert CN and serial match DB', async () => {
    const updateSet = vi.fn();
    const deps = makeDeps(makeDbNode({ certificateSerial: 'AA:01' }, updateSet));
    const callback = vi.fn();

    await createEnrollmentHandlers(deps).RenewCertificate(makeCall({ serialNumber: 'aa01' }), callback);

    expect(deps.systemCA.issueNodeCert).toHaveBeenCalledWith(nodeId, 'node-1');
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ certificateSerial: 'new01', certificateExpiresAt: expiresAt })
    );
    expect(callback).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        clientCertificate: Buffer.from('cert-pem'),
        clientKey: Buffer.from('key-pem'),
        certExpiresAt: String(Math.floor(expiresAt.getTime() / 1000)),
      })
    );
    await vi.waitFor(() => {
      expect(deps.registry.deregister).toHaveBeenCalledWith(nodeId, deps.commandStream);
      expect(deps.commandStream.end).toHaveBeenCalled();
      expect(deps.commandStream.destroy).toHaveBeenCalled();
      expect(deps.logStream.end).toHaveBeenCalled();
      expect(deps.logStream.destroy).toHaveBeenCalled();
    });
  });

  it('closes old streams even when deregistration fails after renewal', async () => {
    const deps = makeDeps(makeDbNode({ certificateSerial: 'AA:01' }));
    deps.registry.deregister.mockRejectedValueOnce(new Error('deregister failed'));
    const callback = vi.fn();

    await createEnrollmentHandlers(deps).RenewCertificate(makeCall({ serialNumber: 'aa01' }), callback);

    expect(callback).toHaveBeenCalledWith(null, expect.anything());
    await vi.waitFor(() => {
      expect(deps.commandStream.end).toHaveBeenCalled();
      expect(deps.commandStream.destroy).toHaveBeenCalled();
      expect(deps.logStream.end).toHaveBeenCalled();
      expect(deps.logStream.destroy).toHaveBeenCalled();
    });
  });

  it('rejects renewal when cert serial does not match DB', async () => {
    const deps = makeDeps(makeDbNode({ certificateSerial: 'bb01' }));
    const callback = vi.fn();

    await createEnrollmentHandlers(deps).RenewCertificate(makeCall({ serialNumber: 'aa01' }), callback);

    expect(deps.systemCA.issueNodeCert).not.toHaveBeenCalled();
    expect(callback.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        code: 7,
        message: 'Client certificate is not the current enrolled certificate for this node',
      })
    );
  });

  it('rejects renewal when mTLS authorization state is ambiguous', async () => {
    const deps = makeDeps(makeDbNode({ certificateSerial: 'aa01' }));
    const callback = vi.fn();

    await createEnrollmentHandlers(deps).RenewCertificate(makeCall({ includeAuthorized: false }), callback);

    expect(deps.systemCA.issueNodeCert).not.toHaveBeenCalled();
    expect(callback.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ code: 16 }));
  });

  it('rejects renewal when cert CN does not match requested node', async () => {
    const deps = makeDeps(makeDbNode({ certificateSerial: 'aa01' }));
    const callback = vi.fn();

    await createEnrollmentHandlers(deps).RenewCertificate(
      makeCall({ cn: '22222222-2222-4222-8222-222222222222' }),
      callback
    );

    expect(deps.systemCA.issueNodeCert).not.toHaveBeenCalled();
    expect(callback.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ code: 7 }));
  });

  it('rejects renewal when node has no stored certificate serial', async () => {
    const deps = makeDeps(makeDbNode({ certificateSerial: null }));
    const callback = vi.fn();

    await createEnrollmentHandlers(deps).RenewCertificate(makeCall({ serialNumber: 'aa01' }), callback);

    expect(deps.systemCA.issueNodeCert).not.toHaveBeenCalled();
    expect(callback.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ code: 7 }));
  });

  it('rejects renewal when node is pending', async () => {
    const deps = makeDeps(makeDbNode({ certificateSerial: 'aa01', status: 'pending' }));
    const callback = vi.fn();

    await createEnrollmentHandlers(deps).RenewCertificate(makeCall({ serialNumber: 'aa01' }), callback);

    expect(deps.systemCA.issueNodeCert).not.toHaveBeenCalled();
    expect(callback.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ code: 7 }));
  });
});
