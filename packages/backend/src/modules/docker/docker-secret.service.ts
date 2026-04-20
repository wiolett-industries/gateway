import { and, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { dockerSecrets } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { CryptoService } from '@/services/crypto.service.js';

const logger = createChildLogger('DockerSecretService');

const MASKED_VALUE = '••••••••';

export class DockerSecretService {
  constructor(
    private db: DrizzleClient,
    private auditService: AuditService,
    private cryptoService: CryptoService
  ) {}

  /**
   * List secrets for a container. Values are masked unless `reveal` is true.
   */
  async list(nodeId: string, containerName: string, reveal: boolean) {
    const rows = await this.db
      .select()
      .from(dockerSecrets)
      .where(and(eq(dockerSecrets.nodeId, nodeId), eq(dockerSecrets.containerName, containerName)));

    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      value: reveal ? this.decrypt(row.encryptedValue) : MASKED_VALUE,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * Create a new secret for a container.
   */
  async create(nodeId: string, containerName: string, key: string, value: string, userId: string) {
    const encrypted = this.cryptoService.encryptString(value);
    const encryptedValue = JSON.stringify(encrypted);

    const [row] = await this.db
      .insert(dockerSecrets)
      .values({ nodeId, containerName, key, encryptedValue })
      .onConflictDoUpdate({
        target: [dockerSecrets.nodeId, dockerSecrets.containerName, dockerSecrets.key],
        set: { encryptedValue, updatedAt: new Date() },
      })
      .returning();

    await this.auditService.log({
      action: 'docker.secret.create',
      userId,
      resourceType: 'docker-secret',
      resourceId: row.id,
      details: { nodeId, containerName, key },
    });

    logger.debug('Secret created', { nodeId, containerName, key });
    return { id: row.id, key: row.key, value: MASKED_VALUE, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  /**
   * Update an existing secret's value.
   */
  async update(id: string, nodeId: string, value: string, userId: string) {
    const [existing] = await this.db.select().from(dockerSecrets).where(eq(dockerSecrets.id, id)).limit(1);
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Secret not found');
    if (existing.nodeId !== nodeId) {
      throw new AppError(404, 'NOT_FOUND', 'Secret not found');
    }

    const encrypted = this.cryptoService.encryptString(value);
    const encryptedValue = JSON.stringify(encrypted);

    const [row] = await this.db
      .update(dockerSecrets)
      .set({ encryptedValue, updatedAt: new Date() })
      .where(eq(dockerSecrets.id, id))
      .returning();

    await this.auditService.log({
      action: 'docker.secret.update',
      userId,
      resourceType: 'docker-secret',
      resourceId: id,
      details: { nodeId: existing.nodeId, containerName: existing.containerName, key: existing.key },
    });

    return { id: row.id, key: row.key, value: MASKED_VALUE, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  /**
   * Delete a secret.
   */
  async delete(id: string, nodeId: string, userId: string) {
    const [existing] = await this.db.select().from(dockerSecrets).where(eq(dockerSecrets.id, id)).limit(1);
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Secret not found');
    if (existing.nodeId !== nodeId) {
      throw new AppError(404, 'NOT_FOUND', 'Secret not found');
    }

    await this.db.delete(dockerSecrets).where(eq(dockerSecrets.id, id));

    await this.auditService.log({
      action: 'docker.secret.delete',
      userId,
      resourceType: 'docker-secret',
      resourceId: id,
      details: { nodeId: existing.nodeId, containerName: existing.containerName, key: existing.key },
    });
  }

  /**
   * Get decrypted secrets as a key-value map. Used internally during container create/recreate.
   */
  async getDecryptedMap(nodeId: string, containerName: string): Promise<Record<string, string>> {
    const rows = await this.db
      .select()
      .from(dockerSecrets)
      .where(and(eq(dockerSecrets.nodeId, nodeId), eq(dockerSecrets.containerName, containerName)));

    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key] = this.decrypt(row.encryptedValue);
    }
    return map;
  }

  /**
   * Get the set of secret key names for a container (for stripping from env responses).
   */
  async getSecretKeys(nodeId: string, containerName: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ key: dockerSecrets.key })
      .from(dockerSecrets)
      .where(and(eq(dockerSecrets.nodeId, nodeId), eq(dockerSecrets.containerName, containerName)));

    return new Set(rows.map((r) => r.key));
  }

  /**
   * Copy secrets from one container name to another (used for duplicate).
   */
  async copySecrets(nodeId: string, fromName: string, toName: string, userId: string) {
    const secrets = await this.getDecryptedMap(nodeId, fromName);
    for (const [key, value] of Object.entries(secrets)) {
      await this.create(nodeId, toName, key, value, userId).catch(() => {});
    }
  }

  private decrypt(encryptedJson: string): string {
    const parsed = JSON.parse(encryptedJson) as { encryptedKey: string; encryptedDek: string };
    return this.cryptoService.decryptString(parsed);
  }
}
