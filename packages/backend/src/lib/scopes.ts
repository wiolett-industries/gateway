/**
 * Unified scope definitions for the group-based permissions system.
 * Both session users (via group membership) and API tokens use these scopes.
 *
 * Naming convention: domain:resource:action[:qualifier]
 * Resource-scopable scopes support suffixes: e.g. docker:containers:view:node-uuid
 */

export const ALL_SCOPES = [
  // ── PKI: Certificate Authorities ─────────────────────────────────
  'pki:ca:view:root',
  'pki:ca:view:intermediate',
  'pki:ca:create:root',
  'pki:ca:create:intermediate',
  'pki:ca:revoke:root',
  'pki:ca:revoke:intermediate',
  // ── PKI: Certificates ────────────────────────────────────────────
  'pki:cert:view',
  'pki:cert:issue',
  'pki:cert:revoke',
  'pki:cert:export',
  // ── PKI: Certificate Templates ───────────────────────────────────
  'pki:templates:view',
  'pki:templates:create',
  'pki:templates:edit',
  'pki:templates:delete',
  // ── Domains ──────────────────────────────────────────────────────
  'domains:view',
  'domains:create',
  'domains:edit',
  'domains:delete',
  // ── Proxy Hosts ──────────────────────────────────────────────────
  'proxy:view',
  'proxy:create',
  'proxy:edit',
  'proxy:delete',
  'proxy:raw:read',
  'proxy:raw:write',
  'proxy:raw:toggle',
  'proxy:raw:bypass',
  'proxy:advanced',
  'proxy:advanced:bypass',
  'proxy:folders:manage',
  // ── Proxy Templates ──────────────────────────────────────────────
  'proxy:templates:view',
  'proxy:templates:create',
  'proxy:templates:edit',
  'proxy:templates:delete',
  // ── SSL Certificates ─────────────────────────────────────────────
  'ssl:cert:view',
  'ssl:cert:issue',
  'ssl:cert:delete',
  'ssl:cert:revoke',
  'ssl:cert:export',
  // ── Access Control Lists ─────────────────────────────────────────
  'acl:view',
  'acl:create',
  'acl:edit',
  'acl:delete',
  // ── Nodes ────────────────────────────────────────────────────────
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
  'docker:containers:mounts',
  'docker:containers:folders:manage',
  // ── Docker: Images ───────────────────────────────────────────────
  'docker:images:view',
  'docker:images:pull',
  'docker:images:delete',
  // ── Docker: Volumes ──────────────────────────────────────────────
  'docker:volumes:view',
  'docker:volumes:create',
  'docker:volumes:delete',
  // ── Docker: Networks ─────────────────────────────────────────────
  'docker:networks:view',
  'docker:networks:create',
  'docker:networks:edit',
  'docker:networks:delete',
  // ── Docker: Registries ───────────────────────────────────────────
  'docker:registries:view',
  'docker:registries:create',
  'docker:registries:edit',
  'docker:registries:delete',
  // ── Docker: Tasks ────────────────────────────────────────────────
  'docker:tasks',
  // ── Databases ────────────────────────────────────────────────────
  'databases:view',
  'databases:create',
  'databases:edit',
  'databases:delete',
  'databases:query:read',
  'databases:query:write',
  'databases:query:admin',
  'databases:credentials:reveal',
  // ── Notifications ────────────────────────────────────────────────
  'notifications:alerts:view',
  'notifications:alerts:create',
  'notifications:alerts:edit',
  'notifications:alerts:delete',
  'notifications:webhooks:view',
  'notifications:webhooks:create',
  'notifications:webhooks:edit',
  'notifications:webhooks:delete',
  'notifications:deliveries:view',
  'notifications:view',
  'notifications:manage',
  // ── External Logging ─────────────────────────────────────────────
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
  'proxy:raw:bypass',
  'proxy:advanced:bypass',
  'nodes:config:view',
  'nodes:config:edit',
] as const;

const PROGRAMMATIC_DENIED_SCOPE_SET = new Set<string>(PROGRAMMATIC_DENIED_BASE_SCOPES);

export const API_TOKEN_SCOPES = ALL_SCOPES.filter((scope) => !PROGRAMMATIC_DENIED_SCOPE_SET.has(scope));

/** System-admin group: every scope including admin:system (protected) */
export const SYSTEM_ADMIN_SCOPES: readonly string[] = [...ALL_SCOPES];

/** Admin group: curated broad access except system protection and high-risk operational defaults. */
export const ADMIN_SCOPES: readonly string[] = [
  'pki:ca:view:root',
  'pki:ca:view:intermediate',
  'pki:ca:create:root',
  'pki:ca:create:intermediate',
  'pki:ca:revoke:root',
  'pki:ca:revoke:intermediate',
  'pki:cert:view',
  'pki:cert:issue',
  'pki:cert:revoke',
  'pki:cert:export',
  'pki:templates:view',
  'pki:templates:create',
  'pki:templates:edit',
  'pki:templates:delete',
  'domains:view',
  'domains:create',
  'domains:edit',
  'domains:delete',
  'proxy:view',
  'proxy:create',
  'proxy:edit',
  'proxy:delete',
  'proxy:raw:read',
  'proxy:raw:write',
  'proxy:raw:toggle',
  'proxy:raw:bypass',
  'proxy:advanced',
  'proxy:advanced:bypass',
  'proxy:folders:manage',
  'proxy:templates:view',
  'proxy:templates:create',
  'proxy:templates:edit',
  'proxy:templates:delete',
  'ssl:cert:view',
  'ssl:cert:issue',
  'ssl:cert:delete',
  'ssl:cert:revoke',
  'ssl:cert:export',
  'acl:view',
  'acl:create',
  'acl:edit',
  'acl:delete',
  'nodes:details',
  'nodes:create',
  'nodes:rename',
  'nodes:delete',
  'nodes:config:view',
  'nodes:config:edit',
  'nodes:logs',
  'nodes:console',
  'nodes:lock',
  'admin:users',
  'admin:groups',
  'admin:audit',
  'admin:details:certificates',
  'admin:update',
  'admin:alerts',
  'settings:gateway:view',
  'housekeeping:view',
  'housekeeping:run',
  'license:view',
  'license:manage',
  'feat:ai:use',
  'feat:ai:configure',
  'mcp:use',
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
  'docker:containers:mounts',
  'docker:containers:folders:manage',
  'docker:images:view',
  'docker:images:pull',
  'docker:images:delete',
  'docker:volumes:view',
  'docker:volumes:create',
  'docker:volumes:delete',
  'docker:networks:view',
  'docker:networks:create',
  'docker:networks:edit',
  'docker:networks:delete',
  'docker:registries:view',
  'docker:tasks',
  'databases:view',
  'databases:create',
  'databases:edit',
  'databases:delete',
  'databases:query:read',
  'databases:query:write',
  'databases:query:admin',
  'databases:credentials:reveal',
  'notifications:alerts:view',
  'notifications:alerts:create',
  'notifications:alerts:edit',
  'notifications:alerts:delete',
  'notifications:webhooks:view',
  'notifications:webhooks:create',
  'notifications:webhooks:edit',
  'notifications:webhooks:delete',
  'notifications:deliveries:view',
  'notifications:view',
  'notifications:manage',
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
  'status-page:view',
  'status-page:manage',
  'status-page:incidents:create',
  'status-page:incidents:update',
  'status-page:incidents:resolve',
  'status-page:incidents:delete',
];

/** Operator group: operational + management scopes */
export const OPERATOR_SCOPES: readonly string[] = [
  'pki:ca:view:root',
  'pki:ca:view:intermediate',
  'pki:cert:view',
  'pki:cert:issue',
  'pki:cert:revoke',
  'pki:cert:export',
  'pki:templates:view',
  'pki:templates:create',
  'pki:templates:edit',
  'pki:templates:delete',
  'domains:view',
  'domains:create',
  'domains:edit',
  'proxy:view',
  'proxy:create',
  'proxy:edit',
  'proxy:folders:manage',
  'proxy:templates:view',
  'proxy:templates:create',
  'proxy:templates:edit',
  'ssl:cert:view',
  'ssl:cert:issue',
  'acl:view',
  'acl:create',
  'acl:edit',
  'nodes:details',
  'nodes:config:view',
  'nodes:logs',
  'nodes:console',
  'nodes:rename',
  'feat:ai:use',
  'mcp:use',
  'admin:alerts',
  'license:view',
  'docker:containers:view',
  'docker:containers:edit',
  'docker:containers:manage',
  'docker:containers:environment',
  'docker:containers:webhooks',
  'docker:containers:folders:manage',
  'docker:images:view',
  'docker:volumes:view',
  'docker:networks:view',
  'docker:registries:view',
  'docker:tasks',
  'databases:view',
  'databases:create',
  'databases:edit',
  'databases:delete',
  'databases:query:read',
  'databases:query:write',
  'databases:query:admin',
  'notifications:alerts:view',
  'notifications:alerts:create',
  'notifications:alerts:edit',
  'notifications:alerts:delete',
  'notifications:webhooks:view',
  'notifications:webhooks:create',
  'notifications:webhooks:edit',
  'notifications:webhooks:delete',
  'notifications:deliveries:view',
  'notifications:view',
  'notifications:manage',
  'logs:environments:view',
  'logs:schemas:view',
  'logs:tokens:view',
  'logs:tokens:create',
  'logs:tokens:delete',
  'logs:read',
];

/** Viewer group: read-only scopes */
export const VIEWER_SCOPES: readonly string[] = [
  'pki:ca:view:root',
  'pki:ca:view:intermediate',
  'pki:cert:view',
  'pki:templates:view',
  'domains:view',
  'proxy:view',
  'proxy:templates:view',
  'ssl:cert:view',
  'acl:view',
  'docker:containers:view',
  'docker:images:view',
  'docker:volumes:view',
  'docker:networks:view',
  'docker:registries:view',
  'databases:view',
  'notifications:alerts:view',
  'notifications:webhooks:view',
  'notifications:deliveries:view',
  'notifications:view',
  'logs:environments:view',
  'logs:schemas:view',
  'logs:tokens:view',
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
  'pki:cert:view',
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
  'proxy:raw:bypass',
  'proxy:templates:view',
  'proxy:templates:edit',
  'proxy:templates:delete',
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
  'docker:containers:mounts',
  // Docker images
  'docker:images:view',
  'docker:images:pull',
  'docker:images:delete',
  // Docker volumes
  'docker:volumes:view',
  'docker:volumes:create',
  'docker:volumes:delete',
  // Docker networks
  'docker:networks:view',
  'docker:networks:create',
  'docker:networks:edit',
  'docker:networks:delete',
  // Databases
  'databases:view',
  'databases:edit',
  'databases:delete',
  'databases:query:read',
  'databases:query:write',
  'databases:query:admin',
  'databases:credentials:reveal',
  // Logging
  'logs:environments:view',
  'logs:environments:edit',
  'logs:environments:delete',
  'logs:tokens:view',
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
  'proxy:raw:bypass',
  'nodes:console',
  'docker:containers:console',
  'docker:containers:files',
  'docker:containers:secrets',
  'docker:containers:mounts',
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
