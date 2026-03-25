import 'reflect-metadata';
import { getEnv } from '@/config/env.js';
import { container, TOKENS } from '@/container.js';
import { createDrizzleClient } from '@/db/client.js';
import { ACMERenewalJob } from '@/jobs/acme-renewal.job.js';
import { ExpiryAlertJob } from '@/jobs/expiry-alert.job.js';
import { HealthCheckJob } from '@/jobs/health-check.job.js';
import { logger } from '@/lib/logger.js';
import { AccessListService } from '@/modules/access-lists/access-list.service.js';
import { AlertService } from '@/modules/audit/alert.service.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import { AuthService } from '@/modules/auth/auth.service.js';
import { LogStreamService } from '@/modules/monitoring/log-stream.service.js';
import { MonitoringService } from '@/modules/monitoring/monitoring.service.js';
import { CAService } from '@/modules/pki/ca.service.js';
import { CertService } from '@/modules/pki/cert.service.js';
import { CRLService } from '@/modules/pki/crl.service.js';
import { ExportService } from '@/modules/pki/export.service.js';
import { OCSPService } from '@/modules/pki/ocsp.service.js';
import { TemplatesService } from '@/modules/pki/templates.service.js';
import { FolderService } from '@/modules/proxy/folder.service.js';
import { NginxTemplateService } from '@/modules/proxy/nginx-template.service.js';
import { ProxyService } from '@/modules/proxy/proxy.service.js';
import { ACMEService } from '@/modules/ssl/acme.service.js';
import { SSLService } from '@/modules/ssl/ssl.service.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import { CacheService, createRedisClient } from '@/services/cache.service.js';
import { ConfigValidatorService } from '@/services/config-validator.service.js';
import { CryptoService } from '@/services/crypto.service.js';
import { DockerService } from '@/services/docker.service.js';
import { NginxService } from '@/services/nginx.service.js';
import { SchedulerService } from '@/services/scheduler.service.js';
import { SessionService } from '@/services/session.service.js';

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

  // Gateway services
  const configValidator = new ConfigValidatorService();
  container.registerInstance(ConfigValidatorService, configValidator);

  const dockerService = new DockerService(env.DOCKER_SOCKET_PATH, env.NGINX_CONTAINER_NAME);
  container.registerInstance(DockerService, dockerService);

  const nginxService = new NginxService(
    env.NGINX_CONFIG_PATH,
    env.NGINX_CERTS_PATH,
    env.NGINX_LOGS_PATH,
    env.ACME_CHALLENGE_PATH,
    dockerService,
    configValidator
  );
  container.registerInstance(NginxService, nginxService);

  const folderService = new FolderService(db, auditService);
  container.registerInstance(FolderService, folderService);

  const nginxTemplateService = new NginxTemplateService(db, auditService);
  container.registerInstance(NginxTemplateService, nginxTemplateService);

  const proxyService = new ProxyService(db, nginxService, nginxTemplateService, auditService, cryptoService);
  container.registerInstance(ProxyService, proxyService);

  const acmeService = new ACMEService(env.ACME_CHALLENGE_PATH, env.ACME_EMAIL, env.ACME_STAGING);
  container.registerInstance(ACMEService, acmeService);

  const accessListService = new AccessListService(db, nginxService, nginxTemplateService, auditService);
  container.registerInstance(AccessListService, accessListService);

  const sslService = new SSLService(db, acmeService, nginxService, cryptoService, auditService);
  container.registerInstance(SSLService, sslService);

  // Monitoring services
  const logStreamService = new LogStreamService(env.NGINX_LOGS_PATH);
  container.registerInstance(LogStreamService, logStreamService);

  const monitoringService = new MonitoringService(db);
  container.registerInstance(MonitoringService, monitoringService);

  // Seed built-in templates
  await templatesService.seedBuiltinTemplates();
  await nginxTemplateService.seedBuiltinTemplates();

  // Background jobs
  const scheduler = new SchedulerService();
  container.registerInstance(SchedulerService, scheduler);

  const acmeRenewalJob = new ACMERenewalJob(db, sslService, alertService);
  const healthCheckJob = new HealthCheckJob(db);
  const expiryAlertJob = new ExpiryAlertJob(db, alertService, env.EXPIRY_WARNING_DAYS, env.EXPIRY_CRITICAL_DAYS);

  scheduler.register('acme-renewal', env.ACME_RENEWAL_CRON, () => acmeRenewalJob.run());
  scheduler.registerInterval('health-check', env.HEALTH_CHECK_INTERVAL_SECONDS * 1000, () => healthCheckJob.run());
  scheduler.register('expiry-alerts', env.EXPIRY_CHECK_CRON, () => expiryAlertJob.run());

  logger.info('Dependency injection container initialized');
}
