import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AISandboxArtifactService } from './ai.sandbox-artifact.service.js';

describe('AISandboxArtifactService', () => {
  let tempDir = '';
  let service: AISandboxArtifactService;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'gateway-sandbox-artifacts-test-'));
    service = new AISandboxArtifactService({
      AI_SANDBOX_ARTIFACT_DIR: tempDir,
      AI_SANDBOX_ARTIFACT_RETENTION_DAYS: 7,
    } as never);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('stores artifacts on disk, gates downloads by owner, and cleans old files', async () => {
    const tempFilePath = path.join(tempDir, 'source.tmp');
    await writeFile(tempFilePath, 'artifact-body');

    const artifact = await service.saveFromTempFile({
      userId: 'user-1',
      conversationId: 'conversation-1',
      sourceProcessId: 'process-1',
      sourcePath: 'result.txt',
      filename: 'result.txt',
      mediaType: 'text/plain',
      sizeBytes: Buffer.byteLength('artifact-body'),
      tempFilePath,
    });

    expect(artifact.downloadUrl).toBe(`/api/ai/sandbox/artifacts/${artifact.id}/download`);
    const download = await service.getDownload('user-1', artifact.id);
    expect(await readFile(download.filePath, 'utf8')).toBe('artifact-body');
    await expect(service.getDownload('user-2', artifact.id)).rejects.toMatchObject({ statusCode: 403 });

    const metaPath = path.join(tempDir, `${artifact.id}.json`);
    const metadata = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>;
    metadata.createdAt = '2000-01-01T00:00:00.000Z';
    await writeFile(metaPath, JSON.stringify(metadata));

    const cleaned = await service.cleanOldArtifacts(7);
    expect(cleaned.itemsCleaned).toBe(1);
    expect(cleaned.spaceFreedBytes).toBe(Buffer.byteLength('artifact-body'));
    await expect(stat(download.filePath)).rejects.toThrow();
    await expect(service.getDownload('user-1', artifact.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});
