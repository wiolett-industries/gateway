import type { ServerDuplexStream } from '@grpc/grpc-js';
import { eq } from 'drizzle-orm';
import { nodes } from '@/db/schema/index.js';
import type {
  MigrationArtifactAck,
  MigrationArtifactChunk,
  MigrationArtifactError,
  MigrationTransferControl,
  MigrationTransferMessage,
} from '@/grpc/generated/migration-types.js';
import { createChildLogger } from '@/lib/logger.js';
import { AppError } from '@/middleware/error-handler.js';
import { extractDaemonCertificateIdentity, normalizeCertificateSerial } from '../interceptors/auth.js';
import type { GrpcServerDeps } from '../server.js';

const logger = createChildLogger('GrpcMigrationTransfer');
const MAX_CHUNK_BYTES = 1024 * 1024;

type MigrationStream = ServerDuplexStream<MigrationTransferMessage, MigrationTransferControl>;

interface TransferConnection {
  nodeId: string;
  stream: MigrationStream;
  maxChunkBytes: number;
}

interface RelaySession {
  key: string;
  migrationId: string;
  artifactId: string;
  source: TransferConnection;
  target: TransferConnection;
  offset: bigint;
  state: 'awaiting_target' | 'reading_source' | 'awaiting_ack';
  pendingChunk: MigrationArtifactChunk | null;
  onProgress?: (offset: number) => void | Promise<void>;
  resolve: (offset: number) => void;
  reject: (error: Error) => void;
}

function relayKey(migrationId: string, artifactId: string): string {
  return `${migrationId}:${artifactId}`;
}

function offsetOf(value: string): bigint {
  try {
    return BigInt(value || '0');
  } catch {
    throw new AppError(502, 'MIGRATION_TRANSFER_PROTOCOL', 'Daemon returned an invalid artifact offset');
  }
}

class MigrationTransferRelay {
  private connections = new Map<string, TransferConnection>();
  private relays = new Map<string, RelaySession>();

  register(connection: TransferConnection): void {
    const previous = this.connections.get(connection.nodeId);
    if (previous && previous.stream !== connection.stream) previous.stream.end();
    this.connections.set(connection.nodeId, connection);
  }

  disconnect(nodeId: string, stream: MigrationStream): void {
    if (this.connections.get(nodeId)?.stream === stream) this.connections.delete(nodeId);
    for (const relay of this.relays.values()) {
      if (relay.source.stream === stream || relay.target.stream === stream) {
        this.fail(relay, new AppError(503, 'MIGRATION_NODE_UNAVAILABLE', 'Migration transfer stream disconnected'));
      }
    }
  }

  isConnected(nodeId: string): boolean {
    return this.connections.has(nodeId);
  }

  relayArtifact(args: {
    sourceNodeId: string;
    targetNodeId: string;
    migrationId: string;
    artifactId: string;
    offset: number;
    onProgress?: (offset: number) => void | Promise<void>;
  }): Promise<number> {
    const source = this.connections.get(args.sourceNodeId);
    const target = this.connections.get(args.targetNodeId);
    if (!source || !target) {
      throw new AppError(503, 'MIGRATION_NODE_UNAVAILABLE', 'Both Docker migration streams must be connected');
    }
    const key = relayKey(args.migrationId, args.artifactId);
    if (this.relays.has(key)) {
      throw new AppError(409, 'MIGRATION_TRANSFER_ACTIVE', 'Artifact transfer is already active');
    }
    const offset = BigInt(args.offset);
    return new Promise<number>((resolve, reject) => {
      const session: RelaySession = {
        key,
        migrationId: args.migrationId,
        artifactId: args.artifactId,
        source,
        target,
        offset,
        state: 'awaiting_target',
        pendingChunk: null,
        onProgress: args.onProgress,
        resolve,
        reject,
      };
      this.relays.set(key, session);
      target.stream.write({
        write: {
          migrationId: args.migrationId,
          artifactId: args.artifactId,
          offset: offset.toString(),
        },
      });
    });
  }

  handle(nodeId: string, message: MigrationTransferMessage): void {
    if (message.chunk) this.handleChunk(nodeId, message.chunk);
    else if (message.ack) this.handleAck(nodeId, message.ack);
    else if (message.error) this.handleError(nodeId, message.error);
  }

  private handleChunk(nodeId: string, chunk: MigrationArtifactChunk): void {
    const session = this.relays.get(relayKey(chunk.migrationId, chunk.artifactId));
    if (!session || session.source.nodeId !== nodeId) return;
    try {
      if (session.state !== 'reading_source' || offsetOf(chunk.offset) !== session.offset) {
        throw new AppError(502, 'MIGRATION_TRANSFER_PROTOCOL', 'Source artifact offset is out of sequence');
      }
      if (chunk.data.length > Math.min(MAX_CHUNK_BYTES, session.target.maxChunkBytes)) {
        throw new AppError(502, 'MIGRATION_TRANSFER_PROTOCOL', 'Source artifact chunk exceeds negotiated size');
      }
      if (chunk.eof && chunk.data.length > 0) {
        throw new AppError(502, 'MIGRATION_TRANSFER_PROTOCOL', 'EOF artifact chunk contains data');
      }
      session.state = 'awaiting_ack';
      session.pendingChunk = chunk;
      session.source.stream.pause();
      session.target.stream.write({ chunk });
    } catch (error) {
      this.fail(session, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleAck(nodeId: string, ack: MigrationArtifactAck): void {
    const session = this.relays.get(relayKey(ack.migrationId, ack.artifactId));
    if (!session || session.target.nodeId !== nodeId) return;
    try {
      if (session.state === 'awaiting_target') {
        if (offsetOf(ack.acknowledgedOffset) !== session.offset) {
          throw new AppError(502, 'MIGRATION_TRANSFER_PROTOCOL', 'Target resume offset does not match');
        }
        session.state = 'reading_source';
        session.source.stream.write({
          read: {
            migrationId: session.migrationId,
            artifactId: session.artifactId,
            offset: session.offset.toString(),
          },
        });
        return;
      }
      if (session.state !== 'awaiting_ack' || !session.pendingChunk) {
        throw new AppError(502, 'MIGRATION_TRANSFER_PROTOCOL', 'Unexpected target artifact acknowledgement');
      }
      const expected = session.offset + BigInt(session.pendingChunk.data.length);
      if (offsetOf(ack.acknowledgedOffset) !== expected) {
        throw new AppError(502, 'MIGRATION_TRANSFER_PROTOCOL', 'Target acknowledged an invalid artifact offset');
      }
      const complete = session.pendingChunk.eof;
      if (complete !== ack.complete) {
        throw new AppError(502, 'MIGRATION_TRANSFER_PROTOCOL', 'Target completion acknowledgement is inconsistent');
      }
      session.offset = expected;
      session.source.stream.write({ ack });
      session.pendingChunk = null;
      void session.onProgress?.(Number(session.offset));
      if (complete) {
        this.relays.delete(session.key);
        session.source.stream.resume();
        session.resolve(Number(session.offset));
      } else {
        session.state = 'reading_source';
        session.source.stream.resume();
      }
    } catch (error) {
      this.fail(session, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleError(nodeId: string, message: MigrationArtifactError): void {
    const session = this.relays.get(relayKey(message.migrationId, message.artifactId));
    if (!session || (session.source.nodeId !== nodeId && session.target.nodeId !== nodeId)) return;
    this.fail(session, new AppError(502, 'MIGRATION_TRANSFER_FAILED', message.message || 'Artifact transfer failed'));
  }

  private fail(session: RelaySession, error: Error): void {
    if (!this.relays.delete(session.key)) return;
    const message = {
      error: {
        migrationId: session.migrationId,
        artifactId: session.artifactId,
        message: error.message,
      },
    };
    session.source.stream.write(message);
    session.target.stream.write(message);
    session.source.stream.resume();
    session.reject(error);
  }
}

export const migrationTransferRelay = new MigrationTransferRelay();

export function createMigrationTransferHandlers(deps: GrpcServerDeps) {
  return {
    Transfer(stream: MigrationStream) {
      let nodeId: string | null = null;
      let authenticatedNodeId: string | null = null;
      let authenticated = false;
      let closed = false;
      stream.pause();

      const close = () => {
        if (closed) return;
        closed = true;
        if (nodeId) migrationTransferRelay.disconnect(nodeId, stream);
      };
      stream.on('end', () => {
        close();
        stream.end();
      });
      stream.on('error', close);
      stream.on('data', (message: MigrationTransferMessage) => {
        if (!authenticated || closed) return;
        if (!nodeId) {
          const hello = message.hello;
          if (!hello || hello.capability !== 'docker_migration_v1') {
            stream.end();
            return;
          }
          if (hello.nodeId !== authenticatedNodeId) {
            stream.end();
            return;
          }
          nodeId = hello.nodeId;
          migrationTransferRelay.register({
            nodeId,
            stream,
            maxChunkBytes: Math.min(MAX_CHUNK_BYTES, Math.max(1, hello.maxChunkBytes)),
          });
          logger.debug('Docker migration transfer stream opened', { nodeId });
          return;
        }
        migrationTransferRelay.handle(nodeId, message);
      });

      void (async () => {
        const identity = extractDaemonCertificateIdentity(stream as never);
        if (!identity) throw new Error('missing authorized daemon certificate');
        const connected = deps.registry.getNode(identity.nodeId);
        if (!connected || connected.type !== 'docker') throw new Error('Docker node is not connected');
        const [node] = await deps.db
          .select({ certificateSerial: nodes.certificateSerial, status: nodes.status })
          .from(nodes)
          .where(eq(nodes.id, identity.nodeId))
          .limit(1);
        if (
          !node ||
          node.status === 'pending' ||
          !node.certificateSerial ||
          normalizeCertificateSerial(node.certificateSerial) !== identity.serialNumber
        ) {
          throw new Error('daemon certificate does not match the enrolled Docker node');
        }
        authenticatedNodeId = identity.nodeId;
        authenticated = true;
        stream.resume();
      })().catch((error) => {
        logger.warn('Docker migration transfer stream rejected', {
          nodeId,
          error: error instanceof Error ? error.message : String(error),
        });
        close();
        stream.end();
      });
    },
  };
}
