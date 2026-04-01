import { EventEmitter } from 'node:events';

export interface RelayedLogEntry {
  hostId: string;
  timestamp: string;
  remoteAddr: string;
  method: string;
  path: string;
  status: number;
  bodyBytesSent: string;
  raw: string;
  logType: string; // "access" or "error"
  level: string; // for error logs
}

export interface RelayedDaemonLogEntry {
  nodeId: string;
  timestamp: string;
  level: string;
  message: string;
  component: string;
  fields: Record<string, string>;
}

/**
 * In-memory relay for nginx access log entries.
 * gRPC log-stream handler emits entries here, SSE endpoints subscribe.
 */
export const logRelay = new EventEmitter();
logRelay.setMaxListeners(100);

/**
 * In-memory relay for daemon operational log entries with a per-node ring buffer.
 * gRPC control handler emits entries here, SSE endpoints subscribe.
 */
export const daemonLogRelay = new EventEmitter();
daemonLogRelay.setMaxListeners(100);

const DAEMON_LOG_BUFFER_SIZE = 300;
const daemonLogBuffers = new Map<string, RelayedDaemonLogEntry[]>();

/** Buffer daemon log entries per node for replay on SSE connect. */
daemonLogRelay.on('log', (entry: RelayedDaemonLogEntry) => {
  let buf = daemonLogBuffers.get(entry.nodeId);
  if (!buf) {
    buf = [];
    daemonLogBuffers.set(entry.nodeId, buf);
  }
  buf.push(entry);
  if (buf.length > DAEMON_LOG_BUFFER_SIZE) {
    buf.splice(0, buf.length - DAEMON_LOG_BUFFER_SIZE);
  }
});

/** Get buffered daemon logs for a node (for replay on SSE connect). */
export function getDaemonLogHistory(nodeId: string): RelayedDaemonLogEntry[] {
  return daemonLogBuffers.get(nodeId) ?? [];
}
