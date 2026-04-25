import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { count, eq, ilike, type SQL } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { certificates, nodes, proxyHosts } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { buildWhere } from '@/lib/utils.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { DaemonUpdateService } from '@/services/daemon-update.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { NodeRegistryService } from '@/services/node-registry.service.js';
import type { CreateNodeInput, NodeListQuery, UpdateNodeInput } from './nodes.schemas.js';

const logger = createChildLogger('NodesService');

export class NodesService {
  private daemonUpdateService?: DaemonUpdateService;

  constructor(
    private db: DrizzleClient,
    private auditService: AuditService,
    private registry: NodeRegistryService
  ) {}

  private eventBus?: EventBusService;
  setEventBus(bus: EventBusService) {
    this.eventBus = bus;
  }
  setDaemonUpdateService(service: DaemonUpdateService) {
    this.daemonUpdateService = service;
  }
  private emitNode(id: string, action: 'created' | 'updated' | 'deleted') {
    this.eventBus?.publish('node.changed', { id, action });
  }

  async list(query: NodeListQuery) {
    const conditions: SQL[] = [];

    if (query.search) {
      conditions.push(ilike(nodes.hostname, `%${query.search}%`));
    }
    if (query.type) {
      conditions.push(eq(nodes.type, query.type));
    }
    if (query.status) {
      conditions.push(eq(nodes.status, query.status));
    }

    const where = buildWhere(conditions);

    const [totalResult] = await this.db.select({ count: count() }).from(nodes).where(where);
    const total = totalResult?.count ?? 0;

    const offset = (query.page - 1) * query.limit;
    const rows = await this.db
      .select()
      .from(nodes)
      .where(where)
      .orderBy(nodes.createdAt)
      .limit(query.limit)
      .offset(offset);

    // Enrich with live connection status. The registry is authoritative for
    // command availability; DB status can lag until stale-node cleanup runs.
    const enriched = rows.map((row) => {
      const isConnected = !!this.registry.getNode(row.id);
      return {
        ...row,
        status: row.status === 'online' && !isConnected ? 'offline' : row.status,
        isConnected,
      };
    });

    return {
      data: enriched,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async get(id: string) {
    const [node] = await this.db.select().from(nodes).where(eq(nodes.id, id)).limit(1);

    if (!node) {
      throw new AppError(404, 'NOT_FOUND', 'Node not found');
    }

    const connectedNode = this.registry.getNode(id);
    const isConnected = !!connectedNode;

    return {
      ...node,
      status: node.status === 'online' && !isConnected ? 'offline' : node.status,
      isConnected,
      liveHealthReport: connectedNode?.lastHealthReport ?? null,
      liveStatsReport: connectedNode?.lastStatsReport ?? null,
    };
  }

  async create(input: CreateNodeInput, userId: string) {
    // Generate enrollment token
    const tokenRaw = `gw_node_${randomBytes(24).toString('hex')}`;
    const tokenHash = await bcrypt.hash(tokenRaw, 10);

    const [node] = await this.db
      .insert(nodes)
      .values({
        type: input.type,
        hostname: input.hostname,
        displayName: input.displayName,
        enrollmentTokenHash: tokenHash,
        status: 'pending',
      })
      .returning();

    await this.auditService.log({
      userId,
      action: 'node.create',
      resourceType: 'node',
      resourceId: node.id,
      details: { hostname: input.hostname, type: input.type },
    });

    logger.info('Node created', { nodeId: node.id, hostname: input.hostname });
    this.emitNode(node.id, 'created');

    return {
      node,
      enrollmentToken: tokenRaw, // Shown once only
    };
  }

  async update(id: string, input: UpdateNodeInput, userId: string) {
    if (this.daemonUpdateService && (await this.daemonUpdateService.isNodeUpdateInProgress(id))) {
      throw new AppError(409, 'NODE_UPDATING', 'Node daemon update is in progress');
    }

    const [existing] = await this.db.select().from(nodes).where(eq(nodes.id, id)).limit(1);

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Node not found');
    }

    const [updated] = await this.db
      .update(nodes)
      .set({
        displayName: input.displayName,
        updatedAt: new Date(),
      })
      .where(eq(nodes.id, id))
      .returning();

    await this.auditService.log({
      userId,
      action: 'node.update',
      resourceType: 'node',
      resourceId: id,
      details: { displayName: input.displayName },
    });
    this.emitNode(id, 'updated');

    return updated;
  }

  async remove(id: string, userId: string) {
    if (this.daemonUpdateService && (await this.daemonUpdateService.isNodeUpdateInProgress(id))) {
      throw new AppError(409, 'NODE_UPDATING', 'Node daemon update is in progress');
    }

    const [node] = await this.db.select().from(nodes).where(eq(nodes.id, id)).limit(1);

    if (!node) {
      throw new AppError(404, 'NOT_FOUND', 'Node not found');
    }

    // Check if any proxy hosts are assigned to this node
    const [hostCount] = await this.db.select({ count: count() }).from(proxyHosts).where(eq(proxyHosts.nodeId, id));

    if (hostCount && hostCount.count > 0) {
      throw new AppError(
        400,
        'NODE_HAS_HOSTS',
        `Cannot delete node with ${hostCount.count} assigned proxy host(s). Reassign or delete them first.`
      );
    }

    // Close gRPC stream if connected
    const connectedNode = this.registry.getNode(id);
    if (connectedNode) {
      connectedNode.commandStream.end();
      await this.registry.deregister(id);
    }

    // Revoke mTLS certificate if one was issued
    if (node.certificateSerial) {
      try {
        const [cert] = await this.db
          .select({ id: certificates.id })
          .from(certificates)
          .where(eq(certificates.serialNumber, node.certificateSerial))
          .limit(1);
        if (cert) {
          await this.db
            .update(certificates)
            .set({ status: 'revoked', revokedAt: new Date(), revocationReason: 'cessationOfOperation' })
            .where(eq(certificates.id, cert.id));
          logger.info('Revoked node mTLS certificate', { certSerial: node.certificateSerial });
        }
      } catch (err) {
        logger.warn('Failed to revoke node certificate', { error: (err as Error).message });
      }
    }

    await this.db.delete(nodes).where(eq(nodes.id, id));

    await this.auditService.log({
      userId,
      action: 'node.remove',
      resourceType: 'node',
      resourceId: id,
      details: { hostname: node.hostname },
    });

    logger.info('Node removed', { nodeId: id, hostname: node.hostname });
    this.emitNode(id, 'deleted');
  }
}
