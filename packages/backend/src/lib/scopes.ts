/**
 * Unified scope definitions for the group-based permissions system.
 * Both session users (via group membership) and API tokens use these scopes.
 *
 * Naming convention: domain:resource:action[:qualifier]
 * Resource-scopable scopes support suffixes: e.g. docker:containers:view:node-uuid
 */

export const ALL_SCOPES = [
  // ── PKI: Certificate Authorities ─────────────────────────────────
  'pki:ca:list:root',
  'pki:ca:list:intermediate',
  'pki:ca:view:root',
  'pki:ca:view:intermediate',
  'pki:ca:create:root',
  'pki:ca:create:intermediate',
  'pki:ca:revoke:root',
  'pki:ca:revoke:intermediate',
  // ── PKI: Certificates ────────────────────────────────────────────
  'pki:cert:list',
  'pki:cert:view',
  'pki:cert:issue',
  'pki:cert:revoke',
  'pki:cert:export',
  // ── PKI: Certificate Templates ───────────────────────────────────
  'pki:templates:list',
  'pki:templates:view',
  'pki:templates:create',
  'pki:templates:edit',
  'pki:templates:delete',
  // ── Proxy Hosts ──────────────────────────────────────────────────
  'proxy:list',
  'proxy:view',
  'proxy:create',
  'proxy:edit',
  'proxy:delete',
  'proxy:raw:read',
  'proxy:raw:write',
  'proxy:raw:toggle',
  'proxy:advanced',
  'proxy:advanced:bypass',
  // ── SSL Certificates ─────────────────────────────────────────────
  'ssl:cert:list',
  'ssl:cert:view',
  'ssl:cert:issue',
  'ssl:cert:delete',
  'ssl:cert:revoke',
  'ssl:cert:export',
  // ── Access Control Lists ─────────────────────────────────────────
  'acl:list',
  'acl:view',
  'acl:create',
  'acl:edit',
  'acl:delete',
  // ── Nodes ────────────────────────────────────────────────────────
  'nodes:list',
  'nodes:details',
  'nodes:create',
  'nodes:rename',
  'nodes:delete',
  'nodes:config:view',
  'nodes:config:edit',
  'nodes:logs',
  'nodes:console',
  'nodes:lock',
  // ── Administration ───────────────────────────────────────────────
  'admin:users',
  'admin:groups',
  'admin:audit',
  'admin:system',
  'admin:details:certificates',
  'admin:update',
  'admin:alerts',
  // ── Gateway Settings ─────────────────────────────────────────────
  'settings:gateway:view',
  'settings:gateway:edit',
  // ── Housekeeping ─────────────────────────────────────────────────
  'housekeeping:view',
  'housekeeping:run',
  'housekeeping:configure',
  // ── Licensing ────────────────────────────────────────────────────
  'license:view',
  'license:manage',
  // ── Features ─────────────────────────────────────────────────────
  'feat:ai:use',
  'feat:ai:configure',
  'mcp:use',
  // ── Docker: Containers ───────────────────────────────────────────
  'docker:containers:list',
  'docker:containers:view',
  'docker:containers:create',
  'docker:containers:edit',
  'docker:containers:manage',
  'docker:containers:environment',
  'docker:containers:delete',
  'docker:containers:console',
  'docker:containers:files',
  'docker:containers:secrets',
  'docker:containers:webhooks',
  // ── Docker: Images ───────────────────────────────────────────────
  'docker:images:list',
  'docker:images:pull',
  'docker:images:delete',
  // ── Docker: Volumes ──────────────────────────────────────────────
  'docker:volumes:list',
  'docker:volumes:create',
  'docker:volumes:delete',
  // ── Docker: Networks ─────────────────────────────────────────────
  'docker:networks:list',
  'docker:networks:create',
  'docker:networks:edit',
  'docker:networks:delete',
  // ── Docker: Registries ───────────────────────────────────────────
  'docker:registries:list',
  'docker:registries:create',
  'docker:registries:edit',
  'docker:registries:delete',
  // ── Docker: Tasks ────────────────────────────────────────────────
  'docker:tasks',
  // ── Databases ────────────────────────────────────────────────────
  'databases:list',
  'databases:view',
  'databases:create',
  'databases:edit',
  'databases:delete',
  'databases:query:read',
  'databases:query:write',
  'databases:query:admin',
  'databases:credentials:reveal',
  // ── Notifications ────────────────────────────────────────────────
  'notifications:alerts:list',
  'notifications:alerts:view',
  'notifications:alerts:create',
  'notifications:alerts:edit',
  'notifications:alerts:delete',
  'notifications:webhooks:list',
  'notifications:webhooks:view',
  'notifications:webhooks:create',
  'notifications:webhooks:edit',
  'notifications:webhooks:delete',
  'notifications:deliveries:list',
  'notifications:deliveries:view',
  'notifications:view',
  'notifications:manage',
  // ── External Logging ─────────────────────────────────────────────
  'logs:environments:list',
  'logs:environments:view',
  'logs:environments:create',
  'logs:environments:edit',
  'logs:environments:delete',
  'logs:tokens:list',
  'logs:tokens:create',
  'logs:tokens:delete',
  'logs:schemas:list',
  'logs:schemas:view',
  'logs:schemas:create',
  'logs:schemas:edit',
  'logs:schemas:delete',
  'logs:read',
  'logs:manage',
  // ── Status Page ──────────────────────────────────────────────────
  'status-page:view',
  'status-page:manage',
  'status-page:incidents:create',
  'status-page:incidents:update',
  'status-page:incidents:resolve',
  'status-page:incidents:delete',
] as const;

export type Scope = (typeof ALL_SCOPES)[number];

export const USER_ONLY_SCOPES = ['feat:ai:use', 'feat:ai:configure', 'mcp:use'] as const;
export const PROGRAMMATIC_DENIED_BASE_SCOPES = [
  ...USER_ONLY_SCOPES,
  'admin:system',
  'admin:users',
  'admin:groups',
  'settings:gateway:view',
  'settings:gateway:edit',
  'proxy:raw:read',
  'proxy:raw:write',
  'proxy:raw:toggle',
  'proxy:advanced:bypass',
  'nodes:config:view',
  'nodes:config:edit',
] as const;

const PROGRAMMATIC_DENIED_SCOPE_SET = new Set<string>(PROGRAMMATIC_DENIED_BASE_SCOPES);

export const API_TOKEN_SCOPES = ALL_SCOPES.filter((scope) => !PROGRAMMATIC_DENIED_SCOPE_SET.has(scope));

/** System-admin group: every scope including admin:system (protected) */
export const SYSTEM_ADMIN_SCOPES: readonly string[] = [...ALL_SCOPES];

/** Admin group: curated broad access, without system protection or sensitive platform defaults. */
export const ADMIN_SCOPES: readonly string[] = [
  // PKI
  'pki:ca:list:root',
  'pki:ca:list:intermediate',
  'pki:ca:view:root',
  'pki:ca:view:intermediate',
  'pki:ca:create:root',
  'pki:ca:create:intermediate',
  'pki:ca:revoke:root',
  'pki:ca:revoke:intermediate',
  'pki:cert:list',
  'pki:cert:view',
  'pki:cert:issue',
  'pki:cert:revoke',
  'pki:cert:export',
  'pki:templates:list',
  'pki:templates:view',
  'pki:templates:create',
  'pki:templates:edit',
  'pki:templates:delete',
  // Proxy
  'proxy:list',
  'proxy:view',
  'proxy:create',
  'proxy:edit',
  'proxy:delete',
  'proxy:raw:read',
  'proxy:raw:write',
  'proxy:raw:toggle',
  'proxy:advanced',
  'proxy:advanced:bypass',
  // SSL
  'ssl:cert:list',
  'ssl:cert:view',
  'ssl:cert:issue',
  'ssl:cert:delete',
  'ssl:cert:revoke',
  'ssl:cert:export',
  // ACL
  'acl:list',
  'acl:view',
  'acl:create',
  'acl:edit',
  'acl:delete',
  // Nodes
  'nodes:list',
  'nodes:details',
  'nodes:create',
  'nodes:rename',
  'nodes:delete',
  'nodes:config:view',
  'nodes:config:edit',
  'nodes:logs',
  'nodes:console',
  'nodes:lock',
  // Admin
  'admin:users',
  'admin:groups',
  'admin:audit',
  'admin:details:certificates',
  'admin:update',
  'admin:alerts',
  // Gateway settings
  'settings:gateway:view',
  // Licensing
  'license:view',
  'license:manage',
  // Features
  'feat:ai:use',
  'feat:ai:configure',
  'mcp:use',
  // Docker
  'docker:containers:list',
  'docker:containers:view',
  'docker:containers:create',
  'docker:containers:edit',
  'docker:containers:manage',
  'docker:containers:environment',
  'docker:containers:delete',
  'docker:containers:console',
  'docker:containers:files',
  'docker:containers:secrets',
  'docker:containers:webhooks',
  'docker:images:list',
  'docker:images:pull',
  'docker:images:delete',
  'docker:volumes:list',
  'docker:volumes:create',
  'docker:volumes:delete',
  'docker:networks:list',
  'docker:networks:create',
  'docker:networks:edit',
  'docker:networks:delete',
  'docker:registries:list',
  'docker:tasks',
  // Databases
  'databases:list',
  'databases:view',
  'databases:create',
  'databases:edit',
  'databases:delete',
  'databases:query:read',
  'databases:query:write',
  'databases:query:admin',
  'databases:credentials:reveal',
  // Notifications
  'notifications:alerts:list',
  'notifications:alerts:view',
  'notifications:alerts:create',
  'notifications:alerts:edit',
  'notifications:alerts:delete',
  'notifications:webhooks:list',
  'notifications:webhooks:view',
  'notifications:webhooks:create',
  'notifications:webhooks:edit',
  'notifications:webhooks:delete',
  'notifications:deliveries:list',
  'notifications:deliveries:view',
  'notifications:view',
  'notifications:manage',
  // Logging
  'logs:environments:list',
  'logs:environments:view',
  'logs:environments:create',
  'logs:environments:edit',
  'logs:environments:delete',
  'logs:tokens:list',
  'logs:tokens:create',
  'logs:tokens:delete',
  'logs:schemas:list',
  'logs:schemas:view',
  'logs:schemas:create',
  'logs:schemas:edit',
  'logs:schemas:delete',
  'logs:read',
  'logs:manage',
  // Status Page
  'status-page:view',
  'status-page:manage',
  'status-page:incidents:create',
  'status-page:incidents:update',
  'status-page:incidents:resolve',
  'status-page:incidents:delete',
  // Housekeeping
  'housekeeping:view',
  'housekeeping:run',
];

/** Operator group: operational + management scopes */
export const OPERATOR_SCOPES: readonly string[] = [
  // PKI
  'pki:ca:list:root',
  'pki:ca:list:intermediate',
  'pki:ca:view:root',
  'pki:ca:view:intermediate',
  'pki:cert:list',
  'pki:cert:view',
  'pki:cert:issue',
  'pki:cert:revoke',
  'pki:cert:export',
  'pki:templates:list',
  'pki:templates:view',
  'pki:templates:create',
  'pki:templates:edit',
  'pki:templates:delete',
  // Proxy
  'proxy:list',
  'proxy:view',
  'proxy:create',
  'proxy:edit',
  // SSL
  'ssl:cert:list',
  'ssl:cert:view',
  'ssl:cert:issue',
  // ACL
  'acl:list',
  'acl:view',
  'acl:create',
  'acl:edit',
  // Nodes
  'nodes:list',
  'nodes:details',
  'nodes:config:view',
  'nodes:logs',
  'nodes:console',
  'nodes:rename',
  // Features
  'feat:ai:use',
  'mcp:use',
  // Admin (alerts only)
  'admin:alerts',
  // Licensing
  'license:view',
  // Docker
  'docker:containers:list',
  'docker:containers:view',
  'docker:containers:edit',
  'docker:containers:manage',
  'docker:containers:environment',
  'docker:containers:webhooks',
  'docker:tasks',
  // Databases
  'databases:list',
  'databases:view',
  'databases:create',
  'databases:edit',
  'databases:delete',
  'databases:query:read',
  'databases:query:write',
  'databases:query:admin',
  // Notifications
  'notifications:alerts:list',
  'notifications:alerts:view',
  'notifications:alerts:create',
  'notifications:alerts:edit',
  'notifications:alerts:delete',
  'notifications:webhooks:list',
  'notifications:webhooks:view',
  'notifications:webhooks:create',
  'notifications:webhooks:edit',
  'notifications:webhooks:delete',
  'notifications:deliveries:list',
  'notifications:deliveries:view',
  'notifications:view',
  'notifications:manage',
  // Logging
  'logs:environments:list',
  'logs:environments:view',
  'logs:schemas:list',
  'logs:schemas:view',
  'logs:tokens:list',
  'logs:tokens:create',
  'logs:tokens:delete',
  'logs:read',
];

/** Viewer group: read-only scopes */
export const VIEWER_SCOPES: readonly string[] = [
  'pki:ca:list:root',
  'pki:ca:list:intermediate',
  'pki:ca:view:root',
  'pki:ca:view:intermediate',
  'pki:cert:list',
  'pki:cert:view',
  'pki:templates:list',
  'pki:templates:view',
  'proxy:list',
  'proxy:view',
  'ssl:cert:list',
  'ssl:cert:view',
  'acl:list',
  'acl:view',
  'docker:containers:list',
  'docker:containers:view',
  'databases:list',
  'databases:view',
  // Notifications
  'notifications:alerts:list',
  'notifications:alerts:view',
  'notifications:webhooks:list',
  'notifications:webhooks:view',
  'notifications:deliveries:list',
  'notifications:deliveries:view',
  'notifications:view',
  // Logging
  'logs:environments:list',
  'logs:environments:view',
  'logs:schemas:list',
  'logs:schemas:view',
  'logs:read',
];

/** Built-in group definitions (order matters for display — most privileged first) */
export const BUILTIN_GROUPS = [
  {
    name: 'system-admin',
    description: 'System administrator — full access, protected from non-system-admins',
    scopes: SYSTEM_ADMIN_SCOPES,
  },
  { name: 'admin', description: 'Full access to all features except system protection', scopes: ADMIN_SCOPES },
  {
    name: 'operator',
    description: 'Operational access — manage certificates, proxies, and SSL',
    scopes: OPERATOR_SCOPES,
  },
  { name: 'viewer', description: 'Read-only access to all resources', scopes: VIEWER_SCOPES },
] as const;

export const BUILTIN_GROUP_NAMES: string[] = BUILTIN_GROUPS.map((g) => g.name);

/** Scopes that support resource-level suffixes (e.g., pki:cert:issue:ca-uuid) */
export const RESOURCE_SCOPABLE: readonly string[] = [
  // PKI
  'pki:ca:create:intermediate',
  'pki:cert:issue',
  'pki:cert:revoke',
  'pki:cert:export',
  // Proxy
  'proxy:view',
  'proxy:create',
  'proxy:edit',
  'proxy:delete',
  'proxy:advanced',
  'proxy:advanced:bypass',
  'proxy:raw:read',
  'proxy:raw:write',
  'proxy:raw:toggle',
  // SSL
  'ssl:cert:view',
  'ssl:cert:delete',
  'ssl:cert:revoke',
  'ssl:cert:export',
  // ACL
  'acl:view',
  'acl:edit',
  'acl:delete',
  // Nodes
  'nodes:details',
  'nodes:config:view',
  'nodes:config:edit',
  'nodes:logs',
  'nodes:console',
  'nodes:rename',
  'nodes:delete',
  'nodes:lock',
  // Docker containers
  'docker:containers:list',
  'docker:containers:view',
  'docker:containers:create',
  'docker:containers:edit',
  'docker:containers:manage',
  'docker:containers:environment',
  'docker:containers:delete',
  'docker:containers:console',
  'docker:containers:files',
  'docker:containers:secrets',
  'docker:containers:webhooks',
  // Docker images
  'docker:images:list',
  'docker:images:pull',
  'docker:images:delete',
  // Docker volumes
  'docker:volumes:list',
  'docker:volumes:create',
  'docker:volumes:delete',
  // Docker networks
  'docker:networks:list',
  'docker:networks:create',
  'docker:networks:edit',
  'docker:networks:delete',
  // Databases
  'databases:list',
  'databases:view',
  'databases:edit',
  'databases:delete',
  'databases:query:read',
  'databases:query:write',
  'databases:query:admin',
  'databases:credentials:reveal',
  // Logging
  'logs:environments:list',
  'logs:environments:view',
  'logs:environments:edit',
  'logs:environments:delete',
  'logs:tokens:list',
  'logs:tokens:create',
  'logs:tokens:delete',
  'logs:schemas:view',
  'logs:schemas:edit',
  'logs:schemas:delete',
  'logs:read',
];

const ALL_SCOPES_SET = new Set<string>(ALL_SCOPES);
const RESOURCE_SCOPABLE_SET = new Set<string>(RESOURCE_SCOPABLE);
const RESOURCE_SCOPABLE_BY_LENGTH = [...RESOURCE_SCOPABLE].sort((a, b) => b.length - a.length);

export const MANUAL_APPROVAL_SCOPES = [
  'pki:ca:create:root',
  'pki:ca:create:intermediate',
  'pki:ca:revoke:root',
  'pki:ca:revoke:intermediate',
  'pki:cert:export',
  'ssl:cert:issue',
  'ssl:cert:delete',
  'ssl:cert:revoke',
  'ssl:cert:export',
  'nodes:console',
  'docker:containers:console',
  'docker:containers:files',
  'docker:containers:secrets',
  'databases:query:read',
  'databases:query:write',
  'databases:query:admin',
  'databases:credentials:reveal',
  'logs:tokens:create',
  'admin:audit',
  'admin:details:certificates',
  'admin:update',
] as const;
export const MANUAL_APPROVAL_SCOPE_SET = new Set<string>(MANUAL_APPROVAL_SCOPES);

/** Extract the base scope from a potentially resource-scoped string */
export function extractBaseScope(scope: string): string {
  if (ALL_SCOPES_SET.has(scope)) return scope;
  for (const base of RESOURCE_SCOPABLE_BY_LENGTH) {
    if (scope.startsWith(`${base}:`) && scope.length > base.length + 1) {
      return base;
    }
  }
  return scope;
}

/** Check if a scope string has a valid base scope */
export function isValidBaseScope(scope: string): boolean {
  const base = extractBaseScope(scope);
  return ALL_SCOPES_SET.has(base) && (scope === base || RESOURCE_SCOPABLE_SET.has(base));
}

/** Check whether a scope may be delegated to an API token */
export function isApiTokenScope(scope: string): boolean {
  return isValidBaseScope(scope) && !PROGRAMMATIC_DENIED_SCOPE_SET.has(extractBaseScope(scope));
}

/** Check if a scope string is a resource-scoped variant */
export function isResourceScoped(scope: string): boolean {
  const base = extractBaseScope(scope);
  return scope !== base && RESOURCE_SCOPABLE.includes(base);
}

/** Canonicalize valid scopes so broad scopes win over resource-scoped variants. */
export function canonicalizeScopes(scopes: readonly string[]): string[] {
  const exactScopes = new Set<string>();
  const resourceScopedByBase = new Map<string, Set<string>>();

  for (const rawScope of scopes) {
    const scope = rawScope.trim();
    if (!scope || !isValidBaseScope(scope)) continue;
    const base = extractBaseScope(scope);
    if (scope === base) {
      exactScopes.add(scope);
      continue;
    }
    if (!resourceScopedByBase.has(base)) resourceScopedByBase.set(base, new Set());
    resourceScopedByBase.get(base)!.add(scope);
  }

  const canonical = new Set<string>(exactScopes);
  for (const [base, scopedVariants] of resourceScopedByBase.entries()) {
    if (exactScopes.has(base)) continue;
    for (const scope of scopedVariants) canonical.add(scope);
  }

  return [...canonical].sort();
}

export function withoutManualApprovalScopes(scopes: readonly string[]): string[] {
  return scopes.filter((scope) => !MANUAL_APPROVAL_SCOPE_SET.has(extractBaseScope(scope)));
}
