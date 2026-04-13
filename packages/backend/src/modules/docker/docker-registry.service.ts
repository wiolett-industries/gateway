import { desc, eq, or } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { dockerRegistries } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { buildWhere } from '@/lib/utils.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { CryptoService } from '@/services/crypto.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';

const logger = createChildLogger('DockerRegistryService');

export class DockerRegistryService {
  private eventBus?: EventBusService;

  constructor(
    private db: DrizzleClient,
    private auditService: AuditService,
    private cryptoService: CryptoService,
    private nodeDispatch: NodeDispatchService
  ) {}

  setEventBus(bus: EventBusService) {
    this.eventBus = bus;
  }

  private emitRegistry(id: string, action: string) {
    this.eventBus?.publish('docker.registry.changed', { id, action });
  }

  async list(nodeId?: string) {
    const conditions = [];
    if (nodeId) {
      // Return global registries + node-specific registries for this node
      conditions.push(or(eq(dockerRegistries.scope, 'global'), eq(dockerRegistries.nodeId, nodeId)));
    }
    const rows = await this.db
      .select()
      .from(dockerRegistries)
      .where(buildWhere(conditions))
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
    this.emitRegistry(row.id, 'created');
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
    this.emitRegistry(id, 'updated');
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

    this.emitRegistry(id, 'deleted');
  }

  async testConnection(id: string) {
    const [row] = await this.db.select().from(dockerRegistries).where(eq(dockerRegistries.id, id)).limit(1);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Docker registry not found');

    try {
      const baseUrl = row.url.replace(/\/+$/, '');
      const v2Url = `${baseUrl}/v2/`;
      const basicAuth =
        row.username && row.encryptedPassword
          ? `Basic ${Buffer.from(`${row.username}:${this.decryptPassword(row.encryptedPassword)}`).toString('base64')}`
          : '';

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        // Step 1: Hit /v2/ to check if registry is reachable
        const headers: Record<string, string> = {};
        if (basicAuth) headers.Authorization = basicAuth;
        const response = await fetch(v2Url, { headers, signal: controller.signal });

        if (response.ok) {
          return { success: true, status: response.status, statusText: 'OK' };
        }

        // Step 2: If 401 with Bearer challenge, do Docker token exchange
        if (response.status === 401 && basicAuth) {
          const wwwAuth = response.headers.get('www-authenticate') || '';
          const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
          const serviceMatch = wwwAuth.match(/service="([^"]+)"/);

          if (realmMatch) {
            const tokenUrl = new URL(realmMatch[1]);
            if (serviceMatch) tokenUrl.searchParams.set('service', serviceMatch[1]);
            const tokenResp = await fetch(tokenUrl.toString(), {
              headers: { Authorization: basicAuth },
              signal: controller.signal,
            });
            if (tokenResp.ok) {
              return { success: true, status: 200, statusText: 'Authenticated (token exchange)' };
            }
            return {
              success: false,
              status: tokenResp.status,
              statusText: `Authentication failed: ${tokenResp.statusText}`,
            };
          }

          // No Bearer challenge — plain 401
          return { success: false, status: 401, statusText: 'Authentication failed' };
        }

        return { success: false, status: response.status, statusText: response.statusText };
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

  async testConnectionDirect(url: string, username?: string, password?: string) {
    try {
      const baseUrl = url.replace(/\/+$/, '');
      const v2Url = `${baseUrl}/v2/`;
      const basicAuth =
        username && password ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` : '';

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const headers: Record<string, string> = {};
        if (basicAuth) headers.Authorization = basicAuth;
        const response = await fetch(v2Url, { headers, signal: controller.signal });

        if (response.ok) {
          return { success: true, status: response.status, statusText: 'OK' };
        }

        if (response.status === 401 && basicAuth) {
          const wwwAuth = response.headers.get('www-authenticate') || '';
          const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
          const serviceMatch = wwwAuth.match(/service="([^"]+)"/);

          if (realmMatch) {
            const tokenUrl = new URL(realmMatch[1]);
            if (serviceMatch) tokenUrl.searchParams.set('service', serviceMatch[1]);
            const tokenResp = await fetch(tokenUrl.toString(), {
              headers: { Authorization: basicAuth },
              signal: controller.signal,
            });
            if (tokenResp.ok) {
              return { success: true, status: 200, statusText: 'Authenticated (token exchange)' };
            }
            return { success: false, status: tokenResp.status, statusText: 'Authentication failed' };
          }
          return { success: false, status: 401, statusText: 'Authentication failed' };
        }

        return { success: false, status: response.status, statusText: response.statusText };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Connection failed' };
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

  /**
   * Get base64-encoded Docker auth JSON for a registry (for image pull).
   * Returns the registry URL and auth string, or null if not found.
   */
  async getAuthForPull(registryId: string): Promise<{ url: string; authJson: string } | null> {
    const [row] = await this.db.select().from(dockerRegistries).where(eq(dockerRegistries.id, registryId)).limit(1);
    if (!row || !row.username || !row.encryptedPassword) return null;
    const password = this.decryptPassword(row.encryptedPassword);
    const authJson = Buffer.from(
      JSON.stringify({
        username: row.username,
        password,
        serveraddress: row.url,
      })
    ).toString('base64');
    return { url: row.url.replace(/^https?:\/\//, '').replace(/\/+$/, ''), authJson };
  }

  private decryptPassword(encryptedJson: string): string {
    const parsed = JSON.parse(encryptedJson) as { encryptedKey: string; encryptedDek: string };
    return this.cryptoService.decryptString(parsed);
  }
}
