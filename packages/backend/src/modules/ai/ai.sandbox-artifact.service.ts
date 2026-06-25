import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Env } from '@/config/env.js';
import { AppError } from '@/middleware/error-handler.js';

export interface AISandboxArtifactMetadata {
  id: string;
  userId: string;
  conversationId: string | null;
  sourceProcessId: string;
  sourcePath: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface AISandboxArtifactDownload {
  metadata: AISandboxArtifactMetadata;
  filePath: string;
}

export class AISandboxArtifactService {
  private readonly rootDir: string;
  private readonly retentionDays: number;

  constructor(env: Env) {
    this.rootDir = env.AI_SANDBOX_ARTIFACT_DIR;
    this.retentionDays = env.AI_SANDBOX_ARTIFACT_RETENTION_DAYS;
  }

  async saveFromTempFile(input: {
    userId: string;
    conversationId?: string | null;
    sourceProcessId: string;
    sourcePath: string;
    filename: string;
    mediaType: string;
    sizeBytes: number;
    tempFilePath: string;
  }): Promise<AISandboxArtifactMetadata & { downloadUrl: string }> {
    const id = randomUUID();
    const metadata: AISandboxArtifactMetadata = {
      id,
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      sourceProcessId: input.sourceProcessId,
      sourcePath: input.sourcePath,
      filename: sanitizeArtifactFilename(input.filename),
      mediaType: input.mediaType || 'application/octet-stream',
      sizeBytes: input.sizeBytes,
      createdAt: new Date().toISOString(),
    };

    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const filePath = this.filePath(id);
    const metaPath = this.metaPath(id);
    await fs.copyFile(input.tempFilePath, filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
    await fs.unlink(input.tempFilePath).catch(() => {});

    return {
      ...metadata,
      downloadUrl: `/api/ai/sandbox/artifacts/${encodeURIComponent(id)}/download`,
    };
  }

  async getDownload(userId: string, artifactId: string): Promise<AISandboxArtifactDownload> {
    const metadata = await this.readMetadata(artifactId);
    if (metadata.userId !== userId) {
      throw new AppError(403, 'SANDBOX_ARTIFACT_FORBIDDEN', 'You cannot access this sandbox artifact');
    }
    const filePath = this.filePath(metadata.id);
    await fs.access(filePath);
    return { metadata, filePath };
  }

  async cleanOldArtifacts(
    retentionDays = this.retentionDays
  ): Promise<{ itemsCleaned: number; spaceFreedBytes: number }> {
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const entries = await fs.readdir(this.rootDir).catch(() => []);
    const threshold = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let itemsCleaned = 0;
    let spaceFreedBytes = 0;

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const id = entry.slice(0, -5);
      const metaPath = this.metaPath(id);
      let createdAt = 0;
      try {
        const metadata = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as Partial<AISandboxArtifactMetadata>;
        createdAt = Date.parse(metadata.createdAt ?? '');
      } catch {
        createdAt = 0;
      }
      if (createdAt > threshold) continue;

      const filePath = this.filePath(id);
      const size = await fs
        .stat(filePath)
        .then((stat) => stat.size)
        .catch(() => 0);
      await fs.unlink(filePath).catch(() => {});
      await fs.unlink(metaPath).catch(() => {});
      itemsCleaned += 1;
      spaceFreedBytes += size;
    }

    const remainingEntries: string[] = await fs.readdir(this.rootDir).catch(() => []);
    for (const entry of remainingEntries) {
      if (!entry.endsWith('.bin')) continue;
      const id = entry.slice(0, -4);
      if (!/^[0-9a-f-]{36}$/.test(id)) continue;
      if (remainingEntries.includes(`${id}.json`)) continue;
      const filePath = this.filePath(id);
      const stats = await fs.stat(filePath).catch(() => null);
      if (!stats || stats.mtime.getTime() > threshold) continue;
      await fs.unlink(filePath).catch(() => {});
      itemsCleaned += 1;
      spaceFreedBytes += stats.size;
    }

    return { itemsCleaned, spaceFreedBytes };
  }

  private async readMetadata(artifactId: string): Promise<AISandboxArtifactMetadata> {
    const id = assertArtifactId(artifactId);
    try {
      const metadata = JSON.parse(await fs.readFile(this.metaPath(id), 'utf-8')) as AISandboxArtifactMetadata;
      if (metadata.id !== id) throw new Error('artifact metadata id mismatch');
      return metadata;
    } catch {
      throw new AppError(404, 'SANDBOX_ARTIFACT_NOT_FOUND', 'Sandbox artifact not found');
    }
  }

  private filePath(id: string): string {
    return path.join(this.rootDir, `${assertArtifactId(id)}.bin`);
  }

  private metaPath(id: string): string {
    return path.join(this.rootDir, `${assertArtifactId(id)}.json`);
  }
}

function assertArtifactId(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    throw new AppError(400, 'INVALID_SANDBOX_ARTIFACT_ID', 'Invalid sandbox artifact id');
  }
  return id;
}

function sanitizeArtifactFilename(value: string): string {
  const cleaned = value.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'artifact.bin';
}
