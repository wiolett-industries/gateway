import type { ServerDuplexStream } from '@grpc/grpc-js';
import { eq } from 'drizzle-orm';
import { nodes } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { logRelay } from '@/modules/monitoring/log-relay.service.js';
import type { LogStreamControl, LogStreamMessage } from '../generated/types.js';
import { extractDaemonCertificateIdentity, normalizeCertificateSerial } from '../interceptors/auth.js';
import type { GrpcServerDeps } from '../server.js';

const logger = createChildLogger('GrpcLogStream');

export function createLogStreamHandlers(deps: GrpcServerDeps) {
  return {
    StreamLogs(stream: ServerDuplexStream<LogStreamMessage, LogStreamControl>) {
      let nodeId: string | null = null;
      let closed = false;
      const clearAssociatedLogStream = () => {
        if (!nodeId) return;
        const connectedNode = deps.registry.getNode(nodeId);
        if (connectedNode?.logStream === stream) {
          connectedNode.logStream = null;
        }
      };

      stream.on('end', () => {
        closed = true;
        logger.debug('Log stream ended', { nodeId });
        clearAssociatedLogStream();
        stream.end();
      });

      stream.on('error', (err) => {
        closed = true;
        logger.warn('Log stream error', { nodeId, error: err.message });
        clearAssociatedLogStream();
      });

      void (async () => {
        // Identify the node from its authorized mTLS client certificate.
        const certIdentity = extractDaemonCertificateIdentity(stream as any);
        if (!certIdentity) {
          logger.warn('Log stream rejected: missing or unauthorized mTLS client certificate');
          stream.end();
          return;
        }
        const authenticatedNodeId = certIdentity.nodeId;
        nodeId = authenticatedNodeId;
        const initialConnectedNode = deps.registry.getNode(authenticatedNodeId);
        const initialConnectionId = initialConnectedNode?.connectionId;
        if (!initialConnectedNode || !initialConnectionId) {
          logger.warn('Log stream rejected: node is not connected', { nodeId });
          stream.end();
          return;
        }

        const [node] = await deps.db
          .select({ certificateSerial: nodes.certificateSerial, status: nodes.status })
          .from(nodes)
          .where(eq(nodes.id, authenticatedNodeId))
          .limit(1);

        if (!node || node.status === 'pending' || !node.certificateSerial) {
          logger.warn('Log stream rejected: node is not enrolled', { nodeId });
          stream.end();
          return;
        }
        const storedSerial = normalizeCertificateSerial(node.certificateSerial);
        if (storedSerial !== certIdentity.serialNumber) {
          logger.warn('Log stream rejected: certificate serial does not match enrolled node', {
            nodeId,
            presentedSerial: certIdentity.serialNumber,
            storedSerial,
          });
          stream.end();
          return;
        }
        if (closed) return;

        logger.debug('Log stream opened', { nodeId });

        // Associate the log stream with the connected node in the registry.
        const connectedNode = deps.registry.getNode(nodeId);
        if (!connectedNode || connectedNode.connectionId !== initialConnectionId) {
          logger.warn('Log stream rejected: node connection changed during authentication', { nodeId });
          stream.end();
          return;
        }
        if (closed) return;
        connectedNode.logStream = stream as any;
        logger.debug('Log stream associated with node', { nodeId });

        stream.on('data', (msg: LogStreamMessage) => {
          if (!nodeId || deps.registry.getNode(nodeId)?.logStream !== stream) {
            closed = true;
            stream.end();
            return;
          }
          if (msg.subscribeAck) {
            logger.debug('Log subscribe ack', { hostId: msg.subscribeAck.hostId });
          } else if (msg.entry) {
            // Relay log entry to SSE consumers via the in-memory relay.
            logRelay.emit('log', {
              hostId: msg.entry.hostId,
              timestamp: msg.entry.timestamp,
              remoteAddr: msg.entry.remoteAddr,
              method: msg.entry.method,
              path: msg.entry.path,
              status: msg.entry.status,
              bodyBytesSent: msg.entry.bodyBytesSent,
              raw: msg.entry.raw,
              logType: msg.entry.logType || 'access',
              level: msg.entry.level || '',
            });
          }
        });
      })().catch((err) => {
        logger.error('Log stream authentication failed', { error: (err as Error).message });
        stream.end();
      });
    },
  };
}
