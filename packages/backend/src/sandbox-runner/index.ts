import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createChildLogger } from '@/lib/logger.js';
import type {
  SandboxRunnerDownloadArtifactParams,
  SandboxRunnerDownloadArtifactResult,
  SandboxRunnerExecuteScriptParams,
  SandboxRunnerExecutionResult,
  SandboxRunnerFetchParams,
  SandboxRunnerFetchResult,
  SandboxRunnerHealth,
  SandboxRunnerKillResult,
  SandboxRunnerProcessParams,
  SandboxRunnerProcessResult,
  SandboxRunnerReadArtifactParams,
  SandboxRunnerReadArtifactResult,
  SandboxRunnerReadOutputParams,
  SandboxRunnerReadOutputResult,
  SandboxRunnerRequest,
  SandboxRunnerResponse,
  SandboxRunnerRevokeUserParams,
  SandboxRunnerRunProcessParams,
  SandboxRunnerSendArtifactParams,
  SandboxRunnerSendArtifactResult,
  SandboxRunnerWriteStdinParams,
  SandboxRunnerWriteStdinResult,
} from '@/modules/ai/ai.sandbox-runner.protocol.js';
import { type DockerCreateContainerConfig, DockerService } from '@/services/docker.service.js';

const logger = createChildLogger('SandboxRunner');
const SOCKET_PATH = process.env.SANDBOX_RUNNER_SOCKET || '/tmp/gateway-sandbox-runner.sock';
const DOCKER_SOCKET = process.env.SANDBOX_DOCKER_SOCKET || '/var/run/docker.sock';
const OUTPUT_LIMIT_BYTES = 256 * 1024;
const STDIN_LIMIT_BYTES = 64 * 1024;
const FETCH_LIMIT_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_LIMIT_BYTES = 200 * 1024 * 1024;
const READ_ARTIFACT_LIMIT_BYTES = 1024 * 1024;
const SEND_ARTIFACT_LIMIT_BYTES = 10 * 1024 * 1024;
const CPU_PERIOD = 100_000;
const RECONCILE_INTERVAL_MS = 30_000;
const ARTIFACT_ROOT = '/workspace';

const docker = new DockerService(DOCKER_SOCKET, '');
const runningTimeouts = new Map<string, NodeJS.Timeout>();
const imageEnsurePromises = new Map<string, Promise<string>>();

interface RuntimeImageSpec {
  upstreamImage: string;
  upstreamTag: string;
  internalRepo: string;
  internalTag: string;
}

function runtimeImageSpec(runtime: string): RuntimeImageSpec {
  if (runtime === 'node') {
    return {
      upstreamImage: 'node',
      upstreamTag: '22-alpine',
      internalRepo: 'gateway-sandbox-node',
      internalTag: '22-alpine',
    };
  }
  if (runtime === 'python') {
    return {
      upstreamImage: 'python',
      upstreamTag: '3.12-alpine',
      internalRepo: 'gateway-sandbox-python',
      internalTag: '3.12-alpine',
    };
  }
  return {
    upstreamImage: 'alpine',
    upstreamTag: '3.20',
    internalRepo: 'gateway-sandbox-alpine',
    internalTag: '3.20',
  };
}

function imageRef(repo: string, tag: string): string {
  return `${repo}:${tag}`;
}

async function ensureRuntimeImage(runtime: string): Promise<string> {
  const spec = runtimeImageSpec(runtime);
  const internalRef = imageRef(spec.internalRepo, spec.internalTag);
  const existingPromise = imageEnsurePromises.get(internalRef);
  if (existingPromise) return existingPromise;

  const promise = (async () => {
    if (await docker.imageExists(internalRef)) return internalRef;

    const upstreamRef = imageRef(spec.upstreamImage, spec.upstreamTag);
    const upstreamAlreadyExisted = await docker.imageExists(upstreamRef);
    logger.info('Preparing sandbox runtime image', { runtime, upstreamRef, internalRef });
    if (!upstreamAlreadyExisted) {
      await docker.pullImage(spec.upstreamImage, spec.upstreamTag);
    }
    await docker.tagImage(upstreamRef, spec.internalRepo, spec.internalTag);
    if (!upstreamAlreadyExisted) {
      await docker.removeImageTag(upstreamRef).catch((error) => {
        logger.warn('Failed to remove temporary sandbox upstream image tag', { upstreamRef, error });
      });
    }
    return internalRef;
  })().finally(() => {
    imageEnsurePromises.delete(internalRef);
  });
  imageEnsurePromises.set(internalRef, promise);
  return promise;
}

function runtimeShell(runtime: string, script: string): string[] {
  if (runtime === 'node') return ['node', '-e', script];
  if (runtime === 'python') return ['python', '-c', script];
  return ['sh', '-lc', script];
}

function truncateOutput(output: string): string {
  const buffer = Buffer.from(output);
  if (buffer.byteLength <= OUTPUT_LIMIT_BYTES) return output;
  return `${buffer.subarray(0, OUTPUT_LIMIT_BYTES).toString('utf-8')}\n[output truncated at ${OUTPUT_LIMIT_BYTES} bytes]`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sanitizeArtifactFilename(value: string): string {
  const cleaned = value.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'artifact.bin';
}

function fallbackFilenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const basename = path.posix.basename(parsed.pathname);
    return sanitizeArtifactFilename(decodeURIComponent(basename || 'artifact.bin'));
  } catch {
    return 'artifact.bin';
  }
}

function resolveArtifactPath(rawPath: unknown, fallbackFilename?: string) {
  const input =
    typeof rawPath === 'string' && rawPath.trim() ? rawPath.trim() : `artifacts/${fallbackFilename ?? 'artifact.bin'}`;
  if (input.includes('\0')) throw new Error('artifact path must not contain null bytes');
  if (path.posix.isAbsolute(input)) throw new Error('artifact path must be relative to /workspace');
  const normalized = path.posix.normalize(input).replace(/^(\.\/)+/, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('artifact path must stay inside /workspace');
  }
  return {
    relativePath: normalized,
    absolutePath: path.posix.join(ARTIFACT_ROOT, normalized),
    parentPath: path.posix.join(ARTIFACT_ROOT, path.posix.dirname(normalized)),
    basename: path.posix.basename(normalized),
  };
}

function isTextContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return /^(text\/|application\/(json|xml|javascript|x-javascript)|[^;]+\+json\b|[^;]+\+xml\b)/i.test(contentType);
}

async function readResponseBodyCapped(
  url: string,
  limitBytes: number
): Promise<{
  status: number;
  contentType: string | null;
  buffer: Buffer;
}> {
  await assertFetchUrlAllowed(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`fetch failed (${response.status} ${response.statusText})`);
    }
    if (!response.body) throw new Error('fetch response body is not readable');

    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > limitBytes) {
      throw new Error(`download exceeds ${limitBytes} byte limit`);
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.byteLength;
      if (total > limitBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`download exceeds ${limitBytes} byte limit`);
      }
      chunks.push(chunk);
    }
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      buffer: Buffer.concat(chunks, total),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function assertFetchUrlAllowed(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('url must be a valid HTTP or HTTPS URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('url must use http or https');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('localhost URLs are not allowed');
  }
  const addresses =
    net.isIP(hostname) !== 0
      ? [{ address: hostname }]
      : await dns.lookup(hostname, { all: true, verbatim: true }).catch((error) => {
          throw new Error(`failed to resolve URL hostname: ${error instanceof Error ? error.message : String(error)}`);
        });

  for (const { address } of addresses) {
    if (isBlockedNetworkAddress(address)) {
      throw new Error(`URL resolves to a blocked network address: ${address}`);
    }
  }
}

function isBlockedNetworkAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map((part) => Number(part));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (!net.isIPv6(address)) return true;
  const normalized = address.toLowerCase();
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('ff')
  );
}

function formatFetchedContent(
  url: string,
  status: number,
  contentType: string | null,
  buffer: Buffer
): SandboxRunnerFetchResult {
  if (isTextContentType(contentType)) {
    return {
      url,
      status,
      contentType,
      sizeBytes: buffer.byteLength,
      encoding: 'utf8',
      content: buffer.toString('utf-8'),
    };
  }
  return {
    url,
    status,
    contentType,
    sizeBytes: buffer.byteLength,
    encoding: 'base64',
    contentBase64: buffer.toString('base64'),
  };
}

function writeOctal(header: Buffer, value: number, offset: number, length: number): void {
  const text = value
    .toString(8)
    .padStart(length - 1, '0')
    .slice(-(length - 1));
  header.write(`${text}\0`, offset, length, 'ascii');
}

function createSingleFileTar(filename: string, content: Buffer): Buffer {
  const name = filename.replace(/^\/+/, '');
  if (!name || name.includes('/') || name === '.' || name === '..') {
    throw new Error('tar filename must be a single file basename');
  }
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, Math.min(Buffer.byteLength(name), 100), 'utf-8');
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, content.byteLength, 124, 12);
  writeOctal(header, Math.floor(Date.now() / 1000), 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeOctal(header, checksum, 148, 8);

  const paddingLength = (512 - (content.byteLength % 512)) % 512;
  return Buffer.concat([header, content, Buffer.alloc(paddingLength), Buffer.alloc(1024)]);
}

function sandboxLabels(policy: SandboxRunnerExecuteScriptParams['policy'], expiresAt: Date): Record<string, string> {
  return {
    'gateway.sandbox': 'true',
    'gateway.sandbox.user_id': policy.userId,
    'gateway.sandbox.conversation_id': policy.conversationId ?? '',
    'gateway.sandbox.job_id': policy.jobId,
    'gateway.sandbox.kind': policy.kind,
    'gateway.sandbox.tier': policy.tier,
    'gateway.sandbox.required_scopes': policy.requiredScopes.join(','),
    'gateway.sandbox.expires_at': expiresAt.toISOString(),
  };
}

async function containerConfig(
  policy: SandboxRunnerExecuteScriptParams['policy'],
  command: string[],
  options: { openStdin?: boolean } = {}
): Promise<DockerCreateContainerConfig> {
  const expiresAt = new Date(Date.now() + policy.ttlSeconds * 1000);
  return {
    Image: await ensureRuntimeImage(policy.runtime),
    Cmd: command,
    Labels: sandboxLabels(policy, expiresAt),
    User: '65534:65534',
    WorkingDir: '/workspace',
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: !!options.openStdin,
    OpenStdin: !!options.openStdin,
    StdinOnce: false,
    Tty: false,
    HostConfig: {
      AutoRemove: false,
      ReadonlyRootfs: true,
      NetworkMode: 'none',
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      PidsLimit: policy.pidsLimit,
      Memory: policy.memoryBytes,
      MemorySwap: policy.memoryBytes,
      CpuPeriod: CPU_PERIOD,
      CpuQuota: policy.cpuQuota,
      Tmpfs: {
        '/workspace': `rw,nosuid,nodev,size=${policy.workspaceBytes},uid=65534,gid=65534,mode=700`,
      },
      LogConfig: {
        Type: 'json-file',
        Config: {
          'max-size': '256k',
          'max-file': '1',
        },
      },
    },
  };
}

function scheduleKill(containerId: string, ttlSeconds: number): void {
  const timeout = setTimeout(() => {
    runningTimeouts.delete(containerId);
    docker
      .killContainer(containerId)
      .catch((error) => {
        logger.warn('Failed to kill expired sandbox container', { containerId, error });
      })
      .finally(() => {
        docker.removeContainer(containerId).catch(() => {});
      });
  }, ttlSeconds * 1000);
  timeout.unref();
  runningTimeouts.set(containerId, timeout);
}

function clearKill(containerId: string): void {
  const timeout = runningTimeouts.get(containerId);
  if (timeout) clearTimeout(timeout);
  runningTimeouts.delete(containerId);
}

async function executeScript(params: SandboxRunnerExecuteScriptParams): Promise<SandboxRunnerExecutionResult> {
  const config = await containerConfig(params.policy, runtimeShell(params.policy.runtime, params.script));
  const containerId = await docker.createContainer(config);
  scheduleKill(containerId, params.policy.ttlSeconds);

  let timedOut = false;
  try {
    await docker.startContainer(containerId);
    const exitCode = await docker
      .waitContainer(containerId, params.policy.ttlSeconds * 1000 + 10_000)
      .catch(async (error) => {
        timedOut = true;
        await docker.killContainer(containerId).catch(() => {});
        throw error;
      });
    const output = truncateOutput(await docker.getContainerLogs(containerId));
    return {
      jobId: params.policy.jobId,
      containerId,
      exitCode,
      output,
      outputBytes: Buffer.byteLength(output),
      timedOut,
    };
  } finally {
    clearKill(containerId);
    await docker.removeContainer(containerId).catch(() => {});
  }
}

async function runProcess(params: SandboxRunnerRunProcessParams): Promise<SandboxRunnerProcessResult> {
  const containerId = await docker.createContainer(
    await containerConfig(params.policy, params.command, { openStdin: true })
  );
  await docker.startContainer(containerId);
  scheduleKill(containerId, params.policy.ttlSeconds);
  return {
    processId: containerId,
    jobId: params.policy.jobId,
    containerId,
    expiresAt: new Date(Date.now() + params.policy.ttlSeconds * 1000).toISOString(),
  };
}

async function fetchUrl(params: SandboxRunnerFetchParams): Promise<SandboxRunnerFetchResult> {
  const url = String(params.url ?? '').trim();
  if (!url) throw new Error('url is required');
  const { status, contentType, buffer } = await readResponseBodyCapped(url, FETCH_LIMIT_BYTES);
  return formatFetchedContent(url, status, contentType, buffer);
}

async function downloadArtifact(
  params: SandboxRunnerDownloadArtifactParams
): Promise<SandboxRunnerDownloadArtifactResult> {
  const url = String(params.url ?? '').trim();
  if (!url) throw new Error('url is required');
  const fallbackFilename = fallbackFilenameFromUrl(url);
  const artifactPath = resolveArtifactPath(params.path, fallbackFilename);
  const { status, contentType, buffer } = await readResponseBodyCapped(url, DOWNLOAD_LIMIT_BYTES);
  await docker.execInContainer(params.processId, ['sh', '-lc', `mkdir -p ${shellQuote(artifactPath.parentPath)}`]);
  await docker.putContainerArchive(
    params.processId,
    artifactPath.parentPath,
    createSingleFileTar(artifactPath.basename, buffer)
  );
  return {
    processId: params.processId,
    url,
    status,
    path: artifactPath.relativePath,
    sizeBytes: buffer.byteLength,
    contentType,
  };
}

async function readArtifactBytes(
  processId: string,
  rawPath: unknown,
  offsetInput: unknown,
  lengthInput: unknown,
  maxBytes: number
): Promise<{ path: string; totalBytes: number; offset: number; bytes: Buffer; eof: boolean }> {
  const artifactPath = resolveArtifactPath(rawPath);
  const offset =
    typeof offsetInput === 'number' && Number.isFinite(offsetInput) ? Math.max(0, Math.floor(offsetInput)) : 0;
  const requestedLength =
    typeof lengthInput === 'number' && Number.isFinite(lengthInput)
      ? Math.max(1, Math.floor(lengthInput))
      : Math.min(64 * 1024, maxBytes);
  const length = Math.min(requestedLength, maxBytes);
  const script = [
    'set -eu',
    `file=${shellQuote(artifactPath.absolutePath)}`,
    'test -f "$file"',
    'size=$(wc -c < "$file" | tr -d " ")',
    'printf "SIZE:%s\\n" "$size"',
    `dd if="$file" bs=1 skip=${offset} count=${length} 2>/dev/null | base64`,
  ].join('\n');
  const result = await docker.execInContainer(processId, ['sh', '-lc', script]);
  if (result.exitCode !== 0) throw new Error(`artifact read failed: ${result.output}`);
  const separator = result.output.indexOf('\n');
  if (separator === -1 || !result.output.startsWith('SIZE:'))
    throw new Error('artifact read returned malformed output');
  const totalBytes = Number(result.output.slice(5, separator).trim());
  const encoded = result.output.slice(separator + 1).replace(/\s+/g, '');
  const bytes = Buffer.from(encoded, 'base64');
  return {
    path: artifactPath.relativePath,
    totalBytes,
    offset,
    bytes,
    eof: offset + bytes.byteLength >= totalBytes,
  };
}

async function readArtifact(params: SandboxRunnerReadArtifactParams): Promise<SandboxRunnerReadArtifactResult> {
  const encoding = params.encoding === 'base64' ? 'base64' : 'utf8';
  const result = await readArtifactBytes(
    params.processId,
    params.path,
    params.offset,
    params.length,
    READ_ARTIFACT_LIMIT_BYTES
  );
  return {
    processId: params.processId,
    path: result.path,
    offset: result.offset,
    totalBytes: result.totalBytes,
    bytesRead: result.bytes.byteLength,
    eof: result.eof,
    encoding,
    ...(encoding === 'base64'
      ? { contentBase64: result.bytes.toString('base64') }
      : { content: result.bytes.toString('utf-8') }),
  };
}

async function sendArtifact(params: SandboxRunnerSendArtifactParams): Promise<SandboxRunnerSendArtifactResult> {
  const result = await readArtifactBytes(
    params.processId,
    params.path,
    0,
    SEND_ARTIFACT_LIMIT_BYTES + 1,
    SEND_ARTIFACT_LIMIT_BYTES + 1
  );
  if (result.totalBytes > SEND_ARTIFACT_LIMIT_BYTES || result.bytes.byteLength > SEND_ARTIFACT_LIMIT_BYTES) {
    throw new Error(`artifact is limited to ${SEND_ARTIFACT_LIMIT_BYTES} bytes for chat delivery`);
  }
  const filename = sanitizeArtifactFilename(params.filename ?? path.posix.basename(result.path));
  const mediaType = params.mediaType ?? 'application/octet-stream';
  const tempFilePath = path.join(os.tmpdir(), `gateway-sandbox-artifact-${randomUUID()}`);
  await fs.writeFile(tempFilePath, result.bytes, { mode: 0o600 });
  return {
    processId: params.processId,
    path: result.path,
    filename,
    mediaType,
    sizeBytes: result.bytes.byteLength,
    tempFilePath,
  };
}

async function readProcessOutput(params: SandboxRunnerReadOutputParams): Promise<SandboxRunnerReadOutputResult> {
  const output = truncateOutput(await docker.getContainerLogs(params.processId, { tail: params.tail ?? 200 }));
  return {
    processId: params.processId,
    output,
    outputBytes: Buffer.byteLength(output),
  };
}

async function writeProcessStdin(params: SandboxRunnerWriteStdinParams): Promise<SandboxRunnerWriteStdinResult> {
  const payload = Buffer.from(params.data);
  if (payload.byteLength > STDIN_LIMIT_BYTES) {
    throw new Error(`stdin payload is limited to ${STDIN_LIMIT_BYTES} bytes`);
  }

  const encoded = payload.toString('base64');
  await docker.execInContainer(params.processId, ['sh', '-lc', `printf '%s' '${encoded}' | base64 -d > /proc/1/fd/0`]);

  return {
    processId: params.processId,
    bytesWritten: payload.byteLength,
    closed: false,
    closeUnsupported: params.close === true ? true : undefined,
  };
}

async function killProcess(params: SandboxRunnerProcessParams): Promise<SandboxRunnerKillResult> {
  await docker.killContainer(params.processId);
  clearKill(params.processId);
  await docker.removeContainer(params.processId).catch(() => {});
  return { processId: params.processId, killed: true };
}

async function revokeUserSandboxAccess(params: SandboxRunnerRevokeUserParams): Promise<{ revoked: number }> {
  const containers = await docker.listContainersByLabel('gateway.sandbox=true');
  let revoked = 0;
  for (const container of containers) {
    if (container.Labels?.['gateway.sandbox.user_id'] !== params.userId) continue;
    const required = (container.Labels?.['gateway.sandbox.required_scopes'] ?? '').split(',').filter(Boolean);
    const stillAllowed = required.every((scope) => params.currentScopes.includes(scope));
    if (stillAllowed) continue;
    await docker.killContainer(container.Id).catch(() => {});
    clearKill(container.Id);
    revoked += 1;
  }
  return { revoked };
}

async function reconcileSandboxContainers(): Promise<{ removed: number }> {
  const containers = await docker.listContainersByLabel('gateway.sandbox=true');
  const now = Date.now();
  let removed = 0;

  for (const container of containers) {
    const expiresAt = container.Labels?.['gateway.sandbox.expires_at'];
    if (!expiresAt) {
      logger.warn('Removing sandbox container without expiry label', { containerId: container.Id });
    } else if (Date.parse(expiresAt) > now) {
      continue;
    }

    await docker.killContainer(container.Id).catch(() => {});
    await docker.removeContainer(container.Id).catch(() => {});
    clearKill(container.Id);
    removed += 1;
  }

  return { removed };
}

async function handle(request: SandboxRunnerRequest): Promise<unknown> {
  switch (request.method) {
    case 'health':
      return { ok: true, version: 1 } satisfies SandboxRunnerHealth;
    case 'executeScript':
      return executeScript(request.params as SandboxRunnerExecuteScriptParams);
    case 'runProcess':
      return runProcess(request.params as SandboxRunnerRunProcessParams);
    case 'fetch':
      return fetchUrl(request.params as SandboxRunnerFetchParams);
    case 'downloadArtifact':
      return downloadArtifact(request.params as SandboxRunnerDownloadArtifactParams);
    case 'readArtifact':
      return readArtifact(request.params as SandboxRunnerReadArtifactParams);
    case 'sendArtifact':
      return sendArtifact(request.params as SandboxRunnerSendArtifactParams);
    case 'readProcessOutput':
      return readProcessOutput(request.params as SandboxRunnerReadOutputParams);
    case 'writeProcessStdin': {
      const params = request.params as SandboxRunnerWriteStdinParams;
      return writeProcessStdin(params);
    }
    case 'killProcess':
      return killProcess(request.params as SandboxRunnerProcessParams);
    case 'revokeUserSandboxAccess':
      return revokeUserSandboxAccess(request.params as SandboxRunnerRevokeUserParams);
    case 'reconcile':
      return reconcileSandboxContainers();
    default:
      throw new Error(`Unsupported sandbox runner method: ${request.method}`);
  }
}

async function writeResponse(socket: net.Socket, response: SandboxRunnerResponse): Promise<void> {
  socket.write(`${JSON.stringify(response)}\n`);
}

async function main(): Promise<void> {
  await fs.unlink(SOCKET_PATH).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });

  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        void (async () => {
          let id: string = randomUUID();
          try {
            const request = JSON.parse(line) as SandboxRunnerRequest;
            id = request.id;
            const result = await handle(request);
            await writeResponse(socket, { id, result });
          } catch (error) {
            await writeResponse(socket, { id, error: error instanceof Error ? error.message : String(error) });
          }
        })();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(SOCKET_PATH, () => {
      server.off('error', reject);
      resolve();
    });
  });
  await fs.chmod(SOCKET_PATH, 0o600).catch(() => {});
  logger.info('Sandbox runner listening', { socketPath: SOCKET_PATH });

  const reconcileTimer = setInterval(() => {
    reconcileSandboxContainers().catch((error) => {
      logger.warn('Sandbox reconciliation failed', { error });
    });
  }, RECONCILE_INTERVAL_MS);
  reconcileTimer.unref();

  const shutdown = () => {
    logger.info('Sandbox runner shutting down');
    clearInterval(reconcileTimer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  logger.error('Sandbox runner failed', { error });
  process.exit(1);
});
