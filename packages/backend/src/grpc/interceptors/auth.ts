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

export interface DaemonCertificateIdentity {
  nodeId: string;
  serialNumber: string;
}

export function normalizeCertificateSerial(serial: string): string {
  return serial.trim().replace(/:/g, '').toLowerCase();
}

/**
 * Extract the authenticated daemon identity from a gRPC call's mTLS client certificate.
 *
 * Node certificates are issued with CN = nodeId (a UUID) during enrollment
 * (see system-ca.service.ts issueNodeCert).
 *
 * This reads the peer certificate from grpc-js auth context or the underlying
 * TLS socket and returns CN plus certificate serial only when TLS authorization
 * is definitely successful.
 *
 * Enrollment service should NOT use this (clients have no cert yet).
 * Enrolled daemon services MUST bind this identity to nodes.certificateSerial.
 */
export function extractDaemonCertificateIdentity(
  call: ServerDuplexStream<unknown, unknown> | ServerUnaryCall<unknown, unknown>
): DaemonCertificateIdentity | null {
  try {
    // grpc-js exposes the peer certificate via getAuthContext(), but the TLS
    // authorization flag only lives on the underlying socket. Walk the known
    // call chain shapes because unary and bidi stream objects differ.
    const socket = getPeerCertificateSocket(call);
    if (!socket) {
      logger.warn('Client cert rejected: no TLS socket with peer certificate access');
      return null;
    }
    if (socket.authorized !== true) {
      logger.warn('Client cert rejected: mTLS authorization is missing or failed', {
        authorized: socket.authorized,
        authorizationError: socket.authorizationError,
      });
      return null;
    }

    const authContext =
      typeof (call as { getAuthContext?: unknown }).getAuthContext === 'function' ? call.getAuthContext() : {};
    const authCert = (authContext as { sslPeerCertificate?: unknown }).sslPeerCertificate;
    const peerCert = authCert ?? socket.getPeerCertificate(false);

    if (!peerCert || typeof peerCert !== 'object') {
      logger.warn('Client cert rejected: peer certificate missing');
      return null;
    }

    const subject = (peerCert as { subject?: { CN?: unknown } }).subject;
    const cn = subject?.CN;
    if (!cn || typeof cn !== 'string' || !UUID_RE.test(cn)) {
      logger.warn('Client cert rejected: CN is missing or not a valid node UUID', { cn });
      return null;
    }

    const rawSerial = (peerCert as { serialNumber?: unknown }).serialNumber;
    if (!rawSerial || typeof rawSerial !== 'string') {
      logger.warn('Client cert rejected: serial number is missing', { nodeId: cn });
      return null;
    }

    const serialNumber = normalizeCertificateSerial(rawSerial);
    if (!serialNumber) {
      logger.warn('Client cert rejected: serial number is empty after normalization', { nodeId: cn });
      return null;
    }

    return { nodeId: cn, serialNumber };
  } catch (err) {
    logger.debug('Could not extract daemon certificate identity', { error: (err as Error).message });
    return null;
  }
}

export function extractNodeIdFromCert(
  call: ServerDuplexStream<unknown, unknown> | ServerUnaryCall<unknown, unknown>
): string | null {
  return extractDaemonCertificateIdentity(call)?.nodeId ?? null;
}
