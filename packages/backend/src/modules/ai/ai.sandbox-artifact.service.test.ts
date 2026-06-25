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
    } as never);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('stores artifacts on disk, gates downloads by owner, and cleans orphaned files', async () => {
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
    const listed = await service.listForUser('user-1');
    expect(listed).toMatchObject([
      {
        id: artifact.id,
        filename: 'result.txt',
        conversationId: 'conversation-1',
        downloadUrl: `/api/ai/sandbox/artifacts/${artifact.id}/download`,
      },
    ]);
    expect(listed[0]).not.toHaveProperty('expiresAt');

    const metaPath = path.join(tempDir, `${artifact.id}.json`);
    const metadata = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>;
    metadata.conversationId = null;
    await writeFile(metaPath, JSON.stringify(metadata));

    const orphanedStats = await service.getOrphanedStats();
    expect(orphanedStats).toEqual({
      count: 1,
      totalSizeBytes: Buffer.byteLength('artifact-body'),
    });

    const cleaned = await service.cleanOrphanedArtifacts();
    expect(cleaned.itemsCleaned).toBe(1);
    expect(cleaned.spaceFreedBytes).toBe(Buffer.byteLength('artifact-body'));
    await expect(stat(download.filePath)).rejects.toThrow();
    await expect(service.getDownload('user-1', artifact.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('deletes artifacts for a conversation', async () => {
    const firstTemp = path.join(tempDir, 'first.tmp');
    const secondTemp = path.join(tempDir, 'second.tmp');
    await writeFile(firstTemp, 'first-body');
    await writeFile(secondTemp, 'second-body');

    const first = await service.saveFromTempFile({
      userId: 'user-1',
      conversationId: 'conversation-1',
      sourceProcessId: 'process-1',
      sourcePath: 'first.txt',
      filename: 'first.txt',
      mediaType: 'text/plain',
      sizeBytes: Buffer.byteLength('first-body'),
      tempFilePath: firstTemp,
    });
    const second = await service.saveFromTempFile({
      userId: 'user-1',
      conversationId: 'conversation-2',
      sourceProcessId: 'process-2',
      sourcePath: 'second.txt',
      filename: 'second.txt',
      mediaType: 'text/plain',
      sizeBytes: Buffer.byteLength('second-body'),
      tempFilePath: secondTemp,
    });

    const result = await service.deleteForConversation('user-1', 'conversation-1');
    expect(result.itemsDeleted).toBe(1);
    expect(result.spaceFreedBytes).toBe(Buffer.byteLength('first-body'));
    await expect(service.getDownload('user-1', first.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await service.getDownload('user-1', second.id)).toBeTruthy();
  });

  it('syncs conversation artifacts and makes removed chat images orphaned for housekeeping', async () => {
    const kept = await service.saveFromBuffer({
      userId: 'user-1',
      conversationId: 'conversation-1',
      sourceProcessId: 'chat-upload',
      sourcePath: 'kept.png',
      filename: 'kept.png',
      mediaType: 'image/png',
      buffer: Buffer.from('kept-image'),
    });
    const removed = await service.saveFromBuffer({
      userId: 'user-1',
      conversationId: 'conversation-1',
      sourceProcessId: 'chat-upload',
      sourcePath: 'removed.png',
      filename: 'removed.png',
      mediaType: 'image/png',
      buffer: Buffer.from('removed-image'),
    });
    const newlyUploaded = await service.saveFromBuffer({
      userId: 'user-1',
      conversationId: null,
      sourceProcessId: 'chat-upload',
      sourcePath: 'new.png',
      filename: 'new.png',
      mediaType: 'image/png',
      buffer: Buffer.from('new-image'),
    });
    const otherConversation = await service.saveFromBuffer({
      userId: 'user-1',
      conversationId: 'conversation-2',
      sourceProcessId: 'chat-upload',
      sourcePath: 'other.png',
      filename: 'other.png',
      mediaType: 'image/png',
      buffer: Buffer.from('other-image'),
    });

    await service.syncConversationArtifacts('user-1', [kept.id, newlyUploaded.id], 'conversation-1');

    const listed = await service.listForUser('user-1');
    expect(listed.find((artifact) => artifact.id === kept.id)?.conversationId).toBe('conversation-1');
    expect(listed.find((artifact) => artifact.id === newlyUploaded.id)?.conversationId).toBe('conversation-1');
    expect(listed.find((artifact) => artifact.id === removed.id)?.conversationId).toBeNull();
    expect(listed.find((artifact) => artifact.id === otherConversation.id)?.conversationId).toBe('conversation-2');

    const orphanedStats = await service.getOrphanedStats();
    expect(orphanedStats).toEqual({
      count: 1,
      totalSizeBytes: Buffer.byteLength('removed-image'),
    });

    const cleaned = await service.cleanOrphanedArtifacts();
    expect(cleaned.itemsCleaned).toBe(1);
    await expect(service.getDownload('user-1', removed.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await service.getDownload('user-1', kept.id)).toBeTruthy();
    expect(await service.getDownload('user-1', newlyUploaded.id)).toBeTruthy();
    expect(await service.getDownload('user-1', otherConversation.id)).toBeTruthy();
  });

  it('uses a writable local artifact directory for the production default outside production', async () => {
    const localService = new AISandboxArtifactService({
      NODE_ENV: 'development',
      AI_SANDBOX_ARTIFACT_DIR: '/var/lib/gateway/ai-artifacts',
    } as never);
    const tempFilePath = path.join(tempDir, 'local-default-source.tmp');
    await writeFile(tempFilePath, 'local-artifact-body');

    const artifact = await localService.saveFromTempFile({
      userId: 'user-1',
      conversationId: 'conversation-1',
      sourceProcessId: 'process-1',
      sourcePath: 'result.txt',
      filename: 'result.txt',
      mediaType: 'text/plain',
      sizeBytes: Buffer.byteLength('local-artifact-body'),
      tempFilePath,
    });

    const download = await localService.getDownload('user-1', artifact.id);
    expect(download.filePath).toContain(path.join(os.tmpdir(), 'gateway-ai-artifacts'));
    expect(await readFile(download.filePath, 'utf8')).toBe('local-artifact-body');

    await rm(download.filePath, { force: true });
    await rm(path.join(path.dirname(download.filePath), `${artifact.id}.json`), { force: true });
  });
});
