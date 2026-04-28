import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { container } from '@/container.js';
import { hasScope } from '@/lib/permissions.js';
import { DOC_TOPIC_SCOPES, INTERNAL_DOCS } from '@/modules/ai/ai.docs.js';
import { LoggingEnvironmentService } from '@/modules/logging/logging-environment.service.js';
import { MonitoringService } from '@/modules/monitoring/monitoring.service.js';
import { NodesService } from '@/modules/nodes/nodes.service.js';
import { ProxyService } from '@/modules/proxy/proxy.service.js';
import { SSLService } from '@/modules/ssl/ssl.service.js';
import { StatusPageService } from '@/modules/status-page/status-page.service.js';

type ResourceDefinition = {
  name: string;
  uri: string;
  title: string;
  description: string;
  requiredScopes: string[];
  read: (uri: URL, scopes: string[]) => Promise<unknown>;
};

function canAccess(scopes: string[], requiredScopes: string[]): boolean {
  return requiredScopes.some((scope) => hasScope(scopes, scope));
}

function compactResource(uri: URL, data: unknown) {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: 'application/json',
        text: JSON.stringify(data),
      },
    ],
  };
}

function take<T>(items: T[] | undefined, limit = 25): T[] {
  return (items ?? []).slice(0, limit);
}

function docUri(topic: string): string {
  return `gateway://docs/${encodeURIComponent(topic)}`;
}

function docRequiredScope(topic: string): string {
  const requiredScope = DOC_TOPIC_SCOPES[topic];
  return requiredScope === 'feat:ai:use' || !requiredScope ? 'mcp:use' : requiredScope;
}

function accessibleDocTopics(scopes: string[]) {
  return Object.keys(INTERNAL_DOCS)
    .sort()
    .filter((topic) => hasScope(scopes, docRequiredScope(topic)))
    .map((topic) => ({
      topic,
      uri: docUri(topic),
      requiredScope: docRequiredScope(topic),
    }));
}

const operationalResources: ResourceDefinition[] = [
  {
    name: 'gateway-overview',
    uri: 'gateway://overview',
    title: 'Gateway overview',
    description: 'Dashboard-level counts filtered to the token scopes.',
    requiredScopes: ['proxy:list', 'ssl:cert:list', 'pki:cert:list', 'pki:ca:list:root', 'nodes:list'],
    async read(_uri, scopes) {
      const stats = await container.resolve(MonitoringService).getDashboardStats();
      const filtered: Record<string, unknown> = { generatedAt: new Date().toISOString() };
      if (hasScope(scopes, 'proxy:list')) filtered.proxyHosts = stats.proxyHosts;
      if (hasScope(scopes, 'ssl:cert:list')) filtered.sslCertificates = stats.sslCertificates;
      if (hasScope(scopes, 'pki:cert:list')) filtered.pkiCertificates = stats.pkiCertificates;
      if (hasScope(scopes, 'pki:ca:list:root')) filtered.cas = stats.cas;
      if (hasScope(scopes, 'nodes:list')) filtered.nodes = stats.nodes;
      return filtered;
    },
  },
  {
    name: 'gateway-nodes',
    uri: 'gateway://nodes',
    title: 'Gateway nodes',
    description: 'Bounded list of Gateway nodes and connection state.',
    requiredScopes: ['nodes:list'],
    async read() {
      const result = await container.resolve(NodesService).list({ page: 1, limit: 25 });
      return {
        total: result.total,
        nodes: take(result.data).map((node) => ({
          id: node.id,
          hostname: node.hostname,
          displayName: node.displayName,
          type: node.type,
          status: node.status,
          isConnected: node.isConnected,
        })),
      };
    },
  },
  {
    name: 'gateway-proxy-hosts',
    uri: 'gateway://proxy/hosts',
    title: 'Proxy hosts',
    description: 'Bounded list of reverse proxy hosts and health status.',
    requiredScopes: ['proxy:list'],
    async read() {
      const result = await container.resolve(ProxyService).listProxyHosts({ page: 1, limit: 25 });
      return {
        total: result.pagination.total,
        hosts: take(result.data).map((host) => ({
          id: host.id,
          domainNames: host.domainNames,
          type: host.type,
          enabled: host.enabled,
          nodeId: host.nodeId,
          forwardHost: host.forwardHost,
          forwardPort: host.forwardPort,
          sslEnabled: host.sslEnabled,
          healthStatus: host.healthStatus,
          effectiveHealthStatus: (host as { effectiveHealthStatus?: string }).effectiveHealthStatus,
        })),
      };
    },
  },
  {
    name: 'gateway-docker-nodes',
    uri: 'gateway://docker/nodes',
    title: 'Docker nodes',
    description: 'Bounded list of Docker-capable nodes.',
    requiredScopes: ['nodes:list'],
    async read() {
      const result = await container.resolve(NodesService).list({
        type: 'docker',
        page: 1,
        limit: 25,
      });
      return {
        total: result.total,
        nodes: take(result.data).map((node) => ({
          id: node.id,
          hostname: node.hostname,
          displayName: node.displayName,
          status: node.status,
          isConnected: node.isConnected,
        })),
      };
    },
  },
  {
    name: 'gateway-logging-environments',
    uri: 'gateway://logging/environments',
    title: 'Logging environments',
    description: 'Bounded list of external logging environments.',
    requiredScopes: ['logs:environments:list'],
    async read() {
      const environments = await container.resolve(LoggingEnvironmentService).list();
      return {
        total: environments.length,
        environments: take(environments).map((environment) => ({
          id: environment.id,
          name: environment.name,
          slug: environment.slug,
          enabled: environment.enabled,
          schemaMode: environment.schemaMode,
          retentionDays: environment.retentionDays,
          rateLimitRequestsPerWindow: environment.rateLimitRequestsPerWindow,
          rateLimitEventsPerWindow: environment.rateLimitEventsPerWindow,
        })),
      };
    },
  },
  {
    name: 'gateway-status-page-summary',
    uri: 'gateway://status-page/summary',
    title: 'Status page summary',
    description: 'Status page config, exposed services, and active incidents.',
    requiredScopes: ['status-page:view'],
    async read() {
      const service = container.resolve(StatusPageService);
      const [config, services, incidents] = await Promise.all([
        service.getConfig(),
        service.listServices(),
        service.listIncidents({ status: 'active', limit: 10 }),
      ]);
      return {
        config: {
          enabled: config.enabled,
          domain: config.domain,
          nodeId: config.nodeId,
          proxyHostId: config.proxyHostId,
        },
        services: take(services, 25).map((entry) => ({
          id: entry.id,
          publicName: entry.publicName,
          publicGroup: entry.publicGroup,
          enabled: entry.enabled,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          currentStatus: entry.currentStatus,
          broken: entry.broken,
        })),
        activeIncidents: take(incidents, 10).map((incident) => ({
          id: incident.id,
          title: incident.title,
          severity: incident.severity,
          status: incident.status,
          affectedServiceIds: incident.affectedServiceIds,
          startedAt: incident.startedAt,
        })),
      };
    },
  },
  {
    name: 'gateway-certificates-expiring',
    uri: 'gateway://certificates/expiring',
    title: 'Expiring certificates',
    description: 'SSL certificates expiring in the next 30 days.',
    requiredScopes: ['ssl:cert:list'],
    async read() {
      const certs = await container.resolve(SSLService).getCertsExpiringSoon(30);
      return {
        windowDays: 30,
        total: certs.length,
        certificates: take(certs).map((cert) => ({
          id: cert.id,
          name: cert.name,
          domainNames: cert.domainNames,
          type: cert.type,
          status: cert.status,
          autoRenew: cert.autoRenew,
          notAfter: cert.notAfter,
        })),
      };
    },
  },
];

const docsResources: ResourceDefinition[] = [
  {
    name: 'gateway-internal-docs',
    uri: 'gateway://docs',
    title: 'Gateway internal documentation',
    description: 'Index of internal documentation topics available to this MCP token.',
    requiredScopes: ['mcp:use'],
    async read(_uri, scopes) {
      const topics = accessibleDocTopics(scopes);
      return {
        total: topics.length,
        topics,
      };
    },
  },
  ...Object.keys(INTERNAL_DOCS)
    .sort()
    .map(
      (topic): ResourceDefinition => ({
        name: `gateway-internal-docs-${topic}`,
        uri: docUri(topic),
        title: `Gateway internal documentation: ${topic}`,
        description: `Internal Gateway operator documentation for ${topic}.`,
        requiredScopes: [docRequiredScope(topic)],
        async read() {
          return {
            topic,
            content: INTERNAL_DOCS[topic],
          };
        },
      })
    ),
];

const resources: ResourceDefinition[] = [...operationalResources, ...docsResources];

export function registerMcpResources(server: McpServer, scopes: string[]): void {
  for (const resource of resources) {
    if (!canAccess(scopes, resource.requiredScopes)) continue;
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: 'application/json',
      },
      async (uri) => compactResource(uri, await resource.read(uri, scopes))
    );
  }
}
