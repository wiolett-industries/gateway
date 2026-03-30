import type { AIToolDefinition } from './ai.types.js';

export const AI_TOOLS: AIToolDefinition[] = [
  // ── PKI - Certificate Authorities ──
  {
    name: 'list_cas',
    description:
      'List all Certificate Authorities with their status, type, and hierarchy. Returns id, commonName, type (root/intermediate), status, notBefore, notAfter, parentId.',
    parameters: { type: 'object', properties: {} },
    destructive: false,
    category: 'PKI - Certificate Authorities',
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'admin',
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
    requiredRole: 'admin',
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
    requiredRole: 'admin',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
    invalidateStores: ['certificates', 'ca'],
  },

  // ── PKI - Templates ──
  {
    name: 'list_templates',
    description: 'List all certificate templates.',
    parameters: { type: 'object', properties: {} },
    destructive: false,
    category: 'PKI - Templates',
    requiredRole: 'operator',
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
    requiredRole: 'admin',
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
    requiredRole: 'admin',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
    invalidateStores: [],
  },
  {
    name: 'create_proxy_host',
    description: 'Create a new reverse proxy host configuration.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['proxy', 'redirect', '404'], description: 'Host type (default: proxy)' },
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
      required: ['domainNames'],
    },
    destructive: true,
    category: 'Reverse Proxy',
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
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
    requiredRole: 'operator',
    invalidateStores: ['accessLists'],
  },

  // ── Administration ──
  {
    name: 'list_users',
    description: 'List all users with their roles, email, and last login info.',
    parameters: { type: 'object', properties: {} },
    destructive: false,
    category: 'Administration',
    requiredRole: 'admin',
    invalidateStores: [],
  },
  {
    name: 'update_user_role',
    description: "Change a user's role. Available roles: admin, operator, viewer, blocked.",
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User UUID' },
        role: { type: 'string', enum: ['admin', 'operator', 'viewer', 'blocked'], description: 'New role' },
      },
      required: ['userId', 'role'],
    },
    destructive: true,
    category: 'Administration',
    requiredRole: 'admin',
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
    requiredRole: 'admin',
    invalidateStores: [],
  },
  {
    name: 'get_dashboard_stats',
    description: 'Get dashboard statistics: counts of CAs, certificates, proxy hosts, SSL certs, expiring items.',
    parameters: { type: 'object', properties: {} },
    destructive: false,
    category: 'Administration',
    requiredRole: 'operator',
    invalidateStores: [],
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
    requiredRole: 'operator',
    invalidateStores: [],
  },

  // ── Internal Documentation ──
  {
    name: 'internal_documentation',
    description:
      'Get detailed internal documentation about a specific topic in this system. Use this whenever you need deeper knowledge about how something works, what fields mean, or what the correct workflow is. Topics: pki, ssl, proxy, domains, access-lists, templates, acme, users, audit, nginx, housekeeping.',
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
            'housekeeping',
          ],
          description: 'The topic to get documentation about',
        },
      },
      required: ['topic'],
    },
    destructive: false,
    category: 'Documentation',
    requiredRole: 'operator',
    invalidateStores: [],
  },

  // ── Web Search (conditional) ──
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
    requiredRole: 'operator',
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
 * - User role (only tools the user's role can access)
 * - Web search availability
 */
export function getOpenAITools(
  disabledTools: string[],
  userRole: string,
  webSearchEnabled: boolean
): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  const roleHierarchy: Record<string, number> = { blocked: -1, viewer: 0, operator: 1, admin: 2 };
  const userLevel = roleHierarchy[userRole] ?? 0;

  return AI_TOOLS.filter((t) => {
    if (disabledTools.includes(t.name)) return false;
    if (t.name === 'web_search' && !webSearchEnabled) return false;
    const requiredLevel = roleHierarchy[t.requiredRole] ?? 0;
    return userLevel >= requiredLevel;
  }).map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
