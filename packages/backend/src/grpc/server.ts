import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { DrizzleClient } from '@/db/client.js';
import { createChildLogger } from '@/lib/logger.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { CAService } from '@/modules/pki/ca.service.js';
import type { CryptoService } from '@/services/crypto.service.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';
import type { NodeRegistryService } from '@/services/node-registry.service.js';
import type { SystemCAService } from '@/services/system-ca.service.js';
import { createControlHandlers } from './services/control.js';
import { createEnrollmentHandlers } from './services/enrollment.js';
import { createLogStreamHandlers } from './services/log-stream.js';

const logger = createChildLogger('GrpcServer');

const PROTO_PATH = resolve('proto/gateway/v1/nginx-daemon.proto');

export interface GrpcServerDeps {
  registry: NodeRegistryService;
  dispatch: NodeDispatchService;
  auditService: AuditService;
  db: DrizzleClient;
  caService: CAService;
  cryptoService: CryptoService;
  systemCA: SystemCAService;
}

let server: grpc.Server | null = null;

export async function startGrpcServer(
  port: number,
  tlsCertPath: string | undefined,
  tlsKeyPath: string | undefined,
  deps: GrpcServerDeps
): Promise<void> {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const proto = grpc.loadPackageDefinition(packageDefinition) as any;
  const gatewayV1 = proto.gateway.v1;

  server = new grpc.Server({
    'grpc.keepalive_time_ms': 30000,
    'grpc.keepalive_timeout_ms': 10000,
    'grpc.keepalive_permit_without_calls': 1,
  });

  // Register service handlers
  server.addService(gatewayV1.NodeEnrollment.service, createEnrollmentHandlers(deps));
  server.addService(gatewayV1.NodeControl.service, createControlHandlers(deps));
  server.addService(gatewayV1.LogStream.service, createLogStreamHandlers(deps));

  // Server credentials with mTLS support
  let credentials: grpc.ServerCredentials;
  if (tlsCertPath && tlsKeyPath) {
    const cert = readFileSync(tlsCertPath);
    const key = readFileSync(tlsKeyPath);

    // Load system CA cert so gRPC verifies client certs against it.
    // checkClientCertificate=false keeps enrollment open (new nodes have no cert yet),
    // but any client cert that IS presented gets validated against the CA.
    let caCert: Buffer | null = null;
    try {
      const caPem = await deps.systemCA.getSystemCACertPem();
      if (caPem) {
        caCert = Buffer.from(caPem);
        logger.info('gRPC mTLS enabled — client certs verified against system CA');
      }
    } catch (err) {
      logger.warn('Could not load system CA cert for mTLS', { error: (err as Error).message });
    }

    credentials = grpc.ServerCredentials.createSsl(caCert, [{ cert_chain: cert, private_key: key }], false);
    logger.info('gRPC server using TLS');
  } else {
    credentials = grpc.ServerCredentials.createInsecure();
    logger.warn('gRPC server using INSECURE credentials (no TLS configured)');
  }

  return new Promise((resolvePromise, reject) => {
    server!.bindAsync(`0.0.0.0:${port}`, credentials, (err, boundPort) => {
      if (err) {
        reject(err);
        return;
      }
      logger.info(`gRPC server listening on port ${boundPort}`);
      resolvePromise();
    });
  });
}

export function stopGrpcServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.tryShutdown(() => {
      logger.info('gRPC server stopped');
      server = null;
      resolve();
    });
  });
}
