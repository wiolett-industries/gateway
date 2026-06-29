import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Env } from '@/config/env.js';
import { AppError } from '@/middleware/error-handler.js';

const PRODUCTION_ARTIFACT_DIR = '/var/lib/gateway/ai-artifacts';
const LOCAL_ARTIFACT_DIR = path.join(os.tmpdir(), 'gateway-ai-artifacts');

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

export interface AISandboxArtifactListItem extends AISandboxArtifactMetadata {
  downloadUrl: string;
}

export class AISandboxArtifactService {
  private readonly rootDir: string;

  constructor(env: Env) {
    this.rootDir =
      env.NODE_ENV !== 'production' && env.AI_SANDBOX_ARTIFACT_DIR === PRODUCTION_ARTIFACT_DIR
        ? LOCAL_ARTIFACT_DIR
        : env.AI_SANDBOX_ARTIFACT_DIR;
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

  async saveFromBuffer(input: {
    userId: string;
    conversationId?: string | null;
    sourceProcessId?: string;
    sourcePath?: string;
    filename: string;
    mediaType: string;
    buffer: Buffer;
  }): Promise<AISandboxArtifactMetadata & { downloadUrl: string }> {
    const id = randomUUID();
    const metadata: AISandboxArtifactMetadata = {
      id,
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      sourceProcessId: input.sourceProcessId ?? 'chat-upload',
      sourcePath: input.sourcePath ?? input.filename,
      filename: sanitizeArtifactFilename(input.filename),
      mediaType: input.mediaType || 'application/octet-stream',
      sizeBytes: input.buffer.byteLength,
      createdAt: new Date().toISOString(),
    };

    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const filePath = this.filePath(id);
    const metaPath = this.metaPath(id);
    await fs.writeFile(filePath, input.buffer, { mode: 0o600 });
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });

    return {
      ...metadata,
      downloadUrl: `/api/ai/sandbox/artifacts/${encodeURIComponent(id)}/download`,
    };
  }

  async syncConversationArtifacts(userId: string, artifactIds: string[], conversationId: string): Promise<void> {
    const activeIds = new Set(artifactIds.filter(isArtifactId));
    const artifacts = await this.readAllMetadata();

    await Promise.all(
      artifacts.map(async (metadata) => {
        if (metadata.userId !== userId) return;
        if (activeIds.has(metadata.id)) {
          if (metadata.conversationId && metadata.conversationId !== conversationId) return;
          if (metadata.conversationId === conversationId) return;
          await this.writeMetadata({ ...metadata, conversationId });
          return;
        }
        if (metadata.conversationId !== conversationId) return;
        await this.writeMetadata({ ...metadata, conversationId: null });
      })
    );
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

  async listForUser(userId: string): Promise<AISandboxArtifactListItem[]> {
    const artifacts = await this.readAllMetadata();
    return artifacts
      .filter((metadata) => metadata.userId === userId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((metadata) => this.toListItem(metadata));
  }

  async delete(userId: string, artifactId: string): Promise<boolean> {
    const metadata = await this.readMetadata(artifactId);
    if (metadata.userId !== userId) {
      throw new AppError(403, 'SANDBOX_ARTIFACT_FORBIDDEN', 'You cannot access this sandbox artifact');
    }
    await this.deleteFiles(metadata.id);
    return true;
  }

  async deleteForConversation(
    userId: string,
    conversationId: string
  ): Promise<{ itemsDeleted: number; spaceFreedBytes: number }> {
    const artifacts = await this.readAllMetadata();
    let itemsDeleted = 0;
    let spaceFreedBytes = 0;

    for (const metadata of artifacts) {
      if (metadata.userId !== userId || metadata.conversationId !== conversationId) continue;
      spaceFreedBytes += await this.fileSize(metadata.id);
      await this.deleteFiles(metadata.id);
      itemsDeleted += 1;
    }

    return { itemsDeleted, spaceFreedBytes };
  }

  async getOrphanedStats(): Promise<{ count: number; totalSizeBytes: number }> {
    const artifacts = await this.readAllMetadata();
    let count = 0;
    let totalSizeBytes = 0;

    for (const metadata of artifacts) {
      if (metadata.conversationId) continue;
      count += 1;
      totalSizeBytes += await this.fileSize(metadata.id);
    }

    return { count, totalSizeBytes };
  }

  async cleanOrphanedArtifacts(): Promise<{ itemsCleaned: number; spaceFreedBytes: number }> {
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const entries = await fs.readdir(this.rootDir).catch(() => []);
    let itemsCleaned = 0;
    let spaceFreedBytes = 0;

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const id = entry.slice(0, -5);
      if (!isArtifactId(id)) continue;
      const metaPath = this.metaPath(id);
      let metadata: Partial<AISandboxArtifactMetadata> | null = null;
      try {
        metadata = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as Partial<AISandboxArtifactMetadata>;
      } catch {
        metadata = null;
      }
      if (metadata?.conversationId) continue;

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
      if (!stats) continue;
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

  private async readAllMetadata(): Promise<AISandboxArtifactMetadata[]> {
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const entries = await fs.readdir(this.rootDir).catch(() => []);
    const artifacts: AISandboxArtifactMetadata[] = [];

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const metadata = JSON.parse(
          await fs.readFile(path.join(this.rootDir, entry), 'utf-8')
        ) as AISandboxArtifactMetadata;
        if (isArtifactId(metadata.id) && metadata.userId && metadata.filename && metadata.createdAt) {
          artifacts.push(metadata);
        }
      } catch {
        // Ignore corrupt metadata; housekeeping can remove orphaned files later.
      }
    }

    return artifacts;
  }

  private toListItem(metadata: AISandboxArtifactMetadata): AISandboxArtifactListItem {
    return {
      ...metadata,
      downloadUrl: `/api/ai/sandbox/artifacts/${encodeURIComponent(metadata.id)}/download`,
    };
  }

  private async fileSize(id: string): Promise<number> {
    return fs
      .stat(this.filePath(id))
      .then((stat) => stat.size)
      .catch(() => 0);
  }

  private async deleteFiles(id: string): Promise<void> {
    await fs.unlink(this.filePath(id)).catch(() => {});
    await fs.unlink(this.metaPath(id)).catch(() => {});
  }

  private async writeMetadata(metadata: AISandboxArtifactMetadata): Promise<void> {
    await fs.writeFile(this.metaPath(metadata.id), JSON.stringify(metadata, null, 2), { mode: 0o600 });
  }

  private filePath(id: string): string {
    return path.join(this.rootDir, `${assertArtifactId(id)}.bin`);
  }

  private metaPath(id: string): string {
    return path.join(this.rootDir, `${assertArtifactId(id)}.json`);
  }
}

function assertArtifactId(id: string): string {
  if (!isArtifactId(id)) {
    throw new AppError(400, 'INVALID_SANDBOX_ARTIFACT_ID', 'Invalid sandbox artifact id');
  }
  return id;
}

function isArtifactId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
}

function sanitizeArtifactFilename(value: string): string {
  const cleaned = value.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'artifact.bin';
}
