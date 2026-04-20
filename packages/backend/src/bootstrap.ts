import 'reflect-metadata';
import { getEnv } from '@/config/env.js';
import { container, TOKENS } from '@/container.js';
import { createDrizzleClient } from '@/db/client.js';
import { ACMERenewalJob } from '@/jobs/acme-renewal.job.js';
import { DaemonUpdateCheckJob } from '@/jobs/daemon-update-check.job.js';
import { DnsCheckJob } from '@/jobs/dns-check.job.js';
import { ExpiryAlertJob } from '@/jobs/expiry-alert.job.js';
import { HealthCheckJob } from '@/jobs/health-check.job.js';
import { HousekeepingJob } from '@/jobs/housekeeping.job.js';
import { NotificationRetryJob } from '@/jobs/notification-retry.job.js';
import { UpdateCheckJob } from '@/jobs/update-check.job.js';
import { logger } from '@/lib/logger.js';
import { AccessListService } from '@/modules/access-lists/access-list.service.js';
import { AIService } from '@/modules/ai/ai.service.js';
import { AISettingsService } from '@/modules/ai/ai.settings.service.js';
import { AlertService } from '@/modules/audit/alert.service.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import { AuthService } from '@/modules/auth/auth.service.js';
import { AuthSettingsService } from '@/modules/auth/auth.settings.service.js';
import { DockerManagementService } from '@/modules/docker/docker.service.js';
import { DockerEnvironmentService } from '@/modules/docker/docker-environment.service.js';
import { DockerRegistryService } from '@/modules/docker/docker-registry.service.js';
import { DockerSecretService } from '@/modules/docker/docker-secret.service.js';
import { DockerTaskService } from '@/modules/docker/docker-task.service.js';
import { DockerWebhookService } from '@/modules/docker/docker-webhook.service.js';
import { detectPublicIP, initDnsResolver } from '@/modules/domains/dns.utils.js';
import { DomainsService } from '@/modules/domains/domain.service.js';
import { GroupService } from '@/modules/groups/group.service.js';
import { MonitoringService } from '@/modules/monitoring/monitoring.service.js';
import { NginxConfigService } from '@/modules/monitoring/nginx-config.service.js';
import { NginxStatsService } from '@/modules/monitoring/nginx-stats.service.js';
import { NodeMonitoringService } from '@/modules/nodes/node-monitoring.service.js';
import { NodesService } from '@/modules/nodes/nodes.service.js';
import { NotificationAlertRuleService } from '@/modules/notifications/notification-alert-rule.service.js';
import { NotificationDeliveryService } from '@/modules/notifications/notification-delivery.service.js';
import { NotificationDispatcherService } from '@/modules/notifications/notification-dispatcher.service.js';
import { NotificationEvaluatorService } from '@/modules/notifications/notification-evaluator.service.js';
import { NotificationWebhookService } from '@/modules/notifications/notification-webhook.service.js';
import { CAService } from '@/modules/pki/ca.service.js';
import { CertService } from '@/modules/pki/cert.service.js';
import { CRLService } from '@/modules/pki/crl.service.js';
import { ExportService } from '@/modules/pki/export.service.js';
import { OCSPService } from '@/modules/pki/ocsp.service.js';
import { TemplatesService } from '@/modules/pki/templates.service.js';
import { FolderService } from '@/modules/proxy/folder.service.js';
import { NginxTemplateService } from '@/modules/proxy/nginx-template.service.js';
import { ProxyService } from '@/modules/proxy/proxy.service.js';
import { SetupService } from '@/modules/setup/setup.service.js';
import { ACMEService } from '@/modules/ssl/acme.service.js';
import { SSLService } from '@/modules/ssl/ssl.service.js';
import { TokensService } from '@/modules/tokens/tokens.service.js';
import { CacheService, createRedisClient } from '@/services/cache.service.js';
import { ConfigValidatorService } from '@/services/config-validator.service.js';
import { CryptoService } from '@/services/crypto.service.js';
import { DaemonUpdateService } from '@/services/daemon-update.service.js';
import { DockerService } from '@/services/docker.service.js';
import { EventBusService } from '@/services/event-bus.service.js';
import { HousekeepingService } from '@/services/housekeeping.service.js';
import { NginxConfigGenerator } from '@/services/nginx-config-generator.service.js';
import { NodeDispatchService } from '@/services/node-dispatch.service.js';
import { NodeRegistryService } from '@/services/node-registry.service.js';
import { SchedulerService } from '@/services/scheduler.service.js';
import { SessionService } from '@/services/session.service.js';
import { SystemCAService } from '@/services/system-ca.service.js';
import { UpdateService } from '@/services/update.service.js';

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

  // Realtime event bus (in-process; swappable to Redis pub/sub later)
  const eventBus = new EventBusService();
  container.registerInstance(EventBusService, eventBus);

  const sessionService = new SessionService(cacheService);
  container.registerInstance(SessionService, sessionService);

  const cryptoService = new CryptoService(env.PKI_MASTER_KEY);
  container.registerInstance(CryptoService, cryptoService);

  const authSettingsService = new AuthSettingsService(db);
  container.registerInstance(AuthSettingsService, authSettingsService);

  const authService = new AuthService(db, sessionService, cacheService, authSettingsService);
  container.registerInstance(AuthService, authService);

  const auditService = new AuditService(db);
  container.registerInstance(AuditService, auditService);

  const templatesService = new TemplatesService(db);
  container.registerInstance(TemplatesService, templatesService);

  const caService = new CAService(db, cryptoService, auditService);
  container.registerInstance(CAService, caService);

  const certService = new CertService(db, cryptoService, caService, auditService);
  container.registerInstance(CertService, certService);

  const crlService = new CRLService(db, caService, cacheService);
  container.registerInstance(CRLService, crlService);

  const ocspService = new OCSPService(db, cryptoService, caService, cacheService);
  container.registerInstance(OCSPService, ocspService);

  const exportService = new ExportService(cryptoService);
  container.registerInstance(ExportService, exportService);

  const tokensService = new TokensService(db, auditService);
  container.registerInstance(TokensService, tokensService);

  const alertService = new AlertService(db);
  container.registerInstance(AlertService, alertService);

  // Upsert built-in groups (creates on fresh install, syncs scopes on upgrade)
  {
    const { BUILTIN_GROUPS } = await import('@/lib/scopes.js');
    const { permissionGroups } = await import('@/db/schema/index.js');
    for (const bg of BUILTIN_GROUPS) {
      await db
        .insert(permissionGroups)
        .values({
          name: bg.name,
          description: bg.description,
          isBuiltin: true,
          scopes: [...bg.scopes],
        })
        .onConflictDoUpdate({
          target: permissionGroups.name,
          set: { scopes: [...bg.scopes], description: bg.description },
        });
    }
  }

  // Ensure system user exists before system CA (it's the owner of bootstrap resources)
  {
    const { users } = await import('@/db/schema/index.js');
    const { permissionGroups } = await import('@/db/schema/index.js');
    const { eq } = await import('drizzle-orm');
    const SYSTEM_OIDC = 'system:gateway-setup';
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.oidcSubject, SYSTEM_OIDC)).limit(1);
    if (existing.length === 0) {
      const adminGroup = await db.query.permissionGroups.findFirst({
        where: eq(permissionGroups.name, 'system-admin'),
      });
      if (adminGroup) {
        await db.insert(users).values({
          id: '00000000-0000-0000-0000-000000000000',
          oidcSubject: SYSTEM_OIDC,
          email: 'system@gateway.local',
          name: 'Gateway System',
          groupId: adminGroup.id,
        });
        logger.info('Created system user');
      }
    }
  }

  // System CA for node mTLS
  const systemCA = new SystemCAService(db, caService, certService, cryptoService);
  container.registerInstance(SystemCAService, systemCA);
  await systemCA.ensureSystemCA();

  // Nginx config generator (pure config generation, no I/O)
  const configValidator = new ConfigValidatorService();
  container.registerInstance(ConfigValidatorService, configValidator);

  const nginxConfigGenerator = new NginxConfigGenerator(configValidator);
  container.registerInstance(NginxConfigGenerator, nginxConfigGenerator);

  const folderService = new FolderService(db, auditService);
  container.registerInstance(FolderService, folderService);

  const nginxTemplateService = new NginxTemplateService(db, auditService);
  container.registerInstance(NginxTemplateService, nginxTemplateService);

  // Node management (daemon communication)
  const nodeRegistry = new NodeRegistryService(db);
  container.registerInstance(NodeRegistryService, nodeRegistry);

  const nodeDispatch = new NodeDispatchService(nodeRegistry, db);
  container.registerInstance(NodeDispatchService, nodeDispatch);

  const nodesService = new NodesService(db, auditService, nodeRegistry);
  container.registerInstance(NodesService, nodesService);

  const nodeMonitoringService = new NodeMonitoringService(nodeRegistry, cacheService);
  container.registerInstance(NodeMonitoringService, nodeMonitoringService);

  const dockerManagementService = new DockerManagementService(db, auditService, nodeDispatch, nodeRegistry);
  container.registerInstance(DockerManagementService, dockerManagementService);

  const dockerRegistryService = new DockerRegistryService(db, auditService, cryptoService, nodeDispatch);
  container.registerInstance(DockerRegistryService, dockerRegistryService);

  const dockerSecretService = new DockerSecretService(db, auditService, cryptoService);
  container.registerInstance(DockerSecretService, dockerSecretService);

  const dockerEnvironmentService = new DockerEnvironmentService(db, cryptoService);
  container.registerInstance(DockerEnvironmentService, dockerEnvironmentService);

  const dockerTaskService = new DockerTaskService(db);
  container.registerInstance(DockerTaskService, dockerTaskService);
  const dockerWebhookService = new DockerWebhookService(
    db,
    dockerManagementService,
    dockerTaskService,
    auditService,
    nodeDispatch
  );
  container.registerInstance(DockerWebhookService, dockerWebhookService);

  dockerManagementService.setTaskService(dockerTaskService);
  dockerManagementService.setEnvironmentService(dockerEnvironmentService);
  dockerManagementService.setSecretService(dockerSecretService);
  dockerManagementService.setEventBus(eventBus);
  dockerTaskService.setEventBus(eventBus);
  dockerWebhookService.setEventBus(eventBus);
  authService.setEventBus(eventBus);
  templatesService.setEventBus(eventBus);
  caService.setEventBus(eventBus);
  certService.setEventBus(eventBus);
  nodesService.setEventBus(eventBus);
  nodeRegistry.setEventBus(eventBus);
  folderService.setEventBus(eventBus);
  nginxTemplateService.setEventBus(eventBus);
  dockerRegistryService.setEventBus(eventBus);

  const proxyService = new ProxyService(
    db,
    nginxTemplateService,
    auditService,
    cryptoService,
    nginxConfigGenerator,
    nodeDispatch
  );
  proxyService.setEventBus(eventBus);
  container.registerInstance(ProxyService, proxyService);

  const acmeService = new ACMEService(env.ACME_EMAIL, env.ACME_STAGING);
  // Wire ACME HTTP-01 challenge callbacks to deploy/remove via daemon.
  // Looks up which node(s) serve the requested domains, falling back to default node.
  const resolveNodeIdsForDomains = async (domains: string[]): Promise<string[]> => {
    const { sql, or } = await import('drizzle-orm');
    const { proxyHosts } = await import('@/db/schema/index.js');
    const conditions = domains.map((d) => sql`${proxyHosts.domainNames} @> ${JSON.stringify([d])}::jsonb`);
    const rows = await db
      .selectDistinct({ nodeId: proxyHosts.nodeId })
      .from(proxyHosts)
      .where(or(...conditions));
    const nodeIds = rows.map((r) => r.nodeId).filter(Boolean) as string[];
    if (nodeIds.length > 0) return [...new Set(nodeIds)];
    // Fallback: deploy to all online nginx nodes (handles initial setup before any proxy hosts exist)
    const { nodes: nodesTable } = await import('@/db/schema/index.js');
    const { and: andOp, eq: eqOp } = await import('drizzle-orm');
    const allNginx = await db
      .select({ id: nodesTable.id })
      .from(nodesTable)
      .where(andOp(eqOp(nodesTable.type, 'nginx'), eqOp(nodesTable.status, 'online')));
    return allNginx.map((n) => n.id);
  };

  acmeService.onChallengeCreate = async (token: string, content: string, domains: string[]) => {
    const nodeIds = await resolveNodeIdsForDomains(domains);
    if (nodeIds.length === 0) throw new Error('No nginx node found for ACME challenge deployment');
    for (const nid of nodeIds) {
      await nodeDispatch.deployAcmeChallenge(nid, token, content);
    }
  };
  acmeService.onChallengeRemove = async (token: string, domains: string[]) => {
    const nodeIds = await resolveNodeIdsForDomains(domains);
    for (const nid of nodeIds) {
      await nodeDispatch.removeAcmeChallenge(nid, token);
    }
  };
  container.registerInstance(ACMEService, acmeService);

  const accessListService = new AccessListService(
    db,
    nginxConfigGenerator,
    nginxTemplateService,
    auditService,
    nodeDispatch
  );
  accessListService.setEventBus(eventBus);
  container.registerInstance(AccessListService, accessListService);

  const sslService = new SSLService(db, acmeService, nginxConfigGenerator, cryptoService, auditService, nodeDispatch);
  sslService.setEventBus(eventBus);
  container.registerInstance(SSLService, sslService);

  // Monitoring services
  const monitoringService = new MonitoringService(db);
  container.registerInstance(MonitoringService, monitoringService);

  const nginxStatsService = new NginxStatsService(nodeRegistry, nodeDispatch);
  container.registerInstance(NginxStatsService, nginxStatsService);

  const nginxConfigService = new NginxConfigService(nodeDispatch);
  container.registerInstance(NginxConfigService, nginxConfigService);

  // AI Settings
  const aiSettingsService = new AISettingsService(db, cryptoService);
  container.registerInstance(AISettingsService, aiSettingsService);

  // Domain management
  const domainsService = new DomainsService(db, auditService);
  domainsService.setEventBus(eventBus);
  container.registerInstance(DomainsService, domainsService);

  // Setup service (bootstrap management SSL)
  const setupService = new SetupService(db, sslService, proxyService, domainsService);
  container.registerInstance(SetupService, setupService);

  // Docker service (kept for self-update and image pruning only)
  const dockerService = new DockerService('/var/run/docker.sock', '');
  container.registerInstance(DockerService, dockerService);

  // Update service
  const updateService = new UpdateService(db, dockerService, env);
  container.registerInstance(UpdateService, updateService);

  const daemonUpdateService = new DaemonUpdateService(db, env);
  daemonUpdateService.setEventBus(eventBus);
  container.registerInstance(DaemonUpdateService, daemonUpdateService);
  nodeDispatch.setDaemonUpdateService(daemonUpdateService);
  nodesService.setDaemonUpdateService(daemonUpdateService);

  // Housekeeping service
  const housekeepingService = new HousekeepingService(db, dockerService, nodeDispatch, env);
  container.registerInstance(HousekeepingService, housekeepingService);

  // Group service (injectable — resolve from container)
  const groupService = container.resolve(GroupService);
  groupService.setEventBus(eventBus);

  // ── Notification services (before AI — AI uses them) ──────────────
  const notifRuleService = new NotificationAlertRuleService(db, auditService);
  notifRuleService.setEventBus(eventBus);
  container.registerInstance(NotificationAlertRuleService, notifRuleService);

  const notifWebhookService = new NotificationWebhookService(db, auditService, cryptoService);
  notifWebhookService.setEventBus(eventBus);
  container.registerInstance(NotificationWebhookService, notifWebhookService);

  const notifDeliveryService = new NotificationDeliveryService(db);
  container.registerInstance(NotificationDeliveryService, notifDeliveryService);

  const notifDispatcherService = new NotificationDispatcherService(db, notifWebhookService, env);
  container.registerInstance(NotificationDispatcherService, notifDispatcherService);

  // AI Service (depends on many services above)
  const aiService = new AIService(
    aiSettingsService,
    caService,
    certService,
    templatesService,
    proxyService,
    folderService,
    sslService,
    domainsService,
    accessListService,
    authService,
    auditService,
    monitoringService,
    nodesService,
    groupService,
    dockerManagementService,
    notifRuleService,
    notifWebhookService,
    notifDeliveryService,
    notifDispatcherService
  );
  container.registerInstance(AIService, aiService);

  // Configure DNS resolvers and detect public IP
  initDnsResolver(
    env.DNS_RESOLVERS.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  await detectPublicIP(env.PUBLIC_IPV4, env.PUBLIC_IPV6);

  const notifEvaluatorService = new NotificationEvaluatorService(
    db,
    notifRuleService,
    notifWebhookService,
    notifDispatcherService,
    cacheService,
    nodeRegistry
  );
  notifEvaluatorService.setEventBus(eventBus);
  notifEvaluatorService.start();
  container.registerInstance(NotificationEvaluatorService, notifEvaluatorService);

  housekeepingService.setNotifDeliveryService(notifDeliveryService);

  // Seed built-in templates
  await templatesService.seedBuiltinTemplates();
  await nginxTemplateService.seedBuiltinTemplates();

  // Background jobs
  const scheduler = new SchedulerService();
  container.registerInstance(SchedulerService, scheduler);

  const acmeRenewalJob = new ACMERenewalJob(db, sslService, alertService);
  acmeRenewalJob.setEventBus(eventBus);
  const healthCheckJob = new HealthCheckJob(db);
  healthCheckJob.setEventBus(eventBus);
  const expiryAlertJob = new ExpiryAlertJob(db, alertService, env.EXPIRY_WARNING_DAYS, env.EXPIRY_CRITICAL_DAYS);
  expiryAlertJob.setEventBus(eventBus);

  const dnsCheckJob = new DnsCheckJob(domainsService);
  scheduler.registerInterval('dns-check', env.DNS_CHECK_INTERVAL_SECONDS * 1000, () => dnsCheckJob.run());

  scheduler.register('acme-renewal', env.ACME_RENEWAL_CRON, () => acmeRenewalJob.run());
  scheduler.registerInterval('health-check', env.HEALTH_CHECK_INTERVAL_SECONDS * 1000, () => healthCheckJob.run());
  scheduler.register('expiry-alerts', env.EXPIRY_CHECK_CRON, () => expiryAlertJob.run());

  const updateCheckJob = new UpdateCheckJob(updateService);
  scheduler.registerInterval('update-check', env.UPDATE_CHECK_INTERVAL_HOURS * 3_600_000, () => updateCheckJob.run());

  const daemonUpdateCheckJob = new DaemonUpdateCheckJob(daemonUpdateService);
  scheduler.registerInterval('daemon-update-check', env.UPDATE_CHECK_INTERVAL_HOURS * 3_600_000, () =>
    daemonUpdateCheckJob.run()
  );

  const housekeepingJob = new HousekeepingJob(housekeepingService);
  const hkConfig = await housekeepingService.getConfig();
  scheduler.register('housekeeping', hkConfig.cronExpression, () => housekeepingJob.run());

  // Stale node detection (every 60 seconds) + missed health report detection (every 30 seconds)
  scheduler.registerInterval('stale-node-check', 60000, () => nodeRegistry.markStaleNodesOffline());
  scheduler.registerInterval('node-health-record', 30000, () => nodeRegistry.recordHealthChecks());

  // Notification webhook retry job (every 30 seconds)
  const notifRetryJob = new NotificationRetryJob(notifDeliveryService, notifDispatcherService);
  scheduler.registerInterval('notification-retry', 30000, () => notifRetryJob.run());

  logger.info('Dependency injection container initialized');
}
