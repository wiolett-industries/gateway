import type { ServerDuplexStream, ServerUnaryCall } from '@grpc/grpc-js';
import { createChildLogger } from '@/lib/logger.js';

const logger = createChildLogger('GrpcAuth');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extract the authenticated node ID from a gRPC call's mTLS client certificate.
 *
 * Node certificates are issued with CN = nodeId (a UUID) during enrollment
 * (see system-ca.service.ts issueNodeCert).
 *
 * This reads the peer certificate from the underlying TLS socket and returns
 * the CN if it is a valid UUID, or null if no cert is presented.
 *
 * Enrollment service should NOT use this (clients have no cert yet).
 * Control and LogStream services MUST verify the cert CN matches the claimed nodeId.
 */
export function extractNodeIdFromCert(
  call: ServerDuplexStream<unknown, unknown> | ServerUnaryCall<unknown, unknown>,
): string | null {
  try {
    // @grpc/grpc-js exposes the TLS socket via internal handler chain.
    // The peer certificate is accessible through the HTTP/2 session's socket.
    const handler = (call as any).handler;
    const stream = handler?.http2Stream ?? (call as any).call?.stream;
    const session = stream?.session;
    const socket = session?.socket;

    if (!socket || typeof socket.getPeerCertificate !== 'function') {
      return null;
    }

    const peerCert = socket.getPeerCertificate(false);
    if (!peerCert?.subject) {
      return null;
    }

    const cn = peerCert.subject.CN;
    if (!cn || typeof cn !== 'string') {
      return null;
    }

    // CN is the node UUID directly (issued by system-ca.service.ts)
    if (!UUID_RE.test(cn)) {
      logger.warn('Client cert CN is not a valid UUID', { cn });
      return null;
    }

    return cn;
  } catch (err) {
    logger.debug('Could not extract node ID from cert', { error: (err as Error).message });
    return null;
  }
}
