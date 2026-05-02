import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { logRelay } from '@/modules/monitoring/log-relay.service.js';
import { createLogStreamHandlers } from './log-stream.js';

const nodeId = '11111111-1111-4111-8111-111111111111';

function makeDbNode(node: null | { certificateSerial?: string | null; status?: string }) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () =>
            node
              ? [
                  {
                    certificateSerial: 'certificateSerial' in node ? node.certificateSerial : 'aa01',
                    status: node.status ?? 'online',
                  },
                ]
              : []
          ),
        })),
      })),
    })),
  } as any;
}

function makeDelayedDbNode() {
  let resolveRows!: (rows: Array<{ certificateSerial: string | null; status: string }>) => void;
  const rowsPromise = new Promise<Array<{ certificateSerial: string | null; status: string }>>((resolve) => {
    resolveRows = resolve;
  });

  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => rowsPromise),
          })),
        })),
      })),
    } as any,
    resolveRows,
  };
}

function makeStream(options: {
  cn?: string;
  serialNumber?: string;
  authorized?: boolean;
  includeAuthorized?: boolean;
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

  return Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn(),
    getPeer: () => '127.0.0.1:12345',
    handler: {
      http2Stream: {
        session: {
          socket,
        },
      },
    },
  }) as any;
}

function makeDeps(
  db: any,
  connectedNode: { connectionId?: string; logStream: unknown } | null = { connectionId: 'conn-1', logStream: null }
) {
  if (connectedNode && !connectedNode.connectionId) connectedNode.connectionId = 'conn-1';
  return {
    db,
    registry: {
      getNode: vi.fn(() => connectedNode),
    },
    dispatch: {},
    auditService: {},
    caService: {},
    cryptoService: {},
    systemCA: {},
  } as any;
}

describe('StreamLogs daemon certificate identity', () => {
  it('installs cleanup handlers before async authentication completes', () => {
    const deps = makeDeps(makeDbNode({ certificateSerial: 'aa01' }));
    const stream = makeStream({ serialNumber: 'aa01' });

    createLogStreamHandlers(deps).StreamLogs(stream);

    expect(stream.listenerCount('error')).toBe(1);
    expect(stream.listenerCount('end')).toBe(1);
  });

  it('does not associate the log stream when it ends during async authentication', async () => {
    const connectedNode = { logStream: null };
    const delayed = makeDelayedDbNode();
    const deps = makeDeps(delayed.db, connectedNode);
    const stream = makeStream({ serialNumber: 'aa01' });

    createLogStreamHandlers(deps).StreamLogs(stream);
    stream.emit('end');
    delayed.resolveRows([{ certificateSerial: 'aa01', status: 'online' }]);

    await new Promise((resolve) => setImmediate(resolve));

    expect(connectedNode.logStream).toBe(null);
  });

  it('associates the log stream when authorized cert serial matches DB', async () => {
    const connectedNode = { logStream: null };
    const deps = makeDeps(makeDbNode({ certificateSerial: 'AA:01' }), connectedNode);
    const stream = makeStream({ serialNumber: 'aa01' });

    createLogStreamHandlers(deps).StreamLogs(stream);

    await vi.waitFor(() => {
      expect(connectedNode.logStream).toBe(stream);
    });
    expect(stream.end).not.toHaveBeenCalled();
  });

  it('does not relay log entries from a stream that is no longer registered', async () => {
    const connectedNode = { connectionId: 'conn-1', logStream: null };
    const deps = makeDeps(makeDbNode({ certificateSerial: 'AA:01' }), connectedNode);
    const stream = makeStream({ serialNumber: 'aa01' });
    const emitSpy = vi.spyOn(logRelay, 'emit');

    createLogStreamHandlers(deps).StreamLogs(stream);

    await vi.waitFor(() => {
      expect(connectedNode.logStream).toBe(stream);
    });
    connectedNode.logStream = null;
    stream.emit('data', {
      entry: {
        hostId: 'host-1',
        timestamp: '2026-05-02T00:00:00.000Z',
        remoteAddr: '127.0.0.1',
        method: 'GET',
        path: '/',
        status: 200,
        bodyBytesSent: '0',
        raw: 'log',
        logType: 'access',
        level: '',
      },
    });

    expect(stream.end).toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalledWith('log', expect.anything());
    emitSpy.mockRestore();
  });

  it('rejects a log stream when the node command connection changes during authentication', async () => {
    const connectedNode = { connectionId: 'conn-1', logStream: null };
    const delayed = makeDelayedDbNode();
    const deps = makeDeps(delayed.db, connectedNode);
    const stream = makeStream({ serialNumber: 'aa01' });

    createLogStreamHandlers(deps).StreamLogs(stream);
    connectedNode.connectionId = 'conn-2';
    delayed.resolveRows([{ certificateSerial: 'aa01', status: 'online' }]);

    await vi.waitFor(() => {
      expect(stream.end).toHaveBeenCalled();
    });
    expect(connectedNode.logStream).toBe(null);
  });

  it('rejects the log stream when certificate serial does not match DB', async () => {
    const connectedNode = { logStream: null };
    const deps = makeDeps(makeDbNode({ certificateSerial: 'bb01' }), connectedNode);
    const stream = makeStream({ serialNumber: 'aa01' });

    createLogStreamHandlers(deps).StreamLogs(stream);

    await vi.waitFor(() => {
      expect(stream.end).toHaveBeenCalled();
    });
    expect(connectedNode.logStream).toBe(null);
  });

  it('rejects the log stream when no connected node exists', async () => {
    const deps = makeDeps(makeDbNode({ certificateSerial: 'aa01' }), null);
    const stream = makeStream({ serialNumber: 'aa01' });

    createLogStreamHandlers(deps).StreamLogs(stream);

    await vi.waitFor(() => {
      expect(stream.end).toHaveBeenCalled();
    });
  });

  it('rejects the log stream when mTLS authorization state is ambiguous', async () => {
    const connectedNode = { logStream: null };
    const deps = makeDeps(makeDbNode({ certificateSerial: 'aa01' }), connectedNode);
    const stream = makeStream({ serialNumber: 'aa01', includeAuthorized: false });

    createLogStreamHandlers(deps).StreamLogs(stream);

    await vi.waitFor(() => {
      expect(stream.end).toHaveBeenCalled();
    });
    expect(connectedNode.logStream).toBe(null);
  });
});
