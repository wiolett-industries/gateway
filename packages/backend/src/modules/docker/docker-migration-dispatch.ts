import { migrationTransferRelay } from '@/grpc/services/migration-transfer.js';
import { AppError } from '@/middleware/error-handler.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';

export interface MigrationArtifactMetadata {
  artifactId: string;
  artifactType: 'image' | 'volume' | '';
  sizeBytes: number;
  artifactDigest?: string;
  logicalDigest?: string;
  entryCount?: number;
  contentBytes?: number;
  imageId?: string;
  imageTags?: string[];
  complete: boolean;
}

export interface MigrationVolumeMeasure {
  volumeName: string;
  entryCount: number;
  logicalBytes: number;
}

export class DockerMigrationDispatchAdapter {
  constructor(private dispatch: NodeDispatchService) {}

  capabilities(nodeId: string): Promise<Record<string, unknown>> {
    return this.command(nodeId, 'capabilities');
  }

  captureManifest(nodeId: string, resourceId: string): Promise<Record<string, unknown>> {
    return this.command(nodeId, 'capture_manifest', { resourceId });
  }

  measureVolume(nodeId: string, volumeName: string): Promise<MigrationVolumeMeasure> {
    return this.command<MigrationVolumeMeasure>(nodeId, 'measure_volume', { resourceId: volumeName });
  }

  prepareArtifact(args: {
    nodeId: string;
    migrationId: string;
    artifactId: string;
    kind: 'image' | 'volume';
    sourceIdentity: string;
  }): Promise<MigrationArtifactMetadata> {
    return this.command<MigrationArtifactMetadata>(
      args.nodeId,
      args.kind === 'image' ? 'prepare_image' : 'prepare_volume',
      {
        migrationId: args.migrationId,
        artifactId: args.artifactId,
        artifactType: args.kind,
        resourceId: args.sourceIdentity,
      }
    );
  }

  queryArtifact(nodeId: string, migrationId: string, artifactId: string): Promise<MigrationArtifactMetadata> {
    return this.command<MigrationArtifactMetadata>(nodeId, 'query_artifact', { migrationId, artifactId });
  }

  async transferArtifact(args: {
    sourceNodeId: string;
    targetNodeId: string;
    migrationId: string;
    artifactId: string;
    offset: number;
    onProgress?: (offset: number) => void | Promise<void>;
  }): Promise<number> {
    return migrationTransferRelay.relayArtifact(args);
  }

  importArtifact(args: {
    nodeId: string;
    migrationId: string;
    artifactId: string;
    kind: 'image' | 'volume';
    config: Record<string, unknown>;
  }): Promise<MigrationArtifactMetadata> {
    return this.command<MigrationArtifactMetadata>(
      args.nodeId,
      args.kind === 'image' ? 'import_image' : 'import_volume',
      {
        migrationId: args.migrationId,
        artifactId: args.artifactId,
        artifactType: args.kind,
        configJson: JSON.stringify(args.config),
      }
    );
  }

  createContainerStopped(
    nodeId: string,
    migrationId: string,
    config: Record<string, unknown>
  ): Promise<{ containerId: string }> {
    return this.command<{ containerId: string }>(nodeId, 'create_container_stopped', {
      migrationId,
      configJson: JSON.stringify(config),
    });
  }

  createDeploymentStopped(
    nodeId: string,
    migrationId: string,
    config: Record<string, unknown>
  ): Promise<Record<string, string>> {
    return this.command<Record<string, string>>(nodeId, 'create_deployment_stopped', {
      migrationId,
      configJson: JSON.stringify(config),
    });
  }

  heartbeat(nodeId: string, migrationId: string): Promise<Record<string, unknown>> {
    return this.command(nodeId, 'heartbeat', { migrationId });
  }

  finalize(nodeId: string, migrationId: string): Promise<Record<string, unknown>> {
    return this.command(nodeId, 'finalize', { migrationId });
  }

  abort(nodeId: string, migrationId: string): Promise<Record<string, unknown>> {
    return this.command(nodeId, 'abort', { migrationId });
  }

  async containerAction(
    nodeId: string,
    action: string,
    containerId: string,
    options: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    return this.parse(
      await this.dispatch.sendDockerContainerCommand(
        nodeId,
        action,
        { containerId, ...(options as object) },
        15 * 60 * 1000
      )
    );
  }

  async deploymentAction(
    nodeId: string,
    action: string,
    deploymentId: string,
    options: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    return this.parse(
      await this.dispatch.sendDockerDeploymentCommand(
        nodeId,
        action,
        { deploymentId, ...(options as object) },
        15 * 60 * 1000
      )
    );
  }

  async volumeAction(
    nodeId: string,
    action: string,
    name: string,
    options: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    return this.parse(
      await this.dispatch.sendDockerVolumeCommand(nodeId, action, { name, ...(options as object) }, 15 * 60 * 1000)
    );
  }

  private async command<T = Record<string, unknown>>(
    nodeId: string,
    action: string,
    options: {
      migrationId?: string;
      artifactId?: string;
      artifactType?: string;
      resourceId?: string;
      configJson?: string;
    } = {}
  ): Promise<T> {
    return this.parse(await this.dispatch.sendDockerMigrationCommand(nodeId, action, options, 15 * 60 * 1000)) as T;
  }

  private parse(result: { success: boolean; error?: string; detail?: string }): Record<string, unknown> {
    if (!result.success) {
      const message = result.error?.trim() || 'Docker migration command failed';
      if (/offline|unavailable|disconnect|timed out/i.test(message)) {
        throw new AppError(503, 'MIGRATION_NODE_UNAVAILABLE', message);
      }
      throw new AppError(502, 'MIGRATION_DAEMON_ERROR', message);
    }
    if (!result.detail) return {};
    try {
      return JSON.parse(result.detail) as Record<string, unknown>;
    } catch {
      throw new AppError(502, 'MIGRATION_DAEMON_PROTOCOL', 'Docker daemon returned invalid migration data');
    }
  }
}
