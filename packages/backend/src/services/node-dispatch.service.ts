import { and, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { nodes } from '@/db/schema/index.js';
import type { CommandResult } from '@/grpc/generated/types.js';
import { createChildLogger } from '@/lib/logger.js';
import { AppError } from '@/middleware/error-handler.js';
import type { DaemonUpdateService } from './daemon-update.service.js';
import type { NodeRegistryService } from './node-registry.service.js';

const logger = createChildLogger('NodeDispatch');

export class NodeDispatchService {
  private daemonUpdateService?: DaemonUpdateService;

  constructor(
    private registry: NodeRegistryService,
    private db: DrizzleClient
  ) {}

  setDaemonUpdateService(service: DaemonUpdateService) {
    this.daemonUpdateService = service;
  }

  private async assertNodeMutable(nodeId: string) {
    if (this.daemonUpdateService && (await this.daemonUpdateService.isNodeUpdateInProgress(nodeId))) {
      throw new AppError(409, 'NODE_UPDATING', 'Node daemon update is in progress');
    }
  }

  async applyConfig(nodeId: string, hostId: string, configContent: string, testOnly = false): Promise<CommandResult> {
    await this.assertNodeMutable(nodeId);
    return this.registry.sendCommand(nodeId, {
      applyConfig: { hostId, configContent, testOnly },
    });
  }

  async removeConfig(nodeId: string, hostId: string): Promise<CommandResult> {
    await this.assertNodeMutable(nodeId);
    return this.registry.sendCommand(nodeId, {
      removeConfig: { hostId },
    });
  }

  async deployCertificate(
    nodeId: string,
    certId: string,
    certPem: Buffer,
    keyPem: Buffer,
    chainPem?: Buffer
  ): Promise<CommandResult> {
    await this.assertNodeMutable(nodeId);
    return this.registry.sendCommand(nodeId, {
      deployCert: {
        certId,
        certPem,
        keyPem,
        chainPem: chainPem ?? Buffer.alloc(0),
      },
    });
  }

  async removeCertificate(nodeId: string, certId: string): Promise<CommandResult> {
    await this.assertNodeMutable(nodeId);
    return this.registry.sendCommand(nodeId, {
      removeCert: { certId },
    });
  }

  async deployHtpasswd(nodeId: string, accessListId: string, content: string): Promise<CommandResult> {
    await this.assertNodeMutable(nodeId);
    return this.registry.sendCommand(nodeId, {
      deployHtpasswd: { accessListId, content },
    });
  }

  async removeHtpasswd(nodeId: string, accessListId: string): Promise<CommandResult> {
    await this.assertNodeMutable(nodeId);
    return this.registry.sendCommand(nodeId, {
      removeHtpasswd: { accessListId },
    });
  }

  async updateGlobalConfig(nodeId: string, content: string, backupContent: string): Promise<CommandResult> {
    await this.assertNodeMutable(nodeId);
    return this.registry.sendCommand(nodeId, {
      updateGlobalConfig: { content, backupContent },
    });
  }

  async testConfig(nodeId: string): Promise<CommandResult> {
    await this.assertNodeMutable(nodeId);
    return this.registry.sendCommand(
      nodeId,
      {
        testConfig: {},
      },
      10000
    );
  }

  async requestHealth(nodeId: string): Promise<CommandResult> {
    return this.registry.sendCommand(
      nodeId,
      {
        requestHealth: {},
      },
      10000
    );
  }

  async requestStats(nodeId: string): Promise<CommandResult> {
    return this.registry.sendCommand(
      nodeId,
      {
        requestStats: {},
      },
      10000
    );
  }

  async deployAcmeChallenge(nodeId: string, token: string, content: string): Promise<CommandResult> {
    await this.assertNodeMutable(nodeId);
    return this.registry.sendCommand(nodeId, {
      deployAcmeChallenge: { token, content },
    });
  }

  async removeAcmeChallenge(nodeId: string, token: string): Promise<CommandResult> {
    await this.assertNodeMutable(nodeId);
    return this.registry.sendCommand(nodeId, {
      removeAcmeChallenge: { token },
    });
  }

  async readGlobalConfig(nodeId: string): Promise<CommandResult> {
    return this.registry.sendCommand(nodeId, { readGlobalConfig: {} }, 10000);
  }

  async requestTrafficStats(nodeId: string, tailLines = 200): Promise<CommandResult> {
    return this.registry.sendCommand(nodeId, { requestTrafficStats: { tailLines } }, 10000);
  }

  async setDaemonLogStream(nodeId: string, enabled: boolean, minLevel = 'info', tailLines = 0): Promise<CommandResult> {
    return this.registry.sendCommand(nodeId, {
      setDaemonLogStream: { enabled, minLevel, tailLines },
    });
  }

  /** Send a pre-built FullSyncCommand to a node */
  async fullSync(
    nodeId: string,
    hosts: { hostId: string; configContent: string }[],
    certs: { certId: string; certPem: Buffer; keyPem: Buffer; chainPem: Buffer }[],
    globalConfig: string,
    htpasswdFiles: { accessListId: string; content: string }[],
    versionHash: string
  ): Promise<CommandResult> {
    await this.assertNodeMutable(nodeId);
    logger.info('Sending full sync', { nodeId, hostCount: hosts.length, certCount: certs.length });
    return this.registry.sendCommand(
      nodeId,
      {
        fullSync: {
          hosts: hosts.map((h) => ({ hostId: h.hostId, configContent: h.configContent })),
          certs: certs.map((c) => ({ certId: c.certId, certPem: c.certPem, keyPem: c.keyPem, chainPem: c.chainPem })),
          globalConfig,
          htpasswdFiles: htpasswdFiles.map((h) => ({ accessListId: h.accessListId, content: h.content })),
          versionHash,
        },
      },
      60000 // 60s timeout for full sync
    );
  }

  // ─── Docker Commands ──────────────────────────────────────────────

  async sendDockerContainerCommand(
    nodeId: string,
    action: string,
    options: {
      containerId?: string;
      configJson?: string;
      timeoutSeconds?: number;
      signal?: string;
      newName?: string;
      force?: boolean;
    } = {},
    timeoutMs?: number
  ): Promise<CommandResult> {
    if (!['list', 'inspect', 'stats', 'top'].includes(action)) {
      await this.assertNodeMutable(nodeId);
    }
    return this.registry.sendCommand(
      nodeId,
      {
        dockerContainer: { action, ...options } as any,
      },
      timeoutMs
    );
  }

  async sendDockerImageCommand(
    nodeId: string,
    action: string,
    options: {
      imageRef?: string;
      registryAuthJson?: string;
      force?: boolean;
    } = {},
    timeoutMs?: number
  ): Promise<CommandResult> {
    if (action !== 'list') {
      await this.assertNodeMutable(nodeId);
    }
    return this.registry.sendCommand(
      nodeId,
      {
        dockerImage: { action, ...options } as any,
      },
      timeoutMs
    );
  }

  async sendDockerVolumeCommand(
    nodeId: string,
    action: string,
    options: {
      name?: string;
      driver?: string;
      labels?: Record<string, string>;
      force?: boolean;
    } = {},
    timeoutMs?: number
  ): Promise<CommandResult> {
    if (action !== 'list') {
      await this.assertNodeMutable(nodeId);
    }
    return this.registry.sendCommand(
      nodeId,
      {
        dockerVolume: { action, ...options } as any,
      },
      timeoutMs
    );
  }

  async sendDockerNetworkCommand(
    nodeId: string,
    action: string,
    options: {
      networkId?: string;
      containerId?: string;
      driver?: string;
      subnet?: string;
      gatewayAddr?: string;
    } = {},
    timeoutMs?: number
  ): Promise<CommandResult> {
    if (action !== 'list') {
      await this.assertNodeMutable(nodeId);
    }
    return this.registry.sendCommand(
      nodeId,
      {
        dockerNetwork: { action, ...options } as any,
      },
      timeoutMs
    );
  }

  async sendDockerExecCommand(
    nodeId: string,
    action: string,
    options: {
      containerId?: string;
      command?: string[];
      tty?: boolean;
      stdin?: boolean;
      rows?: number;
      cols?: number;
    } = {}
  ): Promise<CommandResult> {
    await this.assertNodeMutable(nodeId);
    return this.registry.sendCommand(nodeId, {
      dockerExec: { action, ...options } as any,
    });
  }

  async sendNodeExecCommand(
    nodeId: string,
    action: string,
    options: {
      command?: string[];
      tty?: boolean;
      rows?: number;
      cols?: number;
    } = {}
  ): Promise<CommandResult> {
    await this.assertNodeMutable(nodeId);
    return this.registry.sendCommand(nodeId, {
      nodeExec: { action, ...options } as any,
    });
  }

  async sendDockerFileCommand(
    nodeId: string,
    action: string,
    options: {
      containerId?: string;
      path?: string;
      maxBytes?: number;
      content?: string;
    } = {}
  ): Promise<CommandResult> {
    if (!['list', 'read'].includes(action)) {
      await this.assertNodeMutable(nodeId);
    }
    const { content, ...rest } = options;
    const payload: Record<string, unknown> = { action, ...rest };
    if (content != null) {
      // Content arrives as base64 from the frontend — decode to raw bytes for the proto bytes field
      payload.content = Buffer.from(content, 'base64');
    }
    return this.registry.sendCommand(nodeId, {
      dockerFile: payload as any,
    });
  }

  async sendDockerLogsCommand(
    nodeId: string,
    containerId: string,
    options: {
      tailLines?: number;
      follow?: boolean;
      timestamps?: boolean;
      since?: string;
      until?: string;
    } = {}
  ): Promise<CommandResult> {
    return this.registry.sendCommand(nodeId, {
      dockerLogs: { containerId, ...options } as any,
    });
  }

  async sendDockerConfigPush(
    nodeId: string,
    registries: Array<{ url: string; username: string; password: string }>,
    allowlist: string[]
  ): Promise<CommandResult> {
    await this.assertNodeMutable(nodeId);
    return this.registry.sendCommand(nodeId, {
      dockerConfigPush: { registries, allowlist },
    });
  }

  /** Fire-and-forget exec input (no response expected) */
  sendExecInput(nodeId: string, execId: string, data: Buffer): void {
    try {
      this.registry.sendCommandNoWait(nodeId, {
        execInput: { execId, data },
      });
    } catch {
      /* ignore */
    }
  }

  /** Get the default nginx node ID, or null if none configured */
  /** Get the first online nginx node ID, or null if none available */
  async getFirstNginxNodeId(): Promise<string | null> {
    const [node] = await this.db
      .select({ id: nodes.id })
      .from(nodes)
      .where(and(eq(nodes.type, 'nginx'), eq(nodes.status, 'online')))
      .limit(1);
    return node?.id ?? null;
  }

  /** Resolve the node ID for a proxy host, falling back to default node */
  async sendUpdateDaemonCommand(
    nodeId: string,
    downloadUrl: string,
    targetVersion: string,
    checksum: string
  ): Promise<CommandResult> {
    return this.registry.sendCommand(nodeId, {
      updateDaemon: { downloadUrl, targetVersion, checksum },
    });
  }

  async resolveNodeId(proxyHostNodeId: string | null): Promise<string> {
    if (proxyHostNodeId) return proxyHostNodeId;
    throw new Error('No node assigned to this proxy host');
  }
}
