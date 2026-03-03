import 'reflect-metadata';
import { container, TOKENS } from '@/container.js';
import { getEnv } from '@/config/env.js';
import { createDrizzleClient } from '@/db/client.js';
import { createRedisClient } from '@/services/cache.service.js';
import { logger } from '@/lib/logger.js';

import { CacheService } from '@/services/cache.service.js';
import { SessionService } from '@/services/session.service.js';
import { CryptoService } from '@/services/crypto.service.js';
import { AuthService } from '@/modules/auth/auth.service.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import { TemplatesService } from '@/modules/pki/templates.service.js';
import { CAService } from '@/modules/pki/ca.service.js';
import { CertService } from '@/modules/pki/cert.service.js';
import { CRLService } from '@/modules/pki/crl.service.js';
import { OCSPService } from '@/modules/pki/ocsp.service.js';
import { ExportService } from '@/modules/pki/export.service.js';
import { AlertService } from '@/modules/audit/alert.service.js';

export { container };

export async function initializeContainer(): Promise<void> {
  const env = getEnv();

  logger.info('Initializing dependency injection container...');

  // Register environment config
  container.register(TOKENS.Env, { useValue: env });

  // Initialize and register database client
  logger.debug('Connecting to database...');
  const db = createDrizzleClient(env.DATABASE_URL);
  container.register(TOKENS.DrizzleClient, { useValue: db });

  // Initialize and register Redis client
  logger.debug('Connecting to Redis...');
  const redis = createRedisClient(env.REDIS_URL);
  container.register(TOKENS.RedisClient, { useValue: redis });

  // Register services with explicit factories
  const cacheService = new CacheService(redis);
  container.registerInstance(CacheService, cacheService);

  const sessionService = new SessionService(cacheService);
  container.registerInstance(SessionService, sessionService);

  const cryptoService = new CryptoService(env.PKI_MASTER_KEY);
  container.registerInstance(CryptoService, cryptoService);

  const authService = new AuthService(db, sessionService, cacheService);
  container.registerInstance(AuthService, authService);

  const auditService = new AuditService(db);
  container.registerInstance(AuditService, auditService);

  const templatesService = new TemplatesService(db);
  container.registerInstance(TemplatesService, templatesService);

  const caService = new CAService(db, cryptoService, auditService);
  container.registerInstance(CAService, caService);

  const certService = new CertService(db, cryptoService, caService, auditService);
  container.registerInstance(CertService, certService);

  const crlService = new CRLService(db, cryptoService, caService, cacheService);
  container.registerInstance(CRLService, crlService);

  const ocspService = new OCSPService(db, cryptoService, caService, cacheService);
  container.registerInstance(OCSPService, ocspService);

  const exportService = new ExportService(cryptoService);
  container.registerInstance(ExportService, exportService);

  const tokensService = new TokensService(db);
  container.registerInstance(TokensService, tokensService);

  const alertService = new AlertService(db);
  container.registerInstance(AlertService, alertService);

  // Seed built-in certificate templates
  await templatesService.seedBuiltinTemplates();

  logger.info('Dependency injection container initialized');
}
