import { and, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { dockerEnvVars } from '@/db/schema/index.js';
import type { CryptoService } from '@/services/crypto.service.js';

export class DockerEnvironmentService {
  constructor(
    private db: DrizzleClient,
    private cryptoService: CryptoService
  ) {}

  async getDecryptedMap(nodeId: string, containerName: string): Promise<Record<string, string>> {
    const rows = await this.db
      .select()
      .from(dockerEnvVars)
      .where(and(eq(dockerEnvVars.nodeId, nodeId), eq(dockerEnvVars.containerName, containerName)));

    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key] = this.decrypt(row.encryptedValue);
    }
    return map;
  }

  async replace(nodeId: string, containerName: string, env: Record<string, string>): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(dockerEnvVars)
        .where(and(eq(dockerEnvVars.nodeId, nodeId), eq(dockerEnvVars.containerName, containerName)));

      const entries = Object.entries(env);
      if (entries.length === 0) {
        return;
      }

      await tx.insert(dockerEnvVars).values(
        entries.map(([key, value]) => ({
          nodeId,
          containerName,
          key,
          encryptedValue: JSON.stringify(this.cryptoService.encryptString(value)),
        }))
      );
    });
  }

  async seedFromRuntimeIfMissing(nodeId: string, containerName: string, env: Record<string, string>): Promise<void> {
    if (Object.keys(env).length === 0) {
      return;
    }

    const existing = await this.db
      .select({ id: dockerEnvVars.id })
      .from(dockerEnvVars)
      .where(and(eq(dockerEnvVars.nodeId, nodeId), eq(dockerEnvVars.containerName, containerName)))
      .limit(1);

    if (existing.length > 0) {
      return;
    }

    await this.replace(nodeId, containerName, env);
  }

  async rename(nodeId: string, fromName: string, toName: string): Promise<void> {
    await this.db
      .update(dockerEnvVars)
      .set({ containerName: toName, updatedAt: new Date() })
      .where(and(eq(dockerEnvVars.nodeId, nodeId), eq(dockerEnvVars.containerName, fromName)));
  }

  async copy(nodeId: string, fromName: string, toName: string): Promise<void> {
    const env = await this.getDecryptedMap(nodeId, fromName);
    if (Object.keys(env).length === 0) {
      return;
    }
    await this.replace(nodeId, toName, env);
  }

  private decrypt(encryptedJson: string): string {
    const parsed = JSON.parse(encryptedJson) as { encryptedKey: string; encryptedDek: string };
    return this.cryptoService.decryptString(parsed);
  }
}
