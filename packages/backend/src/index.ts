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
import { logger } from '@/lib/logger.js';
import { SchedulerService } from '@/services/scheduler.service.js';

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
    const app = createApp();

    // Start the server
    const server = serve({
      fetch: app.fetch,
      port: env.PORT,
      hostname: env.BIND_HOST,
    });

    logger.info(`Server running at http://${env.BIND_HOST}:${env.PORT}`);
    logger.info(`API Documentation at http://localhost:${env.PORT}/docs`);

    // Start background jobs
    const scheduler = container.resolve(SchedulerService);
    scheduler.start();

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down server...');
      scheduler.stop();
      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

main();
