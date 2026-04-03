import { and, desc, eq, or } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { dockerRegistries } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { CryptoService } from '@/services/crypto.service.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';

const logger = createChildLogger('DockerRegistryService');

export class DockerRegistryService {
  constructor(
    private db: DrizzleClient,
    private auditService: AuditService,
    private cryptoService: CryptoService,
    private nodeDispatch: NodeDispatchService
  ) {}

  async list(nodeId?: string) {
    const conditions = [];
    if (nodeId) {
      // Return global registries + node-specific registries for this node
      conditions.push(or(eq(dockerRegistries.scope, 'global'), eq(dockerRegistries.nodeId, nodeId)));
    }
    const rows = await this.db
      .select()
      .from(dockerRegistries)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(dockerRegistries.createdAt));

    // Strip encrypted passwords from list responses
    return rows.map(({ encryptedPassword: _ep, ...rest }) => rest);
  }

  async get(id: string) {
    const [row] = await this.db.select().from(dockerRegistries).where(eq(dockerRegistries.id, id)).limit(1);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Docker registry not found');
    // Strip encrypted password from response
    const { encryptedPassword: _ep, ...safe } = row;
    return safe;
  }

  async create(
    input: {
      name: string;
      url: string;
      username?: string;
      password?: string;
      scope: string;
      nodeId?: string;
    },
    userId: string
  ) {
    let encryptedPassword: string | null = null;
    if (input.password) {
      const encrypted = this.cryptoService.encryptString(input.password);
      // Store as JSON containing both components needed for decryption
      encryptedPassword = JSON.stringify(encrypted);
    }

    const [row] = await this.db
      .insert(dockerRegistries)
      .values({
        name: input.name,
        url: input.url,
        username: input.username ?? null,
        encryptedPassword,
        scope: input.scope,
        nodeId: input.nodeId ?? null,
      })
      .returning();

    await this.auditService.log({
      action: 'docker.registry.create',
      userId,
      resourceType: 'docker-registry',
      resourceId: row.id,
      details: { name: input.name, url: input.url, scope: input.scope },
    });

    const { encryptedPassword: _ep, ...safe } = row;
    return safe;
  }

  async update(
    id: string,
    input: {
      name?: string;
      url?: string;
      username?: string;
      password?: string;
      scope?: string;
      nodeId?: string;
    },
    userId: string
  ) {
    // Verify exists
    await this.get(id);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.url !== undefined) updates.url = input.url;
    if (input.username !== undefined) updates.username = input.username;
    if (input.scope !== undefined) updates.scope = input.scope;
    if (input.nodeId !== undefined) updates.nodeId = input.nodeId;

    if (input.password !== undefined) {
      if (input.password) {
        const encrypted = this.cryptoService.encryptString(input.password);
        updates.encryptedPassword = JSON.stringify(encrypted);
      } else {
        updates.encryptedPassword = null;
      }
    }

    const [row] = await this.db.update(dockerRegistries).set(updates).where(eq(dockerRegistries.id, id)).returning();

    await this.auditService.log({
      action: 'docker.registry.update',
      userId,
      resourceType: 'docker-registry',
      resourceId: id,
      details: { name: input.name, url: input.url },
    });

    const { encryptedPassword: _ep, ...safe } = row;
    return safe;
  }

  async delete(id: string, userId: string) {
    const registry = await this.get(id);

    await this.db.delete(dockerRegistries).where(eq(dockerRegistries.id, id));

    await this.auditService.log({
      action: 'docker.registry.delete',
      userId,
      resourceType: 'docker-registry',
      resourceId: id,
      details: { name: registry.name },
    });
  }

  async testConnection(id: string) {
    const [row] = await this.db.select().from(dockerRegistries).where(eq(dockerRegistries.id, id)).limit(1);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Docker registry not found');

    try {
      // Build URL for registry v2 API check
      const baseUrl = row.url.replace(/\/+$/, '');
      const url = `${baseUrl}/v2/`;

      const headers: Record<string, string> = {};
      if (row.username && row.encryptedPassword) {
        const password = this.decryptPassword(row.encryptedPassword);
        headers.Authorization = `Basic ${Buffer.from(`${row.username}:${password}`).toString('base64')}`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url, { headers, signal: controller.signal });
        return {
          success: response.ok || response.status === 401, // 401 means the registry exists, just auth might differ
          status: response.status,
          statusText: response.statusText,
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Called when a docker node comes online: sync global + node-specific registries.
   */
  async syncRegistriesToNode(nodeId: string) {
    try {
      const rows = await this.db
        .select()
        .from(dockerRegistries)
        .where(or(eq(dockerRegistries.scope, 'global'), eq(dockerRegistries.nodeId, nodeId)));

      const registries = rows
        .filter((r) => r.username && r.encryptedPassword)
        .map((r) => ({
          url: r.url,
          username: r.username!,
          password: this.decryptPassword(r.encryptedPassword!),
        }));

      if (registries.length === 0) return;

      // Collect all unique registry URLs as allowlist
      const allowlist = rows.map((r) => r.url);

      await this.nodeDispatch.sendDockerConfigPush(nodeId, registries, allowlist);
      logger.info(`Synced ${registries.length} registries to node ${nodeId}`);
    } catch (error) {
      logger.error('Failed to sync registries to node', { nodeId, error });
    }
  }

  private decryptPassword(encryptedJson: string): string {
    const parsed = JSON.parse(encryptedJson) as { encryptedKey: string; encryptedDek: string };
    return this.cryptoService.decryptString(parsed);
  }
}
