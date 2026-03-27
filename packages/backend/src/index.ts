// Must be first — set up environment and reflection metadata
import 'reflect-metadata';
import 'dotenv/config';

import { serve } from '@hono/node-server';

// Import services to ensure decorators are processed
import '@/services/cache.service.js';
import '@/services/session.service.js';
import '@/modules/auth/auth.service.js';

import { createApp } from '@/app.js';
import { getEnv } from '@/config/env.js';
import { initializeContainer } from '@/bootstrap.js';
import { logger } from '@/lib/logger.js';

async function main() {
  try {
    const env = getEnv();

    logger.info('Starting CA Manager API...', {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
    });

    // Initialize dependency injection container
    await initializeContainer();

    // Create the Hono app
    const app = createApp();

    // Start the server
    const server = serve({
      fetch: app.fetch,
      port: env.PORT,
    });

    logger.info(`Server running at http://localhost:${env.PORT}`);
    logger.info(`API Documentation at http://localhost:${env.PORT}/docs`);

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down server...');
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
