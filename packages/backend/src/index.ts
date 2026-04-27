// Must be first — set up environment and reflection metadata
import 'reflect-metadata';
import 'dotenv/config';

import { serve } from '@hono/node-server';

// Import services to ensure decorators are processed
import '@/services/cache.service.js';
import '@/services/session.service.js';
import '@/modules/auth/auth.service.js';

import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { createApp } from '@/app.js';
import { container, initializeContainer } from '@/bootstrap.js';
import { getEnv } from '@/config/env.js';
import { TOKENS } from '@/container.js';
import { startGrpcServer, stopGrpcServer } from '@/grpc/server.js';
import { logger } from '@/lib/logger.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import { LoggingClickHouseService } from '@/modules/logging/logging-clickhouse.service.js';
import { CAService } from '@/modules/pki/ca.service.js';
import type { RedisClient } from '@/services/cache.service.js';
import { CryptoService } from '@/services/crypto.service.js';
import { NodeDispatchService } from '@/services/node-dispatch.service.js';
import { NodeRegistryService } from '@/services/node-registry.service.js';
import { SchedulerService } from '@/services/scheduler.service.js';
import { SystemCAService } from '@/services/system-ca.service.js';

async function runMigrations(databaseUrl: string) {
  logger.info('Running database migrations...');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: resolve('src/db/migrations') });
  await pool.end();
  logger.info('Database migrations completed');
}

async function main() {
  try {
    const env = getEnv();

    logger.info('Starting Gateway API...', {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
    });

    // Run database migrations before anything else
    await runMigrations(env.DATABASE_URL);

    // Initialize dependency injection container
    await initializeContainer();

    // Create the Hono app
    const { app, injectWebSocket } = createApp();

    // Start the server
    const server = serve({
      fetch: app.fetch,
      port: env.PORT,
      hostname: env.BIND_HOST,
    });

    // Inject WebSocket support into the HTTP server
    injectWebSocket(server);

    logger.info(`Server running at http://${env.BIND_HOST}:${env.PORT}`);
    logger.info(`API Documentation at http://localhost:${env.PORT}/docs`);

    // Start gRPC server for daemon communication
    const registry = container.resolve(NodeRegistryService);
    const dispatch = container.resolve(NodeDispatchService);
    const auditService = container.resolve(AuditService);
    const caService = container.resolve(CAService);
    const cryptoService = container.resolve(CryptoService);
    const db = container.resolve(TOKENS.DrizzleClient) as any;

    const systemCA = container.resolve(SystemCAService);

    // Auto-generate gRPC server TLS cert from system CA if not explicitly configured
    let grpcCertPath = env.GRPC_TLS_CERT;
    let grpcKeyPath = env.GRPC_TLS_KEY;
    if (!grpcCertPath || !grpcKeyPath) {
      const autoDir = process.env.GRPC_TLS_AUTO_DIR || '/var/lib/gateway/tls';
      const autoCert = await systemCA.ensureGrpcServerCert(`${autoDir}/grpc-server.crt`, `${autoDir}/grpc-server.key`);
      grpcCertPath = autoCert.certPath;
      grpcKeyPath = autoCert.keyPath;
    }

    await startGrpcServer(env.GRPC_PORT, grpcCertPath, grpcKeyPath, {
      registry,
      dispatch,
      auditService,
      db,
      caService,
      cryptoService,
      systemCA,
    });

    // Start background jobs
    const scheduler = container.resolve(SchedulerService);
    scheduler.start();

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down server...');
      scheduler.stop();

      try {
        await stopGrpcServer();
      } catch (err) {
        logger.error('Failed to stop gRPC server', { err });
      }

      try {
        const clickHouse = container.resolve(LoggingClickHouseService);
        await clickHouse.close();
        logger.info('ClickHouse connection closed');
      } catch (err) {
        logger.error('Failed to close ClickHouse', { err });
      }

      try {
        const redis = container.resolve<RedisClient>(TOKENS.RedisClient);
        await redis.quit();
        logger.info('Redis connection closed');
      } catch (err) {
        logger.error('Failed to close Redis', { err });
      }

      try {
        const db = container.resolve(TOKENS.DrizzleClient) as any;
        await db.$client?.end?.();
        logger.info('Database pool closed');
      } catch (err) {
        logger.error('Failed to close database pool', { err });
      }

      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });

      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10_000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error('Failed to start server', {
      error,
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    process.exit(1);
  }
}

main();
