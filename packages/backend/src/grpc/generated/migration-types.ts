/** TypeScript types for the Docker migration protobuf surface. */

export interface DockerMigrationCommand {
  action: string;
  migrationId: string;
  artifactId: string;
  artifactType: string;
  resourceId: string;
  configJson: string;
}

export interface MigrationTransferMessage {
  hello?: MigrationTransferHello;
  chunk?: MigrationArtifactChunk;
  ack?: MigrationArtifactAck;
  error?: MigrationArtifactError;
}

export interface MigrationTransferControl {
  read?: MigrationArtifactRead;
  write?: MigrationArtifactWrite;
  chunk?: MigrationArtifactChunk;
  ack?: MigrationArtifactAck;
  error?: MigrationArtifactError;
  heartbeat?: MigrationHeartbeat;
}

export interface MigrationTransferHello {
  nodeId: string;
  capability: string;
  maxChunkBytes: number;
}

export interface MigrationArtifactRead {
  migrationId: string;
  artifactId: string;
  offset: string;
}

export interface MigrationArtifactWrite {
  migrationId: string;
  artifactId: string;
  offset: string;
}

export interface MigrationArtifactChunk {
  migrationId: string;
  artifactId: string;
  offset: string;
  data: Buffer;
  eof: boolean;
}

export interface MigrationArtifactAck {
  migrationId: string;
  artifactId: string;
  acknowledgedOffset: string;
  complete: boolean;
}

export interface MigrationArtifactError {
  migrationId: string;
  artifactId: string;
  message: string;
}

export interface MigrationHeartbeat {
  migrationId: string;
}
