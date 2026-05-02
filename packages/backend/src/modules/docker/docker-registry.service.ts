import { and, desc, eq, or } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { dockerImageRegistryMappings, dockerRegistries } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { buildWhere } from '@/lib/utils.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { CryptoService } from '@/services/crypto.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';

const logger = createChildLogger('DockerRegistryService');

export interface DockerRegistryAuthCandidate {
  registryId: string;
  url: string;
  authJson: string;
}

interface RegistryConnectionTestResult {
  success: boolean;
  status?: number;
  statusText?: string;
  error?: string;
}

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
      trustedAuthRealm?: string;
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
        trustedAuthRealm: input.trustedAuthRealm?.trim() || null,
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
      trustedAuthRealm?: string;
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
    if (input.trustedAuthRealm !== undefined) updates.trustedAuthRealm = input.trustedAuthRealm.trim() || null;
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

    const basicAuth =
      row.username && row.encryptedPassword
        ? `Basic ${Buffer.from(`${row.username}:${this.decryptPassword(row.encryptedPassword)}`).toString('base64')}`
        : '';

    return this.testRegistryConnection(row.url, basicAuth, row.trustedAuthRealm);
  }

  async testConnectionDirect(url: string, username?: string, password?: string, trustedAuthRealm?: string) {
    const basicAuth = username && password ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` : '';
    return this.testRegistryConnection(url, basicAuth, trustedAuthRealm);
  }

  private normalizeRegistryBaseUrl(rawUrl: string): URL {
    const trimmed = rawUrl.trim().replace(/\/+$/, '');
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme);
  }

  private parseBearerChallenge(wwwAuthenticate: string): { realm: string | null; service: string | null } {
    const realmMatch = wwwAuthenticate.match(/realm="([^"]+)"/i);
    const serviceMatch = wwwAuthenticate.match(/service="([^"]+)"/i);
    return {
      realm: realmMatch?.[1] ?? null,
      service: serviceMatch?.[1] ?? null,
    };
  }

  private trustedRealmOrigin(rawRealm?: string | null): string | null {
    const trimmed = rawRealm?.trim();
    if (!trimmed) return null;

    try {
      const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const trustedUrl = new URL(withScheme);
      if (trustedUrl.protocol !== 'https:') return null;
      return trustedUrl.origin.toLowerCase();
    } catch {
      return null;
    }
  }

  private isAllowedBearerRealm(registryBaseUrl: URL, tokenUrl: URL, trustedAuthRealm?: string | null): boolean {
    if (tokenUrl.protocol !== 'https:') return false;
    const trustedOrigin = this.trustedRealmOrigin(trustedAuthRealm);
    if (trustedOrigin && tokenUrl.origin.toLowerCase() === trustedOrigin) return true;

    if (tokenUrl.hostname.toLowerCase() !== registryBaseUrl.hostname.toLowerCase()) return false;

    const registryPort = registryBaseUrl.port || (registryBaseUrl.protocol === 'https:' ? '443' : registryBaseUrl.port);
    const tokenPort = tokenUrl.port || '443';

    return registryPort === tokenPort;
  }

  private async testRegistryConnection(
    rawUrl: string,
    basicAuth: string,
    trustedAuthRealm?: string | null
  ): Promise<RegistryConnectionTestResult> {
    try {
      const baseUrl = this.normalizeRegistryBaseUrl(rawUrl);
      const basePath = baseUrl.pathname.replace(/\/+$/, '');
      const v2Url = new URL(`${basePath}/v2/`, baseUrl);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        // Step 1: Hit /v2/ to check if registry is reachable
        const headers: Record<string, string> = {};
        if (basicAuth) headers.Authorization = basicAuth;
        const response = await fetch(v2Url.toString(), { headers, signal: controller.signal });

        if (response.ok) {
          return { success: true, status: response.status, statusText: 'OK' };
        }

        // Step 2: If 401 with Bearer challenge, do Docker token exchange
        if (response.status === 401 && basicAuth) {
          const challenge = this.parseBearerChallenge(response.headers.get('www-authenticate') || '');

          if (challenge.realm) {
            let tokenUrl: URL;
            try {
              tokenUrl = new URL(challenge.realm);
            } catch {
              return { success: false, status: 401, statusText: 'Authentication failed: invalid Bearer realm' };
            }

            if (!this.isAllowedBearerRealm(baseUrl, tokenUrl, trustedAuthRealm)) {
              return {
                success: false,
                status: 401,
                statusText:
                  'Authentication failed: Bearer realm is not trusted for this registry. Configure a trusted token service origin if this registry uses a separate auth service.',
              };
            }

            if (challenge.service) tokenUrl.searchParams.set('service', challenge.service);
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

  private normalizeRegistryHost(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
      const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const url = new URL(withScheme);
      return url.host.toLowerCase();
    } catch {
      return trimmed
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .toLowerCase();
    }
  }

  private extractRegistryHostFromImageRef(imageRef: string): string | null {
    const firstSegment = imageRef.split('/')[0] ?? '';
    if (!firstSegment) return null;
    if (firstSegment === 'localhost' || firstSegment.includes('.') || firstSegment.includes(':')) {
      return firstSegment.toLowerCase();
    }
    return null;
  }

  /**
   * Get base64-encoded Docker auth JSON for a registry (for image pull).
   * Returns the registry URL and auth string, or null if not found.
   */
  async getAuthForPull(registryId: string): Promise<DockerRegistryAuthCandidate | null> {
    const [row] = await this.db.select().from(dockerRegistries).where(eq(dockerRegistries.id, registryId)).limit(1);
    return row ? this.authCandidateFromRegistry(row) : null;
  }

  async rememberImageRegistry(nodeId: string, imageRef: string, registryId?: string | null): Promise<void> {
    if (!registryId) return;
    const imageRepository = this.extractImageRepository(imageRef);
    if (!imageRepository) return;

    try {
      await this.db
        .insert(dockerImageRegistryMappings)
        .values({ nodeId, imageRepository, registryId })
        .onConflictDoUpdate({
          target: [dockerImageRegistryMappings.nodeId, dockerImageRegistryMappings.imageRepository],
          set: { registryId, updatedAt: new Date() },
        });
    } catch (error) {
      logger.warn('Failed to remember Docker image registry mapping', {
        nodeId,
        imageRepository,
        registryId,
        error,
      });
    }
  }

  extractImageRepository(imageRef: string): string {
    const withoutDigest = imageRef.trim().split('@')[0] ?? '';
    const lastSlash = withoutDigest.lastIndexOf('/');
    const lastColon = withoutDigest.lastIndexOf(':');
    if (lastColon > lastSlash) {
      return withoutDigest.slice(0, lastColon);
    }
    return withoutDigest;
  }

  private authCandidateFromRegistry(row: typeof dockerRegistries.$inferSelect): DockerRegistryAuthCandidate | null {
    if (!row.username || !row.encryptedPassword) return null;
    const password = this.decryptPassword(row.encryptedPassword);
    const authJson = Buffer.from(
      JSON.stringify({
        username: row.username,
        password,
        serveraddress: row.url,
      })
    ).toString('base64');
    return { registryId: row.id, url: row.url.replace(/^https?:\/\//, '').replace(/\/+$/, ''), authJson };
  }

  /**
   * Resolve registry auth either by explicit registryId or by inferring the registry
   * host from the image reference and matching it against saved registries visible
   * to the target node (global + node-specific).
   */
  async resolveAuthForImagePull(
    nodeId: string,
    imageRef: string,
    registryId?: string
  ): Promise<DockerRegistryAuthCandidate | null> {
    const [auth] = await this.resolveAuthCandidatesForImagePull(nodeId, imageRef, registryId);
    return auth ?? null;
  }

  async resolveAuthCandidatesForImagePull(
    nodeId: string,
    imageRef: string,
    registryId?: string
  ): Promise<DockerRegistryAuthCandidate[]> {
    if (registryId) {
      const auth = await this.getAuthForPull(registryId);
      return auth ? [auth] : [];
    }

    const imageRepository = this.extractImageRepository(imageRef);
    const imageRegistryHost = this.extractRegistryHostFromImageRef(imageRef);

    const rows = await this.db
      .select()
      .from(dockerRegistries)
      .where(or(eq(dockerRegistries.scope, 'global'), eq(dockerRegistries.nodeId, nodeId)));

    const candidates: DockerRegistryAuthCandidate[] = [];
    const mappedRegistryId = await this.resolveMappedRegistryId(nodeId, imageRepository);
    if (mappedRegistryId) {
      const mapped = rows.find((row) => row.id === mappedRegistryId);
      const auth = mapped ? this.authCandidateFromRegistry(mapped) : null;
      if (auth) candidates.push(auth);
    }

    if (!imageRegistryHost) return candidates;

    const seen = new Set(candidates.map((candidate) => candidate.registryId));
    for (const row of rows
      .filter((row) => this.normalizeRegistryHost(row.url) === imageRegistryHost)
      .filter((row) => !seen.has(row.id))) {
      const auth = this.authCandidateFromRegistry(row);
      if (!auth) continue;
      candidates.push({ ...auth, url: this.normalizeRegistryHost(row.url) });
      seen.add(row.id);
    }

    return candidates;
  }

  private async resolveMappedRegistryId(nodeId: string, imageRepository: string): Promise<string | null> {
    if (!imageRepository) return null;
    const [row] = await this.db
      .select({ registryId: dockerImageRegistryMappings.registryId })
      .from(dockerImageRegistryMappings)
      .where(
        and(
          eq(dockerImageRegistryMappings.nodeId, nodeId),
          eq(dockerImageRegistryMappings.imageRepository, imageRepository)
        )
      )
      .limit(1);

    return row?.registryId ?? null;
  }

  private decryptPassword(encryptedJson: string): string {
    const parsed = JSON.parse(encryptedJson) as { encryptedKey: string; encryptedDek: string };
    return this.cryptoService.decryptString(parsed);
  }
}
