import type { ServerDuplexStream } from '@grpc/grpc-js';
import { createChildLogger } from '@/lib/logger.js';
import { logRelay } from '@/modules/monitoring/log-relay.service.js';
import type { LogStreamControl, LogStreamMessage } from '../generated/types.js';
import { extractNodeIdFromCert } from '../interceptors/auth.js';
import type { GrpcServerDeps } from '../server.js';

const logger = createChildLogger('GrpcLogStream');

export function createLogStreamHandlers(deps: GrpcServerDeps) {
  return {
    StreamLogs(stream: ServerDuplexStream<LogStreamMessage, LogStreamControl>) {
      // Identify the node from its mTLS client certificate
      const nodeId = extractNodeIdFromCert(stream as any);
      logger.debug('Log stream opened', { nodeId: nodeId ?? 'unknown' });

      // Associate the log stream with the connected node in the registry
      if (nodeId) {
        const connectedNode = deps.registry.getNode(nodeId);
        if (connectedNode) {
          connectedNode.logStream = stream as any;
          logger.debug('Log stream associated with node', { nodeId });
        }
      }

      stream.on('data', (msg: LogStreamMessage) => {
        if (msg.subscribeAck) {
          logger.debug('Log subscribe ack', { hostId: msg.subscribeAck.hostId });
        } else if (msg.entry) {
          // Relay log entry to SSE consumers via the in-memory relay
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

      stream.on('end', () => {
        logger.debug('Log stream ended', { nodeId });
        // Clear the log stream reference from the registry
        if (nodeId) {
          const connectedNode = deps.registry.getNode(nodeId);
          if (connectedNode) {
            connectedNode.logStream = null;
          }
        }
        stream.end();
      });

      stream.on('error', (err) => {
        logger.warn('Log stream error', { nodeId, error: err.message });
        if (nodeId) {
          const connectedNode = deps.registry.getNode(nodeId);
          if (connectedNode) {
            connectedNode.logStream = null;
          }
        }
      });
    },
  };
}
