import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { DrizzleClient } from '@/db/client.js';
import { createChildLogger } from '@/lib/logger.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { CAService } from '@/modules/pki/ca.service.js';
import type { CryptoService } from '@/services/crypto.service.js';
import { validateGrpcServerCertificate } from '@/services/grpc-server-certificate.js';
import type { NodeDispatchService } from '@/services/node-dispatch.service.js';
import type { NodeRegistryService } from '@/services/node-registry.service.js';
import type { SystemCAService } from '@/services/system-ca.service.js';
import { createControlHandlers } from './services/control.js';
import { createEnrollmentHandlers } from './services/enrollment.js';
import { createLogStreamHandlers } from './services/log-stream.js';

const logger = createChildLogger('GrpcServer');

function resolveProtoPath() {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), 'proto/gateway/v1/nginx-daemon.proto'),
    resolve(process.cwd(), '../proto/gateway/v1/nginx-daemon.proto'),
    resolve(process.cwd(), '../../proto/gateway/v1/nginx-daemon.proto'),
    resolve(moduleDir, '../../proto/gateway/v1/nginx-daemon.proto'),
    resolve(moduleDir, '../../../proto/gateway/v1/nginx-daemon.proto'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(`Could not locate nginx-daemon.proto. Tried: ${candidates.join(', ')}`);
}

const PROTO_PATH = resolveProtoPath();

class StaticCertificateProvider {
  constructor(
    private readonly caCertificate: Buffer,
    private readonly certificate: Buffer,
    private readonly privateKey: Buffer
  ) {}

  addCaCertificateListener(listener: (update: { caCertificate: Buffer } | null) => void) {
    setImmediate(() => listener({ caCertificate: this.caCertificate }));
  }

  removeCaCertificateListener() {
    // Static certificates do not retain listeners.
  }

  addIdentityCertificateListener(listener: (update: { certificate: Buffer; privateKey: Buffer } | null) => void) {
    setImmediate(() => listener({ certificate: this.certificate, privateKey: this.privateKey }));
  }

  removeIdentityCertificateListener() {
    // Static certificates do not retain listeners.
  }
}

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

export async function createGrpcServerCredentials(
  tlsCertPath: string | undefined,
  tlsKeyPath: string | undefined,
  systemCA: SystemCAService
): Promise<grpc.ServerCredentials> {
  if (!tlsCertPath || !tlsKeyPath) {
    throw new Error('gRPC server requires TLS certificate and key paths');
  }

  const cert = readFileSync(tlsCertPath);
  const key = readFileSync(tlsKeyPath);
  const caPem = await systemCA.getSystemCACertPem();

  if (!caPem) {
    throw new Error('gRPC server requires the Gateway system CA certificate for daemon mTLS');
  }
  validateGrpcServerCertificate(cert, key, caPem);

  // checkClientCertificate=false keeps enrollment open for new nodes, while
  // still requesting and validating client certs when enrolled daemons present them.
  const provider = new StaticCertificateProvider(Buffer.from(caPem), cert, key);
  return (grpc.experimental as any).createCertificateProviderServerCredentials(provider, provider, false);
}

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

  const credentials = await createGrpcServerCredentials(tlsCertPath, tlsKeyPath, deps.systemCA);
  logger.info('gRPC server using TLS with Gateway system CA client certificate validation');

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
