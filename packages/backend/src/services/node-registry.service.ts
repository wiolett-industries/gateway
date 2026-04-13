import { randomUUID } from 'node:crypto';
import type { ServerDuplexStream } from '@grpc/grpc-js';
import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { nodes } from '@/db/schema/index.js';
import type { NodeHealthReport, NodeStatsReport } from '@/db/schema/nodes.js';
import type { CommandResult, DaemonMessage, GatewayCommand } from '@/grpc/generated/types.js';
import { createChildLogger } from '@/lib/logger.js';
import type { EventBusService } from '@/services/event-bus.service.js';

const logger = createChildLogger('NodeRegistry');

export interface ConnectedNode {
  nodeId: string;
  type: 'nginx' | 'bastion' | 'monitoring' | 'docker';
  hostname: string;
  commandStream: ServerDuplexStream<DaemonMessage, GatewayCommand>;
  logStream: ServerDuplexStream<unknown, unknown> | null;
  connectedAt: Date;
  lastHealthReport: NodeHealthReport | null;
  lastStatsReport: NodeStatsReport | null;
  lastTrafficStats: Record<string, unknown> | null;
  configVersionHash: string;
  pendingCommands: Map<
    string,
    {
      resolve: (result: CommandResult) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >;
}

export class NodeRegistryService {
  private nodes = new Map<string, ConnectedNode>();
  private execOutputHandlers = new Map<
    string,
    Set<(data: { execId: string; data: Buffer; exited: boolean; exitCode: number }) => void>
  >();
  private logStreamHandlers = new Map<string, (lines: string[], ended?: boolean) => void>();

  constructor(private db: DrizzleClient) {}

  private eventBus?: EventBusService;
  setEventBus(bus: EventBusService) {
    this.eventBus = bus;
  }

  registerExecHandler(execId: string, handler: (data: any) => void) {
    let handlers = this.execOutputHandlers.get(execId);
    if (!handlers) {
      handlers = new Set();
      this.execOutputHandlers.set(execId, handlers);
    }
    handlers.add(handler);
  }

  removeExecHandler(execId: string, handler?: (data: any) => void) {
    if (handler) {
      const handlers = this.execOutputHandlers.get(execId);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) this.execOutputHandlers.delete(execId);
      }
    } else {
      this.execOutputHandlers.delete(execId);
    }
  }

  getExecHandlerCount(execId: string): number {
    return this.execOutputHandlers.get(execId)?.size ?? 0;
  }

  handleExecOutput(execId: string, data: any) {
    const handlers = this.execOutputHandlers.get(execId);
    if (handlers) {
      for (const handler of handlers) handler(data);
    }
  }

  registerLogStreamHandler(key: string, handler: (lines: string[], ended?: boolean) => void) {
    this.logStreamHandlers.set(key, handler);
  }

  removeLogStreamHandler(key: string) {
    this.logStreamHandlers.delete(key);
  }

  handleLogStream(key: string, lines: string[], ended?: boolean) {
    const handler = this.logStreamHandlers.get(key);
    if (handler) handler(lines, ended);
  }

  async register(
    nodeId: string,
    type: 'nginx' | 'bastion' | 'monitoring' | 'docker',
    hostname: string,
    configVersionHash: string,
    commandStream: ServerDuplexStream<DaemonMessage, GatewayCommand>
  ): Promise<void> {
    // Reject duplicate connection — only one daemon per node ID allowed
    const existing = this.nodes.get(nodeId);
    if (existing) {
      logger.warn('Duplicate daemon connection rejected — another instance already connected', { nodeId, hostname });
      throw new Error(`Node ${nodeId} is already connected. Only one daemon instance per node is allowed.`);
    }

    this.nodes.set(nodeId, {
      nodeId,
      type,
      hostname,
      commandStream,
      logStream: null,
      connectedAt: new Date(),
      lastHealthReport: null,
      lastStatsReport: null,
      lastTrafficStats: null,
      configVersionHash,
      pendingCommands: new Map(),
    });

    await this.db
      .update(nodes)
      .set({
        status: 'online',
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(nodes.id, nodeId));

    logger.info('Node registered', { nodeId, type, hostname });
    this.eventBus?.publish('node.changed', { id: nodeId, action: 'updated', status: 'online', hostname });
  }

  async deregister(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) return; // Already removed (e.g., replaced by reconnect)

    this.cleanupPendingCommands(node);
    this.nodes.delete(nodeId);

    await this.db
      .update(nodes)
      .set({
        status: 'offline',
        updatedAt: new Date(),
      })
      .where(eq(nodes.id, nodeId));

    logger.info('Node deregistered', { nodeId });
    this.eventBus?.publish('node.changed', { id: nodeId, action: 'updated', status: 'offline', hostname: node.hostname });
  }

  getNode(nodeId: string): ConnectedNode | undefined {
    return this.nodes.get(nodeId);
  }

  getAllNodes(): ConnectedNode[] {
    return Array.from(this.nodes.values());
  }

  getNodesByType(type: 'nginx' | 'bastion' | 'monitoring' | 'docker'): ConnectedNode[] {
    return this.getAllNodes().filter((n) => n.type === type);
  }

  getConnectedNodeIds(): string[] {
    return Array.from(this.nodes.keys());
  }

  async sendCommand(nodeId: string, command: Partial<GatewayCommand>, timeoutMs = 30000): Promise<CommandResult> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} is not connected`);
    }

    const commandId = randomUUID();
    const fullCommand: GatewayCommand = {
      commandId,
      ...command,
    };

    return new Promise<CommandResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        node.pendingCommands.delete(commandId);
        reject(new Error(`Command ${commandId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      node.pendingCommands.set(commandId, { resolve, reject, timeout });

      node.commandStream.write(fullCommand, (err: Error | null | undefined) => {
        if (err) {
          clearTimeout(timeout);
          node.pendingCommands.delete(commandId);
          reject(new Error(`Failed to send command: ${err.message}`));
        }
      });
    });
  }

  /** Fire-and-forget: write a command to the stream without awaiting a response */
  sendCommandNoWait(nodeId: string, command: Partial<GatewayCommand>): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} is not connected`);
    }

    const fullCommand: GatewayCommand = {
      commandId: '',
      ...command,
    };

    node.commandStream.write(fullCommand, (err: Error | null | undefined) => {
      if (err) {
        logger.debug('Fire-and-forget write failed', { nodeId, error: err.message });
      }
    });
  }

  handleCommandResult(nodeId: string, result: CommandResult): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    const pending = node.pendingCommands.get(result.commandId);
    if (pending) {
      clearTimeout(pending.timeout);
      node.pendingCommands.delete(result.commandId);
      pending.resolve(result);
    }
  }

  updateHealthReport(nodeId: string, report: NodeHealthReport): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.lastHealthReport = report;
    }
  }

  updateStatsReport(nodeId: string, report: NodeStatsReport): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.lastStatsReport = report;
    }
  }

  async updateLastSeen(nodeId: string): Promise<void> {
    await this.db
      .update(nodes)
      .set({
        lastSeenAt: new Date(),
      })
      .where(eq(nodes.id, nodeId));
  }

  /** Mark nodes as offline if they haven't been seen recently */
  async markStaleNodesOffline(staleThresholdMs = 90000): Promise<void> {
    const now = Date.now();
    const connectedIds = this.getConnectedNodeIds();

    // For nodes that are in the DB as 'online' but not in our connected set
    // This handles ungraceful disconnects that the gRPC layer didn't catch
    const dbOnlineNodes = await this.db
      .select({ id: nodes.id, hostname: nodes.hostname, lastSeenAt: nodes.lastSeenAt })
      .from(nodes)
      .where(eq(nodes.status, 'online'));

    for (const dbNode of dbOnlineNodes) {
      if (!connectedIds.includes(dbNode.id)) {
        const lastSeen = dbNode.lastSeenAt?.getTime() ?? 0;
        if (now - lastSeen > staleThresholdMs) {
          await this.db
            .update(nodes)
            .set({
              status: 'offline',
              updatedAt: new Date(),
            })
            .where(eq(nodes.id, dbNode.id));
          logger.warn('Marked stale node as offline', { nodeId: dbNode.id });
          this.eventBus?.publish('node.changed', { id: dbNode.id, action: 'updated', status: 'offline', hostname: dbNode.hostname });
        }
      }
    }
  }

  private cleanupPendingCommands(node: ConnectedNode): void {
    for (const [id, pending] of node.pendingCommands) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Node disconnected'));
      node.pendingCommands.delete(id);
    }
  }
}
