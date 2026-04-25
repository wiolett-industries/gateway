import type { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { nodes } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import type { EnrollRequest, EnrollResponse, RenewCertRequest, RenewCertResponse } from '../generated/types.js';
import { extractNodeIdFromCert } from '../interceptors/auth.js';
import type { GrpcServerDeps } from '../server.js';

const logger = createChildLogger('GrpcEnrollment');

export function createEnrollmentHandlers(deps: GrpcServerDeps) {
  return {
    async Enroll(call: ServerUnaryCall<EnrollRequest, EnrollResponse>, callback: sendUnaryData<EnrollResponse>) {
      try {
        const req = call.request;
        logger.info('Enrollment request', { hostname: req.hostname });

        // Find a pending node with matching token
        const pendingNodes = await deps.db.select().from(nodes).where(eq(nodes.status, 'pending'));

        let matchedNode = null;
        for (const node of pendingNodes) {
          if (node.enrollmentTokenHash && (await bcrypt.compare(req.token, node.enrollmentTokenHash))) {
            if (!matchedNode) {
              matchedNode = node;
            }
          }
          // Don't break — always compare all to prevent timing oracle
        }

        if (!matchedNode) {
          callback({ code: 16, message: 'Invalid enrollment token' });
          return;
        }

        const nodeId = matchedNode.id;

        // Issue mTLS certificate via the system CA (real PKI)
        const certResult = await deps.systemCA.issueNodeCert(nodeId, req.hostname);

        // Update node with daemon info + cert tracking
        await deps.db
          .update(nodes)
          .set({
            status: 'online',
            hostname: req.hostname,
            daemonVersion: req.daemonVersion,
            osInfo: req.osInfo,
            capabilities: {
              ...(req.nginxVersion ? { nginxVersion: req.nginxVersion } : {}),
              ...(req.daemonType ? { daemonType: req.daemonType } : {}),
            },
            lastSeenAt: new Date(),
            enrollmentTokenHash: null,
            certificateSerial: certResult.serial,
            certificateExpiresAt: certResult.expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(nodes.id, nodeId));

        await deps.auditService.log({
          userId: null,
          action: 'node.enroll',
          resourceType: 'node',
          resourceId: nodeId,
          details: { hostname: req.hostname, type: matchedNode.type, certSerial: certResult.serial },
        });

        logger.info('Node enrolled with PKI cert', { nodeId, hostname: req.hostname, serial: certResult.serial });

        callback(null, {
          nodeId,
          caCertificate: Buffer.from(certResult.caCertPem),
          clientCertificate: Buffer.from(certResult.certPem),
          clientKey: Buffer.from(certResult.keyPem),
          certExpiresAt: String(Math.floor(certResult.expiresAt.getTime() / 1000)),
        });
      } catch (err) {
        logger.error('Enrollment failed', { error: (err as Error).message });
        callback({ code: 13, message: `Enrollment failed: ${(err as Error).message}` });
      }
    },

    async RenewCertificate(
      call: ServerUnaryCall<RenewCertRequest, RenewCertResponse>,
      callback: sendUnaryData<RenewCertResponse>
    ) {
      try {
        const req = call.request;
        logger.info('Certificate renewal request', { nodeId: req.nodeId });

        const certNodeId = extractNodeIdFromCert(call as any);
        if (!certNodeId) {
          callback({ code: 16, message: 'mTLS client certificate is required for certificate renewal' });
          return;
        }
        if (certNodeId !== req.nodeId) {
          logger.warn('Certificate renewal rejected: cert CN does not match requested nodeId', {
            certNodeId,
            requestedNodeId: req.nodeId,
          });
          callback({ code: 7, message: 'Client certificate does not match requested node' });
          return;
        }

        // Verify the caller is authenticated — must be a registered (non-pending) node
        const [node] = await deps.db.select().from(nodes).where(eq(nodes.id, req.nodeId)).limit(1);

        if (!node) {
          callback({ code: 5, message: 'Node not found' });
          return;
        }

        // Only enrolled nodes (with an existing cert serial) can renew
        if (!node.certificateSerial) {
          callback({ code: 7, message: 'Node has not been enrolled yet' });
          return;
        }

        // Reject if node is in pending status (never completed enrollment)
        if (node.status === 'pending') {
          callback({ code: 7, message: 'Node enrollment not complete' });
          return;
        }

        // Verify the requesting node is currently connected via CommandStream
        // (proves it holds a valid mTLS cert from the system CA)
        const connectedNode = deps.registry.getNode(req.nodeId);
        if (!connectedNode) {
          callback({ code: 7, message: 'Node must be connected to renew certificate' });
          return;
        }

        // Verify the renewal call originates from the same network peer as the
        // authenticated CommandStream — prevents cross-node cert impersonation
        const renewPeer = call.getPeer().replace(/:\d+$/, ''); // strip ephemeral port
        const streamPeer = connectedNode.commandStream.getPeer().replace(/:\d+$/, '');
        if (renewPeer !== streamPeer) {
          logger.warn('Cert renewal from different peer than connected stream', {
            nodeId: req.nodeId,
            renewPeer: call.getPeer(),
            streamPeer: connectedNode.commandStream.getPeer(),
          });
          callback({ code: 7, message: 'Renewal must originate from the connected node' });
          return;
        }

        // Issue new cert via system CA
        const certResult = await deps.systemCA.issueNodeCert(req.nodeId, node.hostname);

        await deps.db
          .update(nodes)
          .set({
            certificateSerial: certResult.serial,
            certificateExpiresAt: certResult.expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(nodes.id, req.nodeId));

        logger.info('Node cert renewed', { nodeId: req.nodeId, serial: certResult.serial });

        callback(null, {
          clientCertificate: Buffer.from(certResult.certPem),
          clientKey: Buffer.from(certResult.keyPem),
          certExpiresAt: String(Math.floor(certResult.expiresAt.getTime() / 1000)),
        });
      } catch (err) {
        logger.error('Certificate renewal failed', { error: (err as Error).message });
        callback({ code: 13, message: `Renewal failed: ${(err as Error).message}` });
      }
    },
  };
}
