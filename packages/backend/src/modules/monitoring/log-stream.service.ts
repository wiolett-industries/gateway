import { spawn } from 'node:child_process';
import { createChildLogger } from '@/lib/logger.js';
import path from 'node:path';

const logger = createChildLogger('LogStreamService');

export interface LogEntry {
  timestamp: string;
  remoteAddr: string;
  method: string;
  path: string;
  status: number;
  bodyBytesSent: number;
  referer: string;
  userAgent: string;
  upstreamResponseTime: string;
  raw: string;
}

export class LogStreamService {
  private activeStreams = new Map<string, Set<() => void>>();

  constructor(private readonly logsPath: string) {}

  /**
   * Create a readable stream of log entries for a specific proxy host.
   * Spawns `tail -f` on the host's access log and parses each line.
   * Returns a cleanup function to terminate the tail process.
   */
  createStream(
    hostId: string,
    onData: (entry: LogEntry) => void,
    onError: (error: Error) => void,
  ): () => void {
    const logFile = path.join(this.logsPath, `proxy-${hostId}.access.log`);

    // Path confinement check to prevent directory traversal
    const resolved = path.resolve(logFile);
    if (!resolved.startsWith(path.resolve(this.logsPath))) {
      throw new Error('Invalid log path');
    }

    logger.info('Starting log stream', { hostId, logFile });

    // Spawn tail -f on the log file, starting with last 50 lines
    const child = spawn('tail', ['-f', '-n', '50', logFile]);

    // Track active stream for this host
    let cleanedUp = false;
    if (!this.activeStreams.has(hostId)) {
      this.activeStreams.set(hostId, new Set());
    }

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      child.kill('SIGTERM');
      const hostStreams = this.activeStreams.get(hostId);
      if (hostStreams) {
        hostStreams.delete(cleanup);
        if (hostStreams.size === 0) {
          this.activeStreams.delete(hostId);
        }
      }
      logger.info('Log stream stopped', { hostId });
    };

    this.activeStreams.get(hostId)!.add(cleanup);

    let buffer = '';
    child.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = this.parseLogLine(line);
          onData(entry);
        } catch {
          // If can't parse, send raw line
          onData({ raw: line } as LogEntry);
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (!msg.includes('No such file')) {
        logger.warn('Log tail stderr', { hostId, msg });
      }
    });

    child.on('error', (err) => {
      logger.error('Log tail process error', { hostId, error: err.message });
      onError(err);
    });

    child.on('exit', (code) => {
      if (code !== null && code !== 0 && !cleanedUp) {
        logger.warn('Log tail process exited', { hostId, code });
      }
    });

    return cleanup;
  }

  /**
   * Get count of active streams per host.
   */
  getActiveStreamCount(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [hostId, streams] of this.activeStreams) {
      counts.set(hostId, streams.size);
    }
    return counts;
  }

  /**
   * Parse Nginx combined log format with optional upstream_response_time.
   *
   * Format:
   * $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" "$upstream_response_time"
   *
   * Example:
   * 192.168.1.1 - - [28/Mar/2026:12:00:00 +0000] "GET /api/test HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0" "0.005"
   */
  private parseLogLine(line: string): LogEntry {
    // Regex to parse nginx combined log format with optional upstream_response_time
    const regex =
      /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+\S+"\s+(\d+)\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"\s*"?([^"]*)"?$/;

    const match = line.match(regex);
    if (!match) {
      throw new Error('Unable to parse log line');
    }

    return {
      remoteAddr: match[1],
      timestamp: match[2],
      method: match[3],
      path: match[4],
      status: parseInt(match[5], 10),
      bodyBytesSent: parseInt(match[6], 10),
      referer: match[7],
      userAgent: match[8],
      upstreamResponseTime: match[9] || '-',
      raw: line,
    };
  }
}
