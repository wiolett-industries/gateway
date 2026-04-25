import type { ServerDuplexStream, ServerUnaryCall } from '@grpc/grpc-js';
import { createChildLogger } from '@/lib/logger.js';

const logger = createChildLogger('GrpcAuth');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getPeerCertificateSocket(call: unknown): {
  authorized?: boolean;
  authorizationError?: unknown;
  getPeerCertificate: (detailed?: boolean) => unknown;
} | null {
  const seen = new Set<unknown>();
  const keys = ['handler', 'http2Stream', 'call', 'nextCall', 'stream', 'session', 'socket'];

  function visit(value: unknown, depth: number): ReturnType<typeof getPeerCertificateSocket> {
    if (!value || typeof value !== 'object' || seen.has(value) || depth < 0) {
      return null;
    }
    seen.add(value);

    const candidate = value as {
      getPeerCertificate?: unknown;
      authorized?: boolean;
      authorizationError?: unknown;
    };
    if (typeof candidate.getPeerCertificate === 'function') {
      return candidate as {
        authorized?: boolean;
        authorizationError?: unknown;
        getPeerCertificate: (detailed?: boolean) => unknown;
      };
    }

    for (const key of keys) {
      const found = visit((value as Record<string, unknown>)[key], depth - 1);
      if (found) return found;
    }
    return null;
  }

  return visit(call, 8);
}

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
  call: ServerDuplexStream<unknown, unknown> | ServerUnaryCall<unknown, unknown>
): string | null {
  try {
    // grpc-js exposes the peer certificate via getAuthContext(), but the TLS
    // authorization flag only lives on the underlying socket. Walk the known
    // call chain shapes because unary and bidi stream objects differ.
    const socket = getPeerCertificateSocket(call);
    const authContext =
      typeof (call as { getAuthContext?: unknown }).getAuthContext === 'function' ? call.getAuthContext() : {};
    const authCert = (authContext as { sslPeerCertificate?: unknown }).sslPeerCertificate;
    const peerCert = authCert ?? socket?.getPeerCertificate(false);

    if (socket?.authorized === false) {
      logger.warn('Client cert is not authorized', { authorizationError: socket.authorizationError });
      return null;
    }

    if (!peerCert || typeof peerCert !== 'object') {
      return null;
    }

    const subject = (peerCert as { subject?: { CN?: unknown } }).subject;
    if (!subject) {
      return null;
    }

    const cn = subject.CN;
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
