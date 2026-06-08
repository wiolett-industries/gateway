import { getResourceScopedIds, hasScope, hasScopeBase } from '@/lib/permissions.js';
import type { AIToolDefinition } from './ai.types.js';

const BROAD_ONLY_TOOL_SCOPES = new Set(['create_proxy_host']);
const DIRECT_DATABASE_VIEW_TOOLS = new Set(['list_databases', 'get_database_connection']);
const DIRECT_DATABASE_VIEW_AND_QUERY_TOOLS = new Set([
  'query_postgres_read',
  'execute_postgres_sql',
  'browse_redis_keys',
  'get_redis_key',
  'set_redis_key',
  'execute_redis_command',
  'manage_postgres_data',
  'manage_redis_data',
]);
const ANY_SCOPE_TOOL_REQUIREMENTS: Record<string, string[]> = {
  find_resource: [
    'nodes:details',
    'proxy:view',
    'proxy:templates:view',
    'ssl:cert:view',
    'domains:view',
    'acl:view',
    'pki:ca:view:root',
    'pki:ca:view:intermediate',
    'pki:cert:view',
    'pki:templates:view',
    'docker:containers:view',
    'docker:images:view',
    'docker:volumes:view',
    'docker:networks:view',
    'docker:registries:view',
    'databases:view',
    'logs:environments:view',
    'logs:schemas:view',
    'status-page:view',
    'notifications:view',
  ],
  list_cas: ['pki:ca:view:root', 'pki:ca:view:intermediate'],
  get_ca: ['pki:ca:view:root', 'pki:ca:view:intermediate'],
  delete_ca: ['pki:ca:revoke:root', 'pki:ca:revoke:intermediate'],
  manage_ca: ['pki:ca:create:root', 'pki:ca:create:intermediate'],
  manage_certificate: ['pki:cert:view', 'pki:cert:issue', 'pki:cert:export'],
  manage_template: ['pki:templates:view', 'pki:templates:edit'],
  manage_proxy_template: [
    'proxy:templates:view',
    'proxy:templates:create',
    'proxy:templates:edit',
    'proxy:templates:delete',
  ],
  manage_ssl_certificate: ['ssl:cert:view', 'ssl:cert:issue', 'ssl:cert:delete'],
  manage_domain: ['domains:view', 'domains:edit'],
  manage_access_list: ['acl:view', 'acl:edit'],
  manage_docker_registry: [
    'docker:registries:view',
    'docker:registries:create',
    'docker:registries:edit',
    'docker:registries:delete',
  ],
  manage_docker_volume: ['docker:volumes:create', 'docker:volumes:delete'],
  manage_docker_network: ['docker:networks:create', 'docker:networks:edit', 'docker:networks:delete'],
  manage_docker_container_config: [
    'docker:containers:view',
    'docker:containers:environment',
    'docker:containers:files',
    'docker:containers:secrets',
    'docker:containers:webhooks',
    'docker:containers:edit',
  ],
  manage_database_connection: [
    'databases:view',
    'databases:create',
    'databases:edit',
    'databases:delete',
    'databases:credentials:reveal',
  ],
  manage_postgres_data: ['databases:query:read', 'databases:query:write'],
  manage_redis_data: ['databases:query:read', 'databases:query:write', 'databases:query:admin'],
  manage_logging: [
    'logs:environments:view',
    'logs:environments:create',
    'logs:environments:edit',
    'logs:environments:delete',
    'logs:tokens:view',
    'logs:tokens:create',
    'logs:tokens:delete',
    'logs:schemas:view',
    'logs:schemas:create',
    'logs:schemas:edit',
    'logs:schemas:delete',
    'logs:read',
    'logs:manage',
  ],
  manage_status_page: [
    'status-page:view',
    'status-page:manage',
    'status-page:incidents:create',
    'status-page:incidents:update',
    'status-page:incidents:resolve',
    'status-page:incidents:delete',
  ],
};

function hasDirectScopeBase(userScopes: string[], requiredScope: string): boolean {
  return userScopes.includes(requiredScope) || userScopes.some((scope) => scope.startsWith(`${requiredScope}:`));
}

function getDirectResourceScopedIds(userScopes: string[], baseScope: string): string[] {
  return userScopes
    .filter((scope) => scope.startsWith(`${baseScope}:`) && scope.length > baseScope.length + 1)
    .map((scope) => scope.slice(baseScope.length + 1));
}

function hasDirectDatabaseViewForQueryTool(userScopes: string[], queryScope: string): boolean {
  if (!hasScopeBase(userScopes, queryScope) || !hasDirectScopeBase(userScopes, 'databases:view')) return false;
  if (userScopes.includes('databases:view') || hasScope(userScopes, queryScope)) return true;

  const queryIds = new Set(getResourceScopedIds(userScopes, queryScope));
  return getDirectResourceScopedIds(userScopes, 'databases:view').some((databaseId) => queryIds.has(databaseId));
}

function hasAnyRequiredToolScope(userScopes: string[], toolName: string): boolean {
  const requirements = ANY_SCOPE_TOOL_REQUIREMENTS[toolName];
  return !!requirements && requirements.some((scope) => hasScopeBase(userScopes, scope));
}

export const AI_TOOLS: AIToolDefinition[] = [
  // ── Discovery ──
  {
    name: 'find_resource',
    description:
      'Search Gateway resources by name, hostname, domain, ID, image, or other visible identifiers across the resources this token can read. Returns compact, permission-filtered matches with resource type, id, name, nodeId when applicable, and safe summary fields.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search text, resource name, hostname, domain, ID, image, or key fragment.',
        },
        types: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'node',
              'proxy_host',
              'proxy_template',
              'ssl_certificate',
              'domain',
              'access_list',
              'ca',
              'pki_certificate',
              'pki_template',
              'docker_container',
              'docker_deployment',
              'docker_image',
              'docker_volume',
              'docker_network',
              'docker_registry',
              'database',
              'logging_environment',
              'logging_schema',
              'status_page_service',
              'status_page_incident',
              'notification_rule',
              'notification_webhook',
            ],
          },
          description: 'Optional resource types to search. Omit to search all readable resource types.',
        },
        nodeId: { type: 'string', description: 'Optional node UUID to constrain Docker resource searches.' },
        limit: {
          type: 'number',
          description: 'Maximum matches to return across all resource types (default 25, max 50).',
        },
      },
      required: ['query'],
    },
    destructive: false,
    category: 'Discovery',
    requiredScope: 'nodes:details',
    invalidateStores: [],
  },

  // ── PKI - Certificate Authorities ──
  {
    name: 'list_cas',
    description:
      'List all Certificate Authorities with their status, type, and hierarchy. Returns id, commonName, type (root/intermediate), status, notBefore, notAfter, parentId.',
    parameters: { type: 'object', properties: {} },
    destructive: false,
    category: 'PKI - Certificate Authorities',
    requiredScope: 'pki:ca:view:root',
    invalidateStores: [],
  },
  {
    name: 'get_ca',
    description: 'Get detailed information about a specific CA by ID, including its signing certificate details.',
    parameters: {
      type: 'object',
      properties: {
        caId: { type: 'string', description: 'CA UUID' },
      },
      required: ['caId'],
    },
    destructive: false,
    category: 'PKI - Certificate Authorities',
    requiredScope: 'pki:ca:view:root',
    invalidateStores: [],
  },
  {
    name: 'create_root_ca',
    description: 'Create a new root Certificate Authority. Returns the created CA.',
    parameters: {
      type: 'object',
      properties: {
        commonName: { type: 'string', description: 'CA common name (e.g., "My Root CA")' },
        keyAlgorithm: {
          type: 'string',
          enum: ['rsa-2048', 'rsa-4096', 'ecdsa-p256', 'ecdsa-p384'],
          description: 'Key algorithm',
        },
        validityYears: { type: 'number', description: 'Validity period in years (1-30)' },
        pathLengthConstraint: {
          type: 'number',
          description:
            'Max depth of CA chain below this CA. 0 = can only issue end-entity certs, 1 = one level of intermediates, etc. Omit for unlimited.',
        },
        maxValidityDays: { type: 'number', description: 'Max validity for issued certs in days (default: 825)' },
      },
      required: ['commonName', 'keyAlgorithm', 'validityYears'],
    },
    destructive: true,
    category: 'PKI - Certificate Authorities',
    requiredScope: 'pki:ca:create:root',
    invalidateStores: ['ca'],
  },
  {
    name: 'create_intermediate_ca',
    description: 'Create an intermediate CA signed by a parent CA.',
    parameters: {
      type: 'object',
      properties: {
        parentCaId: { type: 'string', description: 'Parent CA UUID' },
        commonName: { type: 'string', description: 'CA common name' },
        keyAlgorithm: {
          type: 'string',
          enum: ['rsa-2048', 'rsa-4096', 'ecdsa-p256', 'ecdsa-p384'],
          description: 'Key algorithm',
        },
        validityYears: { type: 'number', description: 'Validity period in years' },
        pathLengthConstraint: {
          type: 'number',
          description:
            'Max depth of CA chain below this CA. 0 = can only issue end-entity certs. Omit to auto-derive from parent.',
        },
        maxValidityDays: { type: 'number', description: 'Max validity for issued certs in days' },
      },
      required: ['parentCaId', 'commonName', 'keyAlgorithm', 'validityYears'],
    },
    destructive: true,
    category: 'PKI - Certificate Authorities',
    requiredScope: 'pki:ca:create:intermediate',
    invalidateStores: ['ca'],
  },
  {
    name: 'delete_ca',
    description: 'Permanently delete a Certificate Authority. Cannot be undone. CA must have no issued certificates.',
    parameters: {
      type: 'object',
      properties: {
        caId: { type: 'string', description: 'CA UUID to delete' },
      },
      required: ['caId'],
    },
    destructive: true,
    category: 'PKI - Certificate Authorities',
    requiredScope: 'pki:ca:revoke:root',
    invalidateStores: ['ca'],
  },
  {
    name: 'manage_ca',
    description:
      'Manage Certificate Authorities beyond create/delete. Operations: update. CA type-specific view/revoke/create scopes are enforced where needed.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['update'] },
        caId: { type: 'string' },
        crlDistributionUrl: { type: ['string', 'null'] },
        caIssuersUrl: { type: ['string', 'null'] },
        maxValidityDays: { type: 'number' },
      },
      required: ['operation', 'caId'],
    },
    destructive: true,
    category: 'PKI - Certificate Authorities',
    requiredScope: 'pki:ca:create:root',
    invalidateStores: ['ca'],
  },

  // ── PKI - Certificates ──
  {
    name: 'list_certificates',
    description:
      'List PKI certificates with optional filters. Returns paginated results with id, commonName, status, type, caId, notBefore, notAfter.',
    parameters: {
      type: 'object',
      properties: {
        caId: { type: 'string', description: 'Filter by CA UUID' },
        status: { type: 'string', enum: ['active', 'revoked', 'expired'], description: 'Filter by status' },
        search: { type: 'string', description: 'Search by common name' },
        page: { type: 'number', description: 'Page number (default: 1)' },
        limit: { type: 'number', description: 'Items per page (default: 50)' },
      },
    },
    destructive: false,
    category: 'PKI - Certificates',
    requiredScope: 'pki:cert:view',
    invalidateStores: [],
  },
  {
    name: 'get_certificate',
    description: 'Get detailed information about a specific certificate by ID.',
    parameters: {
      type: 'object',
      properties: {
        certificateId: { type: 'string', description: 'Certificate UUID' },
      },
      required: ['certificateId'],
    },
    destructive: false,
    category: 'PKI - Certificates',
    requiredScope: 'pki:cert:view',
    invalidateStores: [],
  },
  {
    name: 'issue_certificate',
    description:
      'Issue a new PKI certificate from a CA. Returns the certificate. To use it with proxy hosts, you must then import it as SSL certificate using link_internal_cert.',
    parameters: {
      type: 'object',
      properties: {
        caId: { type: 'string', description: 'Issuing CA UUID' },
        commonName: { type: 'string', description: 'Certificate common name (e.g., "server.example.com")' },
        keyAlgorithm: {
          type: 'string',
          enum: ['rsa-2048', 'rsa-4096', 'ecdsa-p256', 'ecdsa-p384'],
          description: 'Key algorithm',
        },
        validityDays: { type: 'number', description: 'Validity in days' },
        type: {
          type: 'string',
          enum: ['tls-server', 'tls-client', 'code-signing', 'email'],
          description: 'Certificate type. Use tls-server for web/SSL certificates.',
        },
        sans: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Subject Alternative Names as plain values WITHOUT type prefix. Examples: "example.com", "*.example.com", "10.0.0.1". Do NOT use "DNS:" or "IP:" prefixes.',
        },
        templateId: { type: 'string', description: 'Optional template UUID to use' },
        subjectDnFields: {
          type: 'object',
          properties: {
            o: { type: 'string', description: 'Organization' },
            ou: { type: 'string', description: 'Organizational Unit' },
            c: { type: 'string', description: 'Country (2-letter code)' },
            st: { type: 'string', description: 'State/Province' },
            l: { type: 'string', description: 'Locality/City' },
          },
          description: 'Optional subject DN fields beyond commonName',
        },
      },
      required: ['caId', 'commonName', 'keyAlgorithm', 'validityDays', 'type'],
    },
    destructive: true,
    category: 'PKI - Certificates',
    requiredScope: 'pki:cert:issue',
    invalidateStores: ['certificates', 'ca'],
  },
  {
    name: 'revoke_certificate',
    description: 'Revoke a certificate. This is permanent.',
    parameters: {
      type: 'object',
      properties: {
        certificateId: { type: 'string', description: 'Certificate UUID to revoke' },
        reason: { type: 'string', description: 'Revocation reason (e.g., "key_compromise", "unspecified")' },
      },
      required: ['certificateId', 'reason'],
    },
    destructive: true,
    category: 'PKI - Certificates',
    requiredScope: 'pki:cert:revoke',
    invalidateStores: ['certificates', 'ca'],
  },
  {
    name: 'manage_certificate',
    description:
      'Manage PKI certificates beyond generated issuance. Operations: issue_from_csr, export, chain. Operation-specific pki:cert:* scopes are enforced.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['issue_from_csr', 'export', 'chain'] },
        certificateId: { type: 'string' },
        caId: { type: 'string' },
        templateId: { type: 'string' },
        type: { type: 'string', enum: ['tls-server', 'tls-client', 'code-signing', 'email'] },
        csrPem: { type: 'string' },
        validityDays: { type: 'number' },
        overrideSans: { type: 'array', items: { type: 'string' } },
        format: { type: 'string', enum: ['pem', 'der', 'pkcs12', 'jks'] },
        passphrase: { type: 'string' },
      },
      required: ['operation'],
    },
    destructive: true,
    category: 'PKI - Certificates',
    requiredScope: 'pki:cert:view',
    invalidateStores: ['certificates', 'ca'],
  },

  // ── PKI - Templates ──
  {
    name: 'list_templates',
    description: 'List all certificate templates.',
    parameters: { type: 'object', properties: {} },
    destructive: false,
    category: 'PKI - Templates',
    requiredScope: 'pki:templates:view',
    invalidateStores: [],
  },
  {
    name: 'create_template',
    description: 'Create a new certificate template with predefined settings.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Template name' },
        type: {
          type: 'string',
          enum: ['tls-server', 'tls-client', 'code-signing', 'email'],
          description: 'Certificate type',
        },
        keyAlgorithm: { type: 'string', enum: ['rsa-2048', 'rsa-4096', 'ecdsa-p256', 'ecdsa-p384'] },
        validityDays: { type: 'number', description: 'Default validity in days' },
        keyUsage: { type: 'array', items: { type: 'string' }, description: 'Key usage flags' },
        extendedKeyUsage: { type: 'array', items: { type: 'string' }, description: 'Extended key usage OIDs' },
      },
      required: ['name', 'type', 'keyAlgorithm', 'validityDays'],
    },
    destructive: true,
    category: 'PKI - Templates',
    requiredScope: 'pki:templates:create',
    invalidateStores: ['templates'],
  },
  {
    name: 'delete_template',
    description: 'Delete a certificate template. Built-in templates cannot be deleted.',
    parameters: {
      type: 'object',
      properties: {
        templateId: { type: 'string', description: 'Template UUID to delete' },
      },
      required: ['templateId'],
    },
    destructive: true,
    category: 'PKI - Templates',
    requiredScope: 'pki:templates:delete',
    invalidateStores: ['templates'],
  },
  {
    name: 'manage_template',
    description: 'Get or update a PKI certificate template. Operations: get, update.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['get', 'update'] },
        templateId: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string', enum: ['tls-server', 'tls-client', 'code-signing', 'email'] },
        keyAlgorithm: { type: 'string', enum: ['rsa-2048', 'rsa-4096', 'ecdsa-p256', 'ecdsa-p384'] },
        validityDays: { type: 'number' },
        keyUsage: { type: 'array', items: { type: 'string' } },
        extendedKeyUsage: { type: 'array', items: { type: 'string' } },
      },
      required: ['operation', 'templateId'],
    },
    destructive: true,
    category: 'PKI - Templates',
    requiredScope: 'pki:templates:view',
    invalidateStores: ['templates'],
  },

  // ── Reverse Proxy ──
  {
    name: 'list_proxy_hosts',
    description: 'List all reverse proxy hosts with their status, domains, and SSL configuration.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search by domain name' },
        page: { type: 'number', description: 'Page number (default: 1)' },
        limit: { type: 'number', description: 'Items per page (default: 50)' },
      },
    },
    destructive: false,
    category: 'Reverse Proxy',
    requiredScope: 'proxy:view',
    invalidateStores: [],
  },
  {
    name: 'get_proxy_host',
    description: 'Get detailed configuration of a specific proxy host.',
    parameters: {
      type: 'object',
      properties: {
        proxyHostId: { type: 'string', description: 'Proxy host UUID' },
      },
      required: ['proxyHostId'],
    },
    destructive: false,
    category: 'Reverse Proxy',
    requiredScope: 'proxy:view',
    invalidateStores: [],
  },
  {
    name: 'create_proxy_host',
    description: 'Create a new reverse proxy host configuration.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['proxy', 'redirect', '404'], description: 'Host type (default: proxy)' },
        nodeId: { type: 'string', description: 'Node UUID to deploy this proxy host on (required)' },
        domainNames: { type: 'array', items: { type: 'string' }, description: 'Domain names for this host' },
        forwardHost: { type: 'string', description: 'Backend host to proxy to (for proxy type)' },
        forwardPort: { type: 'number', description: 'Backend port (for proxy type)' },
        forwardScheme: { type: 'string', enum: ['http', 'https'], description: 'Backend scheme (default: http)' },
        sslEnabled: { type: 'boolean', description: 'Enable SSL/TLS' },
        sslForced: { type: 'boolean', description: 'Force HTTPS redirect (default: false)' },
        sslCertificateId: {
          type: 'string',
          description: 'SSL certificate UUID to use (must be from ssl_certificates, not PKI)',
        },
        websocketSupport: { type: 'boolean', description: 'Enable WebSocket proxying' },
        http2Support: { type: 'boolean', description: 'Enable HTTP/2' },
        redirectUrl: { type: 'string', description: 'Redirect target URL (for redirect type)' },
        redirectStatusCode: { type: 'number', enum: [301, 302, 307, 308], description: 'Redirect status code' },
        customHeaders: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, value: { type: 'string' } },
            required: ['name', 'value'],
          },
          description: 'Custom HTTP headers to add to proxied requests',
        },
        cacheEnabled: { type: 'boolean', description: 'Enable response caching' },
        cacheOptions: {
          type: 'object',
          properties: {
            maxAge: { type: 'number', description: 'Cache max age in seconds' },
            staleWhileRevalidate: { type: 'number', description: 'Serve stale while revalidating (seconds)' },
          },
          description: 'Cache configuration (requires cacheEnabled)',
        },
        rateLimitEnabled: { type: 'boolean', description: 'Enable per-host rate limiting' },
        rateLimitOptions: {
          type: 'object',
          properties: {
            requestsPerSecond: { type: 'number', description: 'Max requests per second' },
            burst: { type: 'number', description: 'Burst allowance' },
          },
          required: ['requestsPerSecond'],
          description: 'Rate limit configuration (requires rateLimitEnabled)',
        },
        accessListId: { type: 'string', description: 'Access list UUID for IP/auth restrictions' },
        nginxTemplateId: { type: 'string', description: 'Custom nginx config template UUID' },
        templateVariables: { type: 'object', description: 'Variables for the nginx template (key-value pairs)' },
        healthCheckEnabled: { type: 'boolean', description: 'Enable backend health checks' },
        healthCheckUrl: { type: 'string', description: 'Health check endpoint path (e.g., /health)' },
        healthCheckInterval: { type: 'number', description: 'Seconds between health checks (5-3600, default: 30)' },
        healthCheckExpectedStatus: { type: 'number', description: 'Expected HTTP status code (100-599)' },
        healthCheckExpectedBody: { type: 'string', description: 'Expected response body string' },
      },
      required: ['nodeId', 'domainNames'],
    },
    destructive: true,
    category: 'Reverse Proxy',
    requiredScope: 'proxy:create',
    invalidateStores: ['proxy'],
  },
  {
    name: 'update_proxy_host',
    description: 'Update an existing proxy host configuration.',
    parameters: {
      type: 'object',
      properties: {
        proxyHostId: { type: 'string', description: 'Proxy host UUID' },
        domainNames: { type: 'array', items: { type: 'string' }, description: 'Domain names' },
        forwardHost: { type: 'string', description: 'Backend host' },
        forwardPort: { type: 'number', description: 'Backend port' },
        forwardScheme: { type: 'string', enum: ['http', 'https'] },
        sslEnabled: { type: 'boolean' },
        sslCertificateId: { type: 'string' },
        enabled: { type: 'boolean', description: 'Enable/disable the host' },
      },
      required: ['proxyHostId'],
    },
    destructive: true,
    category: 'Reverse Proxy',
    requiredScope: 'proxy:edit',
    invalidateStores: ['proxy'],
  },
  {
    name: 'delete_proxy_host',
    description: 'Permanently delete a proxy host and its nginx configuration.',
    parameters: {
      type: 'object',
      properties: {
        proxyHostId: { type: 'string', description: 'Proxy host UUID to delete' },
      },
      required: ['proxyHostId'],
    },
    destructive: true,
    category: 'Reverse Proxy',
    requiredScope: 'proxy:delete',
    invalidateStores: ['proxy'],
  },

  // ── Proxy Host Folders ──
  {
    name: 'create_proxy_folder',
    description: 'Create a folder to organize proxy hosts.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Folder name' },
        parentId: { type: 'string', description: 'Parent folder UUID for nesting (optional)' },
      },
      required: ['name'],
    },
    destructive: false,
    category: 'Reverse Proxy',
    requiredScope: 'proxy:folders:manage',
    invalidateStores: ['proxy'],
  },
  {
    name: 'move_hosts_to_folder',
    description: 'Move one or more proxy hosts into a folder (or to root by passing null as folderId).',
    parameters: {
      type: 'object',
      properties: {
        hostIds: { type: 'array', items: { type: 'string' }, description: 'Proxy host UUIDs to move' },
        folderId: { type: ['string', 'null'], description: 'Target folder UUID, or null to move to root (ungrouped)' },
      },
      required: ['hostIds', 'folderId'],
    },
    destructive: false,
    category: 'Reverse Proxy',
    requiredScope: 'proxy:folders:manage',
    invalidateStores: ['proxy'],
  },
  {
    name: 'delete_proxy_folder',
    description: 'Delete a proxy host folder. Hosts inside will be moved to root (ungrouped).',
    parameters: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Folder UUID to delete' },
      },
      required: ['folderId'],
    },
    destructive: true,
    category: 'Reverse Proxy',
    requiredScope: 'proxy:folders:manage',
    invalidateStores: ['proxy'],
  },
  {
    name: 'manage_proxy_template',
    description:
      'Manage custom nginx proxy templates. Operations: list, get, create, update, delete, clone. Operation-specific proxy:templates:* scopes are enforced.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete', 'clone'] },
        templateId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        type: { type: 'string', enum: ['proxy', 'redirect', '404'] },
        content: { type: 'string' },
        variables: { type: 'array', items: { type: 'object' } },
      },
      required: ['operation'],
    },
    destructive: true,
    category: 'Reverse Proxy',
    requiredScope: 'proxy:templates:view',
    invalidateStores: ['proxy'],
  },

  // ── SSL Certificates ──
  {
    name: 'list_ssl_certificates',
    description: 'List SSL/TLS certificates (ACME, uploaded, internal). Shows name, type, domains, expiry.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search by name or domain' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
    },
    destructive: false,
    category: 'SSL Certificates',
    requiredScope: 'ssl:cert:view',
    invalidateStores: [],
  },
  {
    name: 'request_acme_cert',
    description: "Request a new SSL certificate via ACME (Let's Encrypt). Requires DNS/HTTP challenge verification.",
    parameters: {
      type: 'object',
      properties: {
        domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Domain names to include in the certificate',
        },
        challengeType: { type: 'string', enum: ['http-01', 'dns-01'], description: 'ACME challenge type' },
        provider: {
          type: 'string',
          enum: ['letsencrypt', 'letsencrypt-staging'],
          description: 'ACME provider (default: letsencrypt)',
        },
        autoRenew: { type: 'boolean', description: 'Auto-renew before expiry (default: true)' },
      },
      required: ['domains', 'challengeType'],
    },
    destructive: true,
    category: 'SSL Certificates',
    requiredScope: 'ssl:cert:issue',
    invalidateStores: ['ssl'],
  },

  {
    name: 'link_internal_cert',
    description:
      'Import a PKI certificate as an SSL certificate so it can be used with proxy hosts. This links an existing PKI certificate (from the Certificates table) into the SSL certificates pool. You MUST use this before assigning a PKI-issued cert to a proxy host.',
    parameters: {
      type: 'object',
      properties: {
        internalCertId: { type: 'string', description: 'The PKI certificate UUID to import as SSL certificate' },
        name: { type: 'string', description: 'Display name for the SSL certificate (optional, defaults to cert CN)' },
      },
      required: ['internalCertId'],
    },
    destructive: false,
    category: 'SSL Certificates',
    requiredScope: 'ssl:cert:issue',
    invalidateStores: ['ssl'],
  },
  {
    name: 'manage_ssl_certificate',
    description:
      'Manage SSL certificates beyond listing/request/link. Operations: get, upload, renew, verify_dns, delete. Operation-specific ssl:cert:* scopes are enforced.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['get', 'upload', 'renew', 'verify_dns', 'delete'] },
        sslCertificateId: { type: 'string' },
        name: { type: 'string' },
        certificatePem: { type: 'string' },
        privateKeyPem: { type: 'string' },
        chainPem: { type: 'string' },
      },
      required: ['operation'],
    },
    destructive: true,
    category: 'SSL Certificates',
    requiredScope: 'ssl:cert:view',
    invalidateStores: ['ssl'],
  },

  // ── Domains ──
  {
    name: 'list_domains',
    description: 'List registered domains with their DNS verification status.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search by domain name' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
    },
    destructive: false,
    category: 'Domains',
    requiredScope: 'domains:view',
    invalidateStores: [],
  },
  {
    name: 'create_domain',
    description: 'Register a new domain for DNS verification and use with proxy hosts.',
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain name (e.g., "example.com")' },
        description: { type: 'string', description: 'Optional description' },
      },
      required: ['domain'],
    },
    destructive: false,
    category: 'Domains',
    requiredScope: 'domains:create',
    invalidateStores: ['domains'],
  },
  {
    name: 'delete_domain',
    description: 'Remove a registered domain.',
    parameters: {
      type: 'object',
      properties: {
        domainId: { type: 'string', description: 'Domain UUID to delete' },
      },
      required: ['domainId'],
    },
    destructive: true,
    category: 'Domains',
    requiredScope: 'domains:delete',
    invalidateStores: ['domains'],
  },
  {
    name: 'manage_domain',
    description: 'Get, update, or re-check DNS for a registered domain. Operations: get, update, check_dns.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['get', 'update', 'check_dns'] },
        domainId: { type: 'string' },
        description: { type: ['string', 'null'] },
      },
      required: ['operation', 'domainId'],
    },
    destructive: true,
    category: 'Domains',
    requiredScope: 'domains:view',
    invalidateStores: ['domains'],
  },

  // ── Access Lists ──
  {
    name: 'list_access_lists',
    description: 'List IP access control and basic authentication lists.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
    },
    destructive: false,
    category: 'Access Lists',
    requiredScope: 'acl:view',
    invalidateStores: [],
  },
  {
    name: 'create_access_list',
    description: 'Create a new access list with IP allow/deny rules and optional basic auth.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Access list name' },
        description: { type: 'string', description: 'Optional description' },
        allowIps: { type: 'array', items: { type: 'string' }, description: 'Allowed IP ranges (CIDR)' },
        denyIps: { type: 'array', items: { type: 'string' }, description: 'Denied IP ranges (CIDR)' },
        basicAuthEnabled: { type: 'boolean', description: 'Enable HTTP basic authentication (default: false)' },
        basicAuthUsers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              username: { type: 'string' },
              password: { type: 'string' },
            },
            required: ['username', 'password'],
          },
          description: 'Basic auth users (requires basicAuthEnabled)',
        },
      },
      required: ['name'],
    },
    destructive: true,
    category: 'Access Lists',
    requiredScope: 'acl:create',
    invalidateStores: ['accessLists'],
  },
  {
    name: 'delete_access_list',
    description: 'Delete an access list. Proxy hosts using it will no longer have access control.',
    parameters: {
      type: 'object',
      properties: {
        accessListId: { type: 'string', description: 'Access list UUID to delete' },
      },
      required: ['accessListId'],
    },
    destructive: true,
    category: 'Access Lists',
    requiredScope: 'acl:delete',
    invalidateStores: ['accessLists'],
  },
  {
    name: 'manage_access_list',
    description:
      'Get or update an access list. Operations: get, update. Update accepts name, description, ipRules, basicAuthEnabled, and basicAuthUsers.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['get', 'update'] },
        accessListId: { type: 'string' },
        name: { type: 'string' },
        description: { type: ['string', 'null'] },
        ipRules: { type: 'array', items: { type: 'object' } },
        basicAuthEnabled: { type: 'boolean' },
        basicAuthUsers: { type: 'array', items: { type: 'object' } },
      },
      required: ['operation', 'accessListId'],
    },
    destructive: true,
    category: 'Access Lists',
    requiredScope: 'acl:view',
    invalidateStores: ['accessLists'],
  },

  // ── Nodes ──
  {
    name: 'list_nodes',
    description: 'List all daemon nodes with their type, status, and connection info.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search by hostname' },
        type: {
          type: 'string',
          enum: ['nginx', 'monitoring', 'docker', 'bastion'],
          description: 'Filter by node type',
        },
        status: { type: 'string', enum: ['pending', 'online', 'offline'], description: 'Filter by status' },
        page: { type: 'number', description: 'Page number (default: 1)' },
        limit: { type: 'number', description: 'Items per page (default: 50)' },
      },
    },
    destructive: false,
    category: 'Nodes',
    requiredScope: 'nodes:details',
    invalidateStores: [],
  },
  {
    name: 'get_node',
    description: 'Get detailed information about a specific node including live health, stats, and system info.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node UUID' },
      },
      required: ['nodeId'],
    },
    destructive: false,
    category: 'Nodes',
    requiredScope: 'nodes:details',
    invalidateStores: [],
  },
  {
    name: 'create_node',
    description:
      'Create a new daemon node and generate an enrollment token. IMPORTANT: The response contains enrollmentToken and gatewayCertSha256 — you MUST display both to the user and include --gateway-cert-sha256 in setup commands (curl/wget). The token is one-time-use and cannot be retrieved again.',
    parameters: {
      type: 'object',
      properties: {
        hostname: { type: 'string', description: 'Node hostname (e.g., "proxy-01.example.com")' },
        type: {
          type: 'string',
          enum: ['nginx', 'monitoring', 'docker', 'bastion'],
          description: 'Node type (default: nginx)',
        },
        displayName: { type: 'string', description: 'Optional display name' },
      },
      required: ['hostname'],
    },
    destructive: true,
    category: 'Nodes',
    requiredScope: 'nodes:create',
    invalidateStores: ['nodes'],
  },
  {
    name: 'rename_node',
    description: 'Update a node display name.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node UUID' },
        displayName: { type: 'string', description: 'New display name' },
      },
      required: ['nodeId', 'displayName'],
    },
    destructive: true,
    category: 'Nodes',
    requiredScope: 'nodes:rename',
    invalidateStores: ['nodes'],
  },
  {
    name: 'delete_node',
    description: 'Delete a daemon node. The node must have no assigned proxy hosts. Also revokes its mTLS certificate.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node UUID to delete' },
      },
      required: ['nodeId'],
    },
    destructive: true,
    category: 'Nodes',
    requiredScope: 'nodes:delete',
    invalidateStores: ['nodes'],
  },

  // ── Raw Config ──
  {
    name: 'get_proxy_rendered_config',
    description:
      'Get the rendered nginx configuration for a proxy host. Shows either the template-generated or raw config.',
    parameters: {
      type: 'object',
      properties: {
        proxyHostId: { type: 'string', description: 'Proxy host UUID' },
      },
      required: ['proxyHostId'],
    },
    destructive: false,
    category: 'Reverse Proxy',
    requiredScope: 'proxy:raw:read',
    invalidateStores: [],
  },
  {
    name: 'update_proxy_raw_config',
    description: 'Write raw nginx configuration for a proxy host. Raw mode must be enabled first.',
    parameters: {
      type: 'object',
      properties: {
        proxyHostId: { type: 'string', description: 'Proxy host UUID' },
        rawConfig: { type: 'string', description: 'Raw nginx configuration content' },
      },
      required: ['proxyHostId', 'rawConfig'],
    },
    destructive: true,
    category: 'Reverse Proxy',
    requiredScope: 'proxy:raw:write',
    invalidateStores: ['proxy'],
  },
  {
    name: 'toggle_proxy_raw_mode',
    description:
      'Enable or disable raw config mode on a proxy host. When enabled, template rendering is bypassed and the raw config is used directly.',
    parameters: {
      type: 'object',
      properties: {
        proxyHostId: { type: 'string', description: 'Proxy host UUID' },
        enabled: { type: 'boolean', description: 'true to enable raw mode, false to disable' },
      },
      required: ['proxyHostId', 'enabled'],
    },
    destructive: true,
    category: 'Reverse Proxy',
    requiredScope: 'proxy:raw:toggle',
    invalidateStores: ['proxy'],
  },

  // ── Administration ──
  {
    name: 'list_users',
    description: 'List all users with their roles, email, and last login info.',
    parameters: { type: 'object', properties: {} },
    destructive: false,
    category: 'Administration',
    requiredScope: 'admin:users',
    invalidateStores: [],
  },
  {
    name: 'update_user_role',
    description: "Change a user's permission group. Use list_users to see available groups.",
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User UUID' },
        groupId: { type: 'string', description: 'Permission group UUID to assign' },
      },
      required: ['userId', 'groupId'],
    },
    destructive: true,
    category: 'Administration',
    requiredScope: 'admin:users',
    invalidateStores: ['users'],
  },
  {
    name: 'get_audit_log',
    description: 'Query the audit log. Returns paginated entries with action, user, resource, and timestamp.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Filter by action name' },
        resourceType: { type: 'string', description: 'Filter by resource type' },
        page: { type: 'number', description: 'Page number (default: 1)' },
        limit: { type: 'number', description: 'Items per page (default: 50)' },
      },
    },
    destructive: false,
    category: 'Administration',
    requiredScope: 'admin:audit',
    invalidateStores: [],
  },
  {
    name: 'get_dashboard_stats',
    description:
      'Get dashboard statistics: counts of CAs, certificates, proxy hosts, SSL certs, nodes, expiring items.',
    parameters: { type: 'object', properties: {} },
    destructive: false,
    category: 'Administration',
    requiredScope: 'feat:ai:use',
    invalidateStores: [],
  },

  // ── Permission Groups ──
  {
    name: 'list_groups',
    description: 'List all permission groups with their scopes, member counts, and inheritance info.',
    parameters: { type: 'object', properties: {} },
    destructive: false,
    category: 'Administration',
    requiredScope: 'admin:groups',
    invalidateStores: [],
  },
  {
    name: 'create_group',
    description: 'Create a new permission group with specific scopes. Can optionally inherit from a parent group.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Group name (e.g., "cert-operator")' },
        description: { type: 'string', description: 'Optional description' },
        scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of scope strings (e.g., ["cert:read", "cert:issue"])',
        },
        parentId: { type: 'string', description: 'Optional parent group UUID to inherit scopes from' },
      },
      required: ['name', 'scopes'],
    },
    destructive: true,
    category: 'Administration',
    requiredScope: 'admin:groups',
    invalidateStores: ['groups'],
  },
  {
    name: 'update_group',
    description: 'Update a permission group. Built-in groups cannot be modified.',
    parameters: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: 'Group UUID' },
        name: { type: 'string', description: 'New group name' },
        description: { type: 'string', description: 'New description' },
        scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'New scopes array (replaces existing)',
        },
        parentId: {
          type: ['string', 'null'],
          description: 'New parent group UUID, or null to remove inheritance',
        },
      },
      required: ['groupId'],
    },
    destructive: true,
    category: 'Administration',
    requiredScope: 'admin:groups',
    invalidateStores: ['groups'],
  },
  {
    name: 'delete_group',
    description: 'Delete a permission group. Cannot delete built-in groups or groups with assigned users.',
    parameters: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: 'Group UUID to delete' },
      },
      required: ['groupId'],
    },
    destructive: true,
    category: 'Administration',
    requiredScope: 'admin:groups',
    invalidateStores: ['groups'],
  },

  // ── Ask Question ──
  {
    name: 'ask_question',
    description:
      'Ask the user a clarifying question before proceeding. Use this whenever requirements are unclear, ambiguous, or missing critical details. You can provide options for the user to pick from, allow free text input, or both. Always ask rather than guess.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask the user' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Short option label' },
              description: { type: 'string', description: 'Optional longer description' },
            },
            required: ['label'],
          },
          description: 'Optional list of choices for the user to pick from',
        },
        allowFreeText: {
          type: 'boolean',
          description:
            'Whether to also show a free text input (default: true if no options, false if options provided)',
        },
      },
      required: ['question'],
    },
    destructive: false,
    category: 'Interaction',
    requiredScope: 'feat:ai:use',
    invalidateStores: [],
  },

  // ── Internal Documentation ──
  {
    name: 'internal_documentation',
    description:
      'Get detailed internal documentation about a specific topic in this system. Use this whenever you need deeper knowledge about how something works, what fields mean, or what the correct workflow is. Topics: pki, ssl, proxy, domains, access-lists, templates, acme, users, audit, nginx, nodes, docker, databases, postgres, redis, housekeeping, permissions, api.',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: [
            'pki',
            'ssl',
            'proxy',
            'domains',
            'access-lists',
            'templates',
            'acme',
            'users',
            'audit',
            'nginx',
            'nodes',
            'docker',
            'databases',
            'postgres',
            'redis',
            'housekeeping',
            'permissions',
            'api',
          ],
          description: 'The topic to get documentation about',
        },
      },
      required: ['topic'],
    },
    destructive: false,
    category: 'Documentation',
    requiredScope: 'feat:ai:use',
    invalidateStores: [],
  },

  // ── Docker: Containers ──
  {
    name: 'create_docker_container',
    description:
      'Create and start a new Docker container on a node. Specify image, ports, volumes, env vars, networks, restart policy, and labels.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        image: { type: 'string', description: 'Image reference (e.g. nginx:latest, ubuntu:24.04)' },
        registryId: { type: 'string', description: 'Optional Docker registry UUID for pulling the image' },
        name: { type: 'string', description: 'Container name (optional, auto-generated if omitted)' },
        ports: {
          type: 'array',
          description: 'Port mappings',
          items: {
            type: 'object',
            properties: {
              hostPort: { type: 'number' },
              containerPort: { type: 'number' },
              protocol: { type: 'string', enum: ['tcp', 'udp'], description: 'Default: tcp' },
            },
            required: ['hostPort', 'containerPort'],
          },
        },
        volumes: {
          type: 'array',
          description: 'Volume mounts. Supplying mounts also requires docker:containers:mounts for the node.',
          items: {
            type: 'object',
            properties: {
              hostPath: { type: 'string', description: 'Host path (for bind mounts)' },
              containerPath: { type: 'string' },
              name: { type: 'string', description: 'Volume name (for named volumes)' },
              readOnly: { type: 'boolean' },
            },
            required: ['containerPath'],
          },
        },
        env: { type: 'object', description: 'Environment variables as key-value pairs' },
        networks: { type: 'array', items: { type: 'string' }, description: 'Network names to connect to' },
        restartPolicy: {
          type: 'string',
          enum: ['no', 'always', 'unless-stopped', 'on-failure'],
          description: 'Default: no',
        },
        stopTimeout: {
          type: 'integer',
          minimum: 0,
          maximum: 300,
          description: 'Container stop grace period in seconds, 0-300. Default: Gateway fallback 20 seconds.',
        },
        labels: { type: 'object', description: 'Container labels as key-value pairs' },
        command: { type: 'array', items: { type: 'string' }, description: 'Override container command' },
      },
      required: ['nodeId', 'image'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:create',
    invalidateStores: ['containers'],
  },
  {
    name: 'list_docker_containers',
    description: 'List Docker containers on a specific node with their status, image, ports, and resource usage.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID (required)' },
        search: { type: 'string', description: 'Optional search over container ID, name, image, status, and ports' },
      },
      required: ['nodeId'],
    },
    destructive: false,
    category: 'Docker',
    requiredScope: 'docker:containers:view',
    invalidateStores: [],
  },
  {
    name: 'get_docker_container',
    description:
      'Get detailed information about a specific Docker container including config, state, mounts, and network settings.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        containerId: { type: 'string', description: 'Container ID' },
      },
      required: ['nodeId', 'containerId'],
    },
    destructive: false,
    category: 'Docker',
    requiredScope: 'docker:containers:view',
    invalidateStores: [],
  },
  {
    name: 'list_docker_deployments',
    description:
      'List blue/green Docker deployments on a specific node. Use this before acting on managed deployment containers; deployment rows include activeSlot, slots, routes, status, and health.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID (required)' },
        search: { type: 'string', description: 'Optional search over deployment name, image, status, and routes' },
      },
      required: ['nodeId'],
    },
    destructive: false,
    category: 'Docker',
    requiredScope: 'docker:containers:view',
    invalidateStores: [],
  },
  {
    name: 'get_docker_deployment',
    description:
      'Get detailed information about a blue/green Docker deployment by deployment ID. Use deploymentId, not the active slot container ID.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        deploymentId: { type: 'string', description: 'Gateway deployment ID' },
      },
      required: ['nodeId', 'deploymentId'],
    },
    destructive: false,
    category: 'Docker',
    requiredScope: 'docker:containers:view',
    invalidateStores: [],
  },
  {
    name: 'start_docker_deployment',
    description:
      'Start a stopped blue/green Docker deployment through the deployment layer. Do not start the underlying managed container directly.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        deploymentId: { type: 'string', description: 'Gateway deployment ID' },
      },
      required: ['nodeId', 'deploymentId'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:manage',
    invalidateStores: ['containers'],
  },
  {
    name: 'stop_docker_deployment',
    description:
      'Stop a blue/green Docker deployment through the deployment layer. Do not stop the underlying managed container directly.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        deploymentId: { type: 'string', description: 'Gateway deployment ID' },
      },
      required: ['nodeId', 'deploymentId'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:manage',
    invalidateStores: ['containers'],
  },
  {
    name: 'restart_docker_deployment',
    description:
      'Restart a blue/green Docker deployment through the deployment layer. Use this instead of restarting the active slot container.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        deploymentId: { type: 'string', description: 'Gateway deployment ID' },
      },
      required: ['nodeId', 'deploymentId'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:manage',
    invalidateStores: ['containers'],
  },
  {
    name: 'kill_docker_deployment',
    description:
      'Force-kill a blue/green Docker deployment through the deployment layer. Prefer stop_docker_deployment unless an immediate kill is explicitly requested.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        deploymentId: { type: 'string', description: 'Gateway deployment ID' },
      },
      required: ['nodeId', 'deploymentId'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:manage',
    invalidateStores: ['containers'],
  },
  {
    name: 'deploy_docker_deployment',
    description:
      'Deploy a new inactive slot for a blue/green Docker deployment, optionally with a full image reference or a new tag. This is the deployment-safe replacement for updating a managed slot container image.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        deploymentId: { type: 'string', description: 'Gateway deployment ID' },
        image: { type: 'string', description: 'Optional full image reference to deploy' },
        tag: { type: 'string', description: 'Optional tag applied to the current deployment image repository' },
        registryId: { type: 'string', description: 'Optional Docker registry UUID for pulling the image' },
        env: { type: 'object', description: 'Optional environment overrides for the new deployment config' },
      },
      required: ['nodeId', 'deploymentId'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:manage',
    invalidateStores: ['containers', 'tasks'],
  },
  {
    name: 'switch_docker_deployment_slot',
    description:
      'Switch a blue/green Docker deployment to the specified slot. Use only with the Gateway deployment ID and slot name, not a container ID.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        deploymentId: { type: 'string', description: 'Gateway deployment ID' },
        slot: { type: 'string', enum: ['blue', 'green'], description: 'Target slot to make active' },
        force: { type: 'boolean', description: 'Force switch even if health checks are not healthy (default false)' },
      },
      required: ['nodeId', 'deploymentId', 'slot'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:manage',
    invalidateStores: ['containers'],
  },
  {
    name: 'rollback_docker_deployment',
    description: 'Rollback a blue/green Docker deployment to the inactive previous slot.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        deploymentId: { type: 'string', description: 'Gateway deployment ID' },
        force: { type: 'boolean', description: 'Force rollback even if health checks are not healthy (default false)' },
      },
      required: ['nodeId', 'deploymentId'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:manage',
    invalidateStores: ['containers'],
  },
  {
    name: 'stop_docker_deployment_slot',
    description:
      'Stop an inactive blue/green deployment slot. The active slot cannot be stopped by this tool; use stop_docker_deployment to stop the whole deployment.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        deploymentId: { type: 'string', description: 'Gateway deployment ID' },
        slot: { type: 'string', enum: ['blue', 'green'], description: 'Inactive slot to stop' },
      },
      required: ['nodeId', 'deploymentId', 'slot'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:manage',
    invalidateStores: ['containers'],
  },
  {
    name: 'start_docker_container',
    description: 'Start a stopped Docker container.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        containerId: { type: 'string', description: 'Container ID' },
      },
      required: ['nodeId', 'containerId'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:manage',
    invalidateStores: ['containers'],
  },
  {
    name: 'stop_docker_container',
    description: 'Stop a running Docker container.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        containerId: { type: 'string', description: 'Container ID' },
        timeout: {
          type: 'integer',
          minimum: 0,
          maximum: 300,
          description: 'Seconds to wait before killing. If omitted, uses the container stop grace setting, then 20.',
        },
      },
      required: ['nodeId', 'containerId'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:manage',
    invalidateStores: ['containers'],
  },
  {
    name: 'restart_docker_container',
    description: 'Restart a Docker container.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        containerId: { type: 'string', description: 'Container ID' },
        timeout: {
          type: 'integer',
          minimum: 0,
          maximum: 300,
          description: 'Seconds to wait before killing. If omitted, uses the container stop grace setting, then 20.',
        },
      },
      required: ['nodeId', 'containerId'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:manage',
    invalidateStores: ['containers'],
  },
  {
    name: 'remove_docker_container',
    description: 'Remove a Docker container. The container must be stopped first unless force is true.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        containerId: { type: 'string', description: 'Container ID' },
        force: { type: 'boolean', description: 'Force remove even if running (default false)' },
      },
      required: ['nodeId', 'containerId'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:delete',
    invalidateStores: ['containers'],
  },
  {
    name: 'update_docker_container_image',
    description:
      'Update a Docker container to a different image tag. Pulls the new image, then recreates the container with the new image while preserving all other settings (ports, volumes, env, etc.). Use this to upgrade/downgrade container versions.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        containerId: { type: 'string', description: 'Container ID' },
        imageTag: { type: 'string', description: 'New image tag (e.g. "1.25", "latest", "v2.0.0")' },
      },
      required: ['nodeId', 'containerId', 'imageTag'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:manage',
    invalidateStores: ['containers', 'tasks'],
  },
  {
    name: 'rename_docker_container',
    description: 'Rename a Docker container.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        containerId: { type: 'string', description: 'Container ID' },
        name: { type: 'string', description: 'New container name' },
      },
      required: ['nodeId', 'containerId', 'name'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:edit',
    invalidateStores: ['containers'],
  },
  {
    name: 'duplicate_docker_container',
    description: 'Clone a Docker container with a new name. Copies config, ports, volumes, env, and secrets.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        containerId: { type: 'string', description: 'Container ID to clone' },
        name: { type: 'string', description: 'Name for the new container' },
      },
      required: ['nodeId', 'containerId', 'name'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:create',
    invalidateStores: ['containers'],
  },
  {
    name: 'get_docker_container_stats',
    description: 'Get live resource usage stats for a Docker container (CPU%, memory, network I/O, PIDs).',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        containerId: { type: 'string', description: 'Container ID' },
      },
      required: ['nodeId', 'containerId'],
    },
    destructive: false,
    category: 'Docker',
    requiredScope: 'docker:containers:view',
    invalidateStores: [],
  },
  {
    name: 'get_docker_container_logs',
    description: 'Get recent log output from a Docker container.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        containerId: { type: 'string', description: 'Container ID' },
        tail: { type: 'number', description: 'Number of lines from the end (default 100)' },
        timestamps: { type: 'boolean', description: 'Include timestamps (default false)' },
      },
      required: ['nodeId', 'containerId'],
    },
    destructive: false,
    category: 'Docker',
    requiredScope: 'docker:containers:view',
    invalidateStores: [],
  },

  // ── Docker: Images ──
  {
    name: 'list_docker_images',
    description: 'List Docker images on a specific node with their tags, size, and creation date.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID (required)' },
        search: { type: 'string', description: 'Optional search over image ID, tags, and digests' },
      },
      required: ['nodeId'],
    },
    destructive: false,
    category: 'Docker',
    requiredScope: 'docker:images:view',
    invalidateStores: [],
  },
  {
    name: 'pull_docker_image',
    description: 'Pull a Docker image from a registry onto a node.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        imageRef: { type: 'string', description: 'Image reference (e.g. nginx:latest, ghcr.io/org/app:v2)' },
        registryId: { type: 'string', description: 'Optional Docker registry UUID for pulling the image' },
      },
      required: ['nodeId', 'imageRef'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:images:pull',
    invalidateStores: ['images'],
  },

  {
    name: 'remove_docker_image',
    description: 'Remove a Docker image from a node.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
        imageId: { type: 'string', description: 'Image ID or reference (e.g. sha256:abc... or nginx:1.25)' },
        force: { type: 'boolean', description: 'Force remove even if in use (default false)' },
      },
      required: ['nodeId', 'imageId'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:images:delete',
    invalidateStores: ['images'],
  },
  {
    name: 'prune_docker_images',
    description: 'Remove all unused Docker images from a node to free disk space. Returns reclaimed space.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID' },
      },
      required: ['nodeId'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:images:delete',
    invalidateStores: ['images'],
  },

  // ── Docker: Volumes & Networks ──
  {
    name: 'list_docker_volumes',
    description: 'List Docker volumes on a specific node.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID (required)' },
        search: { type: 'string', description: 'Optional search over volume name, driver, mountpoint, and users' },
      },
      required: ['nodeId'],
    },
    destructive: false,
    category: 'Docker',
    requiredScope: 'docker:volumes:view',
    invalidateStores: [],
  },
  {
    name: 'list_docker_networks',
    description: 'List Docker networks on a specific node.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Docker node ID (required)' },
        search: { type: 'string', description: 'Optional search over network ID, name, driver, and scope' },
      },
      required: ['nodeId'],
    },
    destructive: false,
    category: 'Docker',
    requiredScope: 'docker:networks:view',
    invalidateStores: [],
  },
  {
    name: 'manage_docker_registry',
    description:
      'Manage saved Docker registries. Operations: list, get, create, update, delete, test, test_direct. Mutating operations require the corresponding docker:registries:* scope.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'delete', 'test', 'test_direct'],
        },
        registryId: { type: 'string', description: 'Registry UUID for get/update/delete/test' },
        nodeId: { type: 'string', description: 'Optional node filter for list, or node scoped registry owner' },
        name: { type: 'string' },
        url: { type: 'string' },
        username: { type: 'string' },
        password: { type: 'string' },
        trustedAuthRealm: { type: 'string' },
        scope: { type: 'string', enum: ['global', 'node'] },
      },
      required: ['operation'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:registries:view',
    invalidateStores: [],
  },
  {
    name: 'manage_docker_volume',
    description:
      'Create or delete Docker volumes on a node. Operations: create, delete. Listing is available via list_docker_volumes.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['create', 'delete'] },
        nodeId: { type: 'string' },
        name: { type: 'string' },
        driver: { type: 'string' },
        labels: { type: 'object' },
        force: { type: 'boolean' },
      },
      required: ['operation', 'nodeId', 'name'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:volumes:create',
    invalidateStores: [],
  },
  {
    name: 'manage_docker_network',
    description:
      'Create, delete, connect, or disconnect Docker networks on a node. Listing is available via list_docker_networks.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['create', 'delete', 'connect', 'disconnect'] },
        nodeId: { type: 'string' },
        networkId: { type: 'string', description: 'Network ID or name for delete/connect/disconnect' },
        name: { type: 'string', description: 'Network name for create' },
        driver: { type: 'string' },
        subnet: { type: 'string' },
        gateway: { type: 'string' },
        containerId: { type: 'string' },
      },
      required: ['operation', 'nodeId'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:networks:create',
    invalidateStores: [],
  },
  {
    name: 'manage_docker_task',
    description: 'List or get Docker background tasks for image pulls, container updates, and webhook actions.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['list', 'get'] },
        taskId: { type: 'string' },
        nodeId: { type: 'string' },
        status: { type: 'string' },
        type: { type: 'string' },
      },
      required: ['operation'],
    },
    destructive: false,
    category: 'Docker',
    requiredScope: 'docker:tasks',
    invalidateStores: [],
  },
  {
    name: 'manage_docker_container_config',
    description:
      'Manage container env, files, secrets, webhooks, and HTTP health checks. Operation-specific scopes are enforced: environment/files/secrets/webhooks/edit/view.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: [
            'get_env',
            'update_env',
            'list_files',
            'read_file',
            'write_file',
            'list_secrets',
            'create_secret',
            'update_secret',
            'delete_secret',
            'get_webhook',
            'upsert_webhook',
            'delete_webhook',
            'regenerate_webhook_token',
            'get_health_check',
            'upsert_health_check',
            'test_health_check',
          ],
        },
        targetType: { type: 'string', enum: ['container', 'deployment'], description: 'Defaults to container' },
        nodeId: { type: 'string' },
        containerId: { type: 'string' },
        containerName: { type: 'string' },
        deploymentId: { type: 'string' },
        secretId: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'string' },
        reveal: { type: 'boolean' },
        env: { type: 'object', description: 'Environment key/value map for update_env' },
        removeEnv: { type: 'array', items: { type: 'string' } },
        path: { type: 'string', description: 'Container file path' },
        content: { type: 'string', description: 'Base64-encoded file content for write_file' },
        enabled: { type: 'boolean', description: 'Webhook or health check enabled state' },
        healthCheck: { type: 'object', description: 'Docker health check configuration' },
      },
      required: ['operation', 'nodeId'],
    },
    destructive: true,
    category: 'Docker',
    requiredScope: 'docker:containers:view',
    invalidateStores: [],
  },

  // ── Databases ──
  {
    name: 'list_databases',
    description: 'List saved database connections managed by Gateway.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['postgres', 'redis'], description: 'Optional provider filter' },
        healthStatus: {
          type: 'string',
          enum: ['online', 'offline', 'degraded', 'unknown'],
          description: 'Optional health status filter',
        },
        search: { type: 'string', description: 'Optional text search' },
      },
    },
    destructive: false,
    category: 'Databases',
    requiredScope: 'databases:view',
    invalidateStores: [],
  },
  {
    name: 'get_database_connection',
    description: 'Get a saved database connection by ID, including provider, host, status, and safe config fields.',
    parameters: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database connection UUID' },
      },
      required: ['databaseId'],
    },
    destructive: false,
    category: 'Databases',
    requiredScope: 'databases:view',
    invalidateStores: [],
  },
  {
    name: 'query_postgres_read',
    description: 'Run a single read-only SQL statement against a saved Postgres connection.',
    parameters: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database connection UUID' },
        sql: { type: 'string', description: 'Single read-only SQL statement' },
      },
      required: ['databaseId', 'sql'],
    },
    destructive: false,
    category: 'Databases',
    requiredScope: 'databases:query:read',
    invalidateStores: [],
  },
  {
    name: 'execute_postgres_sql',
    description:
      'Run a SQL statement against a saved Postgres connection. Required permission is inferred from the SQL intent: read, write, or admin.',
    parameters: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database connection UUID' },
        sql: { type: 'string', description: 'Single SQL statement' },
      },
      required: ['databaseId', 'sql'],
    },
    destructive: true,
    category: 'Databases',
    requiredScope: 'databases:query:read',
    invalidateStores: [],
  },
  {
    name: 'browse_redis_keys',
    description: 'Browse keys in a saved Redis connection using SCAN.',
    parameters: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database connection UUID' },
        search: { type: 'string', description: 'Optional SCAN match pattern or substring search' },
        type: { type: 'string', description: 'Optional Redis TYPE filter' },
      },
      required: ['databaseId'],
    },
    destructive: false,
    category: 'Databases',
    requiredScope: 'databases:query:read',
    invalidateStores: [],
  },
  {
    name: 'get_redis_key',
    description: 'Get the value, type, and TTL of a Redis key from a saved connection.',
    parameters: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database connection UUID' },
        key: { type: 'string', description: 'Redis key name' },
      },
      required: ['databaseId', 'key'],
    },
    destructive: false,
    category: 'Databases',
    requiredScope: 'databases:query:read',
    invalidateStores: [],
  },
  {
    name: 'set_redis_key',
    description: 'Create or replace a Redis key using the visual-editor-compatible payload format.',
    parameters: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database connection UUID' },
        key: { type: 'string', description: 'Redis key name' },
        type: { type: 'string', enum: ['string', 'hash', 'list', 'set', 'zset'], description: 'Redis value type' },
        value: {
          type: 'object',
          description:
            'Value payload. Use a JSON string for string type, object for hash, array for list/set, array of {member,score} for zset.',
        },
        ttlSeconds: { type: 'number', description: 'Optional TTL in seconds' },
      },
      required: ['databaseId', 'key', 'type', 'value'],
    },
    destructive: true,
    category: 'Databases',
    requiredScope: 'databases:query:write',
    invalidateStores: [],
  },
  {
    name: 'execute_redis_command',
    description: 'Run a single Redis command against a saved Redis connection.',
    parameters: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database connection UUID' },
        command: { type: 'string', description: 'Single Redis command line' },
      },
      required: ['databaseId', 'command'],
    },
    destructive: true,
    category: 'Databases',
    requiredScope: 'databases:query:admin',
    invalidateStores: [],
  },
  {
    name: 'manage_database_connection',
    description:
      'Manage saved database connections. Operations: create, update, delete, test, reveal_credentials, health_history. Operation-specific database scopes are enforced.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['create', 'update', 'delete', 'test', 'reveal_credentials', 'health_history'],
        },
        databaseId: { type: 'string', description: 'Database connection UUID for update/delete/test/reveal/history' },
        type: { type: 'string', enum: ['postgres', 'redis'] },
        name: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        manualSizeLimitMb: { type: 'number' },
        config: {
          type: 'object',
          description:
            'Connection config. Postgres: connectionString or host/port/database/username/password/sslEnabled. Redis: connectionString or host/port/username/password/db/tlsEnabled.',
        },
      },
      required: ['operation'],
    },
    destructive: true,
    category: 'Databases',
    requiredScope: 'databases:view',
    invalidateStores: [],
  },
  {
    name: 'manage_postgres_data',
    description:
      'Explore and edit Postgres data for a saved connection. Operations: list_schemas, list_tables, table_metadata, browse_rows, insert_row, update_row, delete_row, add_column, update_column_type, delete_column.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: [
            'list_schemas',
            'list_tables',
            'table_metadata',
            'browse_rows',
            'insert_row',
            'update_row',
            'delete_row',
            'add_column',
            'update_column_type',
            'delete_column',
          ],
        },
        databaseId: { type: 'string' },
        schema: { type: 'string' },
        table: { type: 'string' },
        page: { type: 'number' },
        limit: { type: 'number' },
        sortBy: { type: 'string' },
        sortOrder: { type: 'string', enum: ['asc', 'desc'] },
        searchColumn: { type: 'string' },
        searchOperation: { type: 'string', enum: ['like', 'equals', 'notEquals', 'greaterThan', 'lessThan'] },
        searchValue: { type: 'string' },
        values: { type: 'object' },
        primaryKey: { type: 'object' },
        column: { type: 'string' },
        dataType: { type: 'string' },
      },
      required: ['operation', 'databaseId'],
    },
    destructive: true,
    category: 'Databases',
    requiredScope: 'databases:query:read',
    invalidateStores: [],
  },
  {
    name: 'manage_redis_data',
    description:
      'Explore and edit Redis data for a saved connection. Operations: scan_keys, get_key, set_key, delete_key, expire_key, execute_command. Command intent controls required read/write/admin query scope.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['scan_keys', 'get_key', 'set_key', 'delete_key', 'expire_key', 'execute_command'],
        },
        databaseId: { type: 'string' },
        cursor: { type: 'number' },
        limit: { type: 'number' },
        search: { type: 'string' },
        key: { type: 'string' },
        type: { type: 'string' },
        value: {},
        ttlSeconds: { type: 'number' },
        command: { type: 'string' },
        offset: { type: 'number' },
        maxStringBytes: { type: 'number' },
      },
      required: ['operation', 'databaseId'],
    },
    destructive: true,
    category: 'Databases',
    requiredScope: 'databases:query:read',
    invalidateStores: [],
  },

  // ── Logging ──
  {
    name: 'manage_logging',
    description:
      'Manage external logging environments, schemas, ingest tokens, metadata, facets, and search. Operation-specific logs:* scopes are enforced.',
    parameters: {
      type: 'object',
      properties: {
        resource: { type: 'string', enum: ['environment', 'schema', 'token', 'logs', 'metadata', 'facets'] },
        operation: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'delete', 'search', 'facets', 'metadata'],
        },
        environmentId: { type: 'string' },
        schemaId: { type: 'string' },
        tokenId: { type: 'string' },
        search: { type: 'string' },
        payload: { type: 'object', description: 'Create/update/search/facets body matching the logging API schema' },
      },
      required: ['resource', 'operation'],
    },
    destructive: true,
    category: 'Logging',
    requiredScope: 'logs:environments:view',
    invalidateStores: [],
  },

  // ── Status Page ──
  {
    name: 'manage_status_page',
    description:
      'Manage the status page settings, service list, incidents, incident updates, proxy template options, and preview. Operation-specific status-page:* scopes are enforced.',
    parameters: {
      type: 'object',
      properties: {
        resource: {
          type: 'string',
          enum: ['settings', 'proxy_templates', 'services', 'incidents', 'incident_updates', 'preview'],
        },
        operation: {
          type: 'string',
          enum: ['get', 'list', 'update', 'create', 'delete', 'resolve', 'promote', 'create_update', 'preview'],
        },
        serviceId: { type: 'string' },
        incidentId: { type: 'string' },
        status: { type: 'string', enum: ['active', 'resolved', 'all'] },
        limit: { type: 'number' },
        payload: { type: 'object', description: 'Create/update body matching the status page API schema' },
      },
      required: ['resource', 'operation'],
    },
    destructive: true,
    category: 'Status Page',
    requiredScope: 'status-page:view',
    invalidateStores: [],
  },

  // ── Web Search (conditional) ──
  // ── Notifications - Alert Rules ──
  {
    name: 'list_alert_rules',
    description:
      'List all notification alert rules. Returns id, name, enabled, type (threshold/event), category (node/container/proxy/certificate/database_postgres/database_redis), severity, metric, operator, thresholdValue, eventPattern, resourceIds, webhookIds, cooldownSeconds.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['node', 'container', 'proxy', 'certificate', 'database_postgres', 'database_redis'],
          description: 'Filter by category',
        },
        enabled: { type: 'boolean', description: 'Filter by enabled/disabled' },
      },
    },
    destructive: false,
    category: 'Notifications',
    requiredScope: 'notifications:view',
    invalidateStores: [],
  },
  {
    name: 'get_alert_rule',
    description: 'Get detailed information about a specific alert rule by ID.',
    parameters: {
      type: 'object',
      properties: {
        ruleId: { type: 'string', description: 'Alert rule UUID' },
      },
      required: ['ruleId'],
    },
    destructive: false,
    category: 'Notifications',
    requiredScope: 'notifications:view',
    invalidateStores: [],
  },
  {
    name: 'create_alert_rule',
    description:
      'Create a new notification alert rule. Threshold rules fire when a metric crosses a value. Event rules fire on system events like node offline or container stopped.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Alert name (e.g., "CPU High")' },
        type: { type: 'string', enum: ['threshold', 'event'], description: 'Rule type' },
        category: {
          type: 'string',
          enum: ['node', 'container', 'proxy', 'certificate', 'database_postgres', 'database_redis'],
          description: 'Resource category',
        },
        severity: { type: 'string', enum: ['info', 'warning', 'critical'], description: 'Alert severity' },
        metric: { type: 'string', description: 'For threshold: metric name (cpu, memory, disk, days_until_expiry)' },
        metricTarget: {
          type: 'string',
          description: 'For threshold: optional sub-target like a specific disk mount point',
        },
        operator: { type: 'string', enum: ['>', '>=', '<', '<='], description: 'For threshold: comparison operator' },
        thresholdValue: { type: 'number', description: 'For threshold: threshold value' },
        durationSeconds: {
          type: 'number',
          description: 'For threshold: observation window in seconds used for firing (0 = instant)',
        },
        fireThresholdPercent: {
          type: 'number',
          description:
            'For threshold: percent of probes in the fire window that must breach before firing (default 100)',
        },
        resolveAfterSeconds: {
          type: 'number',
          description: 'For threshold: observation window in seconds used for resolving (default 60)',
        },
        resolveThresholdPercent: {
          type: 'number',
          description:
            'For threshold: percent of probes in the resolve window that must be clear before resolving (default 100)',
        },
        eventPattern: { type: 'string', description: 'For event: event pattern (offline, stopped, oom_killed, etc.)' },
        resourceIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Scope to specific resources (empty = all)',
        },
        messageTemplate: {
          type: 'string',
          description: 'Handlebars message template (e.g., "CPU at {{value}}% on {{resource.name}}")',
        },
        webhookIds: { type: 'array', items: { type: 'string' }, description: 'Webhook IDs to deliver to' },
        cooldownSeconds: { type: 'number', description: 'Cooldown between repeated firings (default 900)' },
        enabled: { type: 'boolean', description: 'Whether the rule is active (default true)' },
      },
      required: ['name', 'type', 'category', 'severity', 'webhookIds'],
    },
    destructive: true,
    category: 'Notifications',
    requiredScope: 'notifications:manage',
    invalidateStores: [],
  },
  {
    name: 'update_alert_rule',
    description: 'Update an existing alert rule. Only include fields to change.',
    parameters: {
      type: 'object',
      properties: {
        ruleId: { type: 'string', description: 'Alert rule UUID' },
        name: { type: 'string', description: 'New name' },
        enabled: { type: 'boolean', description: 'Enable/disable' },
        severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
        metric: { type: 'string' },
        metricTarget: { type: 'string' },
        operator: { type: 'string', enum: ['>', '>=', '<', '<='] },
        thresholdValue: { type: 'number' },
        durationSeconds: { type: 'number' },
        fireThresholdPercent: { type: 'number' },
        resolveAfterSeconds: { type: 'number' },
        resolveThresholdPercent: { type: 'number' },
        eventPattern: { type: 'string' },
        resourceIds: { type: 'array', items: { type: 'string' } },
        messageTemplate: { type: 'string' },
        webhookIds: { type: 'array', items: { type: 'string' } },
        cooldownSeconds: { type: 'number' },
      },
      required: ['ruleId'],
    },
    destructive: true,
    category: 'Notifications',
    requiredScope: 'notifications:manage',
    invalidateStores: [],
  },
  {
    name: 'delete_alert_rule',
    description: 'Delete a notification alert rule.',
    parameters: {
      type: 'object',
      properties: {
        ruleId: { type: 'string', description: 'Alert rule UUID' },
      },
      required: ['ruleId'],
    },
    destructive: true,
    category: 'Notifications',
    requiredScope: 'notifications:manage',
    invalidateStores: [],
  },
  // ── Notifications - Webhooks ──
  {
    name: 'list_webhooks',
    description: 'List all notification webhooks. Returns id, name, url, method, enabled, templatePreset, headers.',
    parameters: { type: 'object', properties: {} },
    destructive: false,
    category: 'Notifications',
    requiredScope: 'notifications:view',
    invalidateStores: [],
  },
  {
    name: 'create_webhook',
    description:
      'Create a notification webhook endpoint. Webhooks define where and how alert notifications are delivered (Discord, Slack, Telegram, or custom HTTP). Use template presets for quick setup.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Webhook name (e.g., "Discord Alerts")' },
        url: { type: 'string', description: 'HTTP URL to POST to' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH'], description: 'HTTP method (default POST)' },
        templatePreset: {
          type: 'string',
          enum: ['discord', 'slack', 'telegram', 'json', 'plain'],
          description: 'Built-in template preset',
        },
        bodyTemplate: { type: 'string', description: 'Custom Handlebars body template (overrides preset)' },
        signingSecret: { type: 'string', description: 'HMAC-SHA256 signing secret (optional)' },
        signingHeader: { type: 'string', description: 'HMAC header name (default X-Signature-256)' },
      },
      required: ['name', 'url'],
    },
    destructive: true,
    category: 'Notifications',
    requiredScope: 'notifications:manage',
    invalidateStores: [],
  },
  {
    name: 'update_webhook',
    description: 'Update an existing webhook. Only include fields to change.',
    parameters: {
      type: 'object',
      properties: {
        webhookId: { type: 'string', description: 'Webhook UUID' },
        name: { type: 'string' },
        url: { type: 'string' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH'] },
        enabled: { type: 'boolean' },
        templatePreset: { type: 'string' },
        bodyTemplate: { type: 'string' },
        signingSecret: { type: 'string' },
        signingHeader: { type: 'string' },
      },
      required: ['webhookId'],
    },
    destructive: true,
    category: 'Notifications',
    requiredScope: 'notifications:manage',
    invalidateStores: [],
  },
  {
    name: 'delete_webhook',
    description: 'Delete a notification webhook.',
    parameters: {
      type: 'object',
      properties: {
        webhookId: { type: 'string', description: 'Webhook UUID' },
      },
      required: ['webhookId'],
    },
    destructive: true,
    category: 'Notifications',
    requiredScope: 'notifications:manage',
    invalidateStores: [],
  },
  {
    name: 'test_webhook',
    description:
      'Send a test notification to a webhook to verify it works. Returns success status, HTTP status code, and any error.',
    parameters: {
      type: 'object',
      properties: {
        webhookId: { type: 'string', description: 'Webhook UUID' },
      },
      required: ['webhookId'],
    },
    destructive: false,
    category: 'Notifications',
    requiredScope: 'notifications:manage',
    invalidateStores: [],
  },
  // ── Notifications - Delivery Log ──
  {
    name: 'list_webhook_deliveries',
    description:
      'List recent webhook delivery attempts. Returns delivery status, HTTP response code, timing, retry info. Use to diagnose delivery failures.',
    parameters: {
      type: 'object',
      properties: {
        webhookId: { type: 'string', description: 'Filter by webhook UUID' },
        status: {
          type: 'string',
          enum: ['success', 'failed', 'retrying', 'pending'],
          description: 'Filter by delivery status',
        },
        limit: { type: 'number', description: 'Max results (default 50)' },
      },
    },
    destructive: false,
    category: 'Notifications',
    requiredScope: 'notifications:view',
    invalidateStores: [],
  },
  {
    name: 'get_delivery_stats',
    description: 'Get delivery statistics (total, success, failed, retrying counts). Optionally filter by webhook.',
    parameters: {
      type: 'object',
      properties: {
        webhookId: { type: 'string', description: 'Filter by webhook UUID' },
      },
    },
    destructive: false,
    category: 'Notifications',
    requiredScope: 'notifications:view',
    invalidateStores: [],
  },
  {
    name: 'web_search',
    description:
      "Search the web for current information about PKI, certificates, protocols, or any topic. Use when the user asks about something you don't know or needs up-to-date information.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: { type: 'number', description: 'Max results (default 5, max 10)' },
      },
      required: ['query'],
    },
    destructive: false,
    category: 'Web Search',
    requiredScope: 'feat:ai:use',
    invalidateStores: [],
  },
];

const destructiveSet = new Set(AI_TOOLS.filter((t) => t.destructive).map((t) => t.name));

export function isDestructiveTool(name: string): boolean {
  return destructiveSet.has(name);
}

/**
 * Map of tool names to frontend store names that should be invalidated after execution.
 */
export const TOOL_STORE_INVALIDATION_MAP: Record<string, string[]> = Object.fromEntries(
  AI_TOOLS.filter((t) => t.invalidateStores.length > 0).map((t) => [t.name, t.invalidateStores])
);

/**
 * Get tools in OpenAI function-calling format, filtered by:
 * - Disabled tools (admin config)
 * - User scopes (only tools the user has the required scope for)
 * - Web search availability
 */
export function getOpenAITools(
  disabledTools: string[],
  userScopes: string[],
  webSearchEnabled: boolean
): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  return AI_TOOLS.filter((t) => {
    if (disabledTools.includes(t.name)) return false;
    if (t.name === 'web_search' && !webSearchEnabled) return false;
    // Every tool must have a requiredScope — reject tools without one
    if (!t.requiredScope) return false;
    if (DIRECT_DATABASE_VIEW_AND_QUERY_TOOLS.has(t.name)) {
      return hasDirectDatabaseViewForQueryTool(userScopes, t.requiredScope);
    }
    if (ANY_SCOPE_TOOL_REQUIREMENTS[t.name]) return hasAnyRequiredToolScope(userScopes, t.name);
    if (DIRECT_DATABASE_VIEW_TOOLS.has(t.name)) return hasDirectScopeBase(userScopes, t.requiredScope);
    return BROAD_ONLY_TOOL_SCOPES.has(t.name)
      ? hasScope(userScopes, t.requiredScope)
      : hasScopeBase(userScopes, t.requiredScope);
  }).map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
