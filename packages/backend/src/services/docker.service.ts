import http from 'node:http';
import { createChildLogger } from '@/lib/logger.js';

const logger = createChildLogger('DockerService');

const API_VERSION = '/v1.46';

export class DockerService {
  constructor(
    private readonly socketPath: string,
    private readonly nginxContainerName: string
  ) {}

  /**
   * Execute a command inside a Docker container via the Docker Engine API.
   *
   * 1. POST /containers/{id}/exec  -> create exec instance
   * 2. POST /exec/{id}/start       -> run and capture output
   * 3. GET  /exec/{id}/inspect      -> retrieve exit code
   */
  async execInContainer(containerName: string, command: string[]): Promise<{ exitCode: number; output: string }> {
    logger.debug('Creating exec instance', { containerName, command });

    // Step 1: Create exec instance
    const createRes = await this.request(
      'POST',
      `${API_VERSION}/containers/${encodeURIComponent(containerName)}/exec`,
      {
        Cmd: command,
        AttachStdout: true,
        AttachStderr: true,
      }
    );

    if (createRes.statusCode !== 201) {
      throw new Error(`Docker exec create failed (${createRes.statusCode}): ${createRes.body}`);
    }

    const { Id: execId } = JSON.parse(createRes.body) as { Id: string };

    // Step 2: Start exec and capture output
    const startRes = await this.request('POST', `${API_VERSION}/exec/${execId}/start`, {
      Detach: false,
    });

    if (startRes.statusCode !== 200) {
      throw new Error(`Docker exec start failed (${startRes.statusCode}): ${startRes.body}`);
    }

    // The output stream from Docker may contain multiplexed header frames
    // (8-byte header per frame when AttachStdout + AttachStderr).
    // We strip those headers to get clean text output.
    const output = this.stripDockerStreamHeaders(startRes.bodyRaw);

    // Step 3: Inspect exec to get exit code
    const inspectRes = await this.request('GET', `${API_VERSION}/exec/${execId}/json`);

    if (inspectRes.statusCode !== 200) {
      throw new Error(`Docker exec inspect failed (${inspectRes.statusCode}): ${inspectRes.body}`);
    }

    const { ExitCode } = JSON.parse(inspectRes.body) as { ExitCode: number };

    logger.debug('Exec completed', { containerName, command, exitCode: ExitCode });

    return { exitCode: ExitCode, output };
  }

  /**
   * Low-level helper that sends an HTTP request over the Docker unix socket.
   */
  private request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ statusCode: number; body: string; bodyRaw: Buffer }> {
    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : undefined;

      const req = http.request(
        {
          socketPath: this.socketPath,
          method,
          path,
          headers: {
            ...(payload !== undefined
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(payload),
                }
              : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const rawBuffer = Buffer.concat(chunks);
            resolve({
              statusCode: res.statusCode ?? 0,
              body: rawBuffer.toString('utf-8'),
              bodyRaw: rawBuffer,
            });
          });
          res.on('error', reject);
        }
      );

      req.on('error', reject);

      if (payload !== undefined) {
        req.write(payload);
      }

      req.end();
    });
  }

  /**
   * Docker multiplexed stream format:
   *   [stream_type(1 byte)][0][0][0][size(4 bytes big-endian)][payload(size bytes)]
   *
   * stream_type: 0 = stdin, 1 = stdout, 2 = stderr
   *
   * If the buffer does not look like a multiplexed stream we return it as-is.
   */
  private stripDockerStreamHeaders(raw: Buffer): string {
    // Quick check: a multiplexed frame starts with 0x00, 0x01, or 0x02
    // followed by three zero bytes. If the buffer is too small or doesn't
    // match, just return the raw text.
    if (raw.length < 8) {
      return raw.toString('utf-8');
    }

    const firstByte = raw[0];
    if (firstByte !== 0 && firstByte !== 1 && firstByte !== 2) {
      return raw.toString('utf-8');
    }
    if (raw[1] !== 0 || raw[2] !== 0 || raw[3] !== 0) {
      return raw.toString('utf-8');
    }

    // Parse multiplexed frames
    const parts: string[] = [];
    let offset = 0;
    while (offset + 8 <= raw.length) {
      const frameSize = raw.readUInt32BE(offset + 4);
      const frameEnd = offset + 8 + frameSize;
      if (frameEnd > raw.length) {
        // Incomplete frame — append remainder as-is
        parts.push(raw.subarray(offset + 8).toString('utf-8'));
        break;
      }
      parts.push(raw.subarray(offset + 8, frameEnd).toString('utf-8'));
      offset = frameEnd;
    }
    return parts.join('');
  }

  /**
   * Fetch one-shot container stats from the Docker Engine API.
   */
  async getContainerStats(containerName: string): Promise<DockerContainerStats> {
    const res = await this.request(
      'GET',
      `${API_VERSION}/containers/${encodeURIComponent(containerName)}/stats?stream=false`
    );
    if (res.statusCode !== 200) {
      throw new Error(`Docker stats failed (${res.statusCode}): ${res.body}`);
    }
    return JSON.parse(res.body) as DockerContainerStats;
  }

  /**
   * Inspect a container to get state, uptime, etc.
   */
  async inspectContainer(containerName: string): Promise<DockerContainerInspect> {
    const res = await this.request(
      'GET',
      `${API_VERSION}/containers/${encodeURIComponent(containerName)}/json`
    );
    if (res.statusCode !== 200) {
      throw new Error(`Docker inspect failed (${res.statusCode}): ${res.body}`);
    }
    return JSON.parse(res.body) as DockerContainerInspect;
  }

  /**
   * Test the Nginx configuration inside the nginx container.
   */
  async testNginxConfig(): Promise<{ valid: boolean; error?: string }> {
    logger.info('Testing Nginx configuration');
    const result = await this.execInContainer(this.nginxContainerName, ['nginx', '-t']);
    const valid = result.exitCode === 0;
    if (!valid) {
      logger.warn('Nginx config test failed', { output: result.output });
    }
    return {
      valid,
      error: valid ? undefined : result.output,
    };
  }

  /**
   * Reload the Nginx process inside the nginx container.
   */
  async reloadNginx(): Promise<void> {
    logger.info('Reloading Nginx');
    const result = await this.execInContainer(this.nginxContainerName, ['nginx', '-s', 'reload']);
    if (result.exitCode !== 0) {
      throw new Error(`Nginx reload failed: ${result.output}`);
    }
    logger.info('Nginx reloaded successfully');
  }
}

export interface DockerContainerStats {
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
    online_cpus: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
  };
  memory_stats: {
    usage: number;
    limit: number;
    stats?: { cache?: number };
  };
  blkio_stats: {
    io_service_bytes_recursive: Array<{ op: string; value: number }> | null;
  };
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
}

export interface DockerContainerInspect {
  State: {
    Status: string;
    Running: boolean;
    StartedAt: string;
  };
  Config: {
    Image: string;
  };
}
