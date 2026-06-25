import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AISandboxRunnerService } from './ai.sandbox-runner.service.js';
import type { SandboxRunnerJobPolicy } from './ai.sandbox-runner.protocol.js';

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    execFileSync('docker', ['image', 'inspect', 'alpine:3.20'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeIfDocker = dockerAvailable() ? describe : describe.skip;

describeIfDocker('AISandboxRunnerService docker smoke', () => {
  let tempDir = '';
  let runner: AISandboxRunnerService | null = null;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'gateway-sandbox-runner-test-'));
  });

  afterEach(async () => {
    await runner?.stop().catch(() => {});
    runner = null;
    cleanupTestContainers();
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('runs through the unix socket, keeps containers offline, and moves artifacts without chat base64', async () => {
    const socketPath = path.join(tempDir, 'runner.sock');
    runner = new AISandboxRunnerService(socketPath);

    const policy = makePolicy('script-smoke', 'script', 30);
    const scriptResult = await runner.executeScript({
      policy,
      script: [
        'echo hello-sandbox',
        'echo file-content > result.txt',
        'wget -qO- https://example.com >/tmp/network.out 2>/tmp/network.err && exit 42 || true',
      ].join('\n'),
    });

    expect(scriptResult.exitCode).toBe(0);
    expect(scriptResult.output).toContain('hello-sandbox');

    const processResult = await runner.runProcess({
      policy: makePolicy('process-smoke', 'process', 30),
      command: ['sh', '-lc', 'echo process-ready | tee result.txt; sleep 20'],
    });

    const readResult = await runner.readArtifact({
      processId: processResult.processId,
      path: 'result.txt',
      encoding: 'utf8',
    });
    expect(readResult.content).toBe('process-ready\n');
    expect(readResult.contentBase64).toBeUndefined();

    const sendResult = await runner.sendArtifact({
      processId: processResult.processId,
      path: 'result.txt',
      filename: 'result.txt',
      mediaType: 'text/plain',
    });
    expect(sendResult.tempFilePath).toContain('gateway-sandbox-artifact-');
    expect(await readFile(sendResult.tempFilePath, 'utf8')).toBe('process-ready\n');
    expect((await stat(sendResult.tempFilePath)).size).toBe(sendResult.sizeBytes);
    await rm(sendResult.tempFilePath, { force: true });

    const output = await runner.readProcessOutput({ processId: processResult.processId, tail: 20 });
    expect(output.output).toContain('process-ready');

    const killed = await runner.killProcess({ processId: processResult.processId });
    expect(killed.killed).toBe(true);
  }, 60_000);
});

function cleanupTestContainers(): void {
  try {
    const ids = execFileSync('docker', [
      'ps',
      '-aq',
      '--filter',
      'label=gateway.sandbox=true',
      '--filter',
      'label=gateway.sandbox.user_id=test-user',
    ])
      .toString('utf-8')
      .trim()
      .split('\n')
      .filter(Boolean);
    if (ids.length > 0) {
      execFileSync('docker', ['rm', '-f', ...ids], { stdio: 'ignore' });
    }
  } catch {
    // Best-effort cleanup only; test assertions should surface functional failures.
  }
}

function makePolicy(jobId: string, kind: 'script' | 'process', ttlSeconds: number): SandboxRunnerJobPolicy {
  return {
    jobId,
    userId: 'test-user',
    conversationId: 'test-conversation',
    kind,
    runtime: 'alpine',
    tier: 'low',
    ttlSeconds,
    requiredScopes: ['ai:sandbox:use'],
    cpuQuota: 10_000,
    memoryBytes: 256 * 1024 * 1024,
    workspaceBytes: 64 * 1024 * 1024,
    pidsLimit: 64,
  };
}
