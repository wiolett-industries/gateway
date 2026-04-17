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
  // ── Administration ───────────────────────────────────────────────
  'admin:users',
  'admin:groups',
  'admin:audit',
  'admin:system',
  'admin:details:certificates',
  'admin:update',
  'admin:housekeeping',
  'admin:alerts',
  // ── Features ─────────────────────────────────────────────────────
  'feat:ai:use',
  'feat:ai:configure',
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
  // ── Docker: Templates ────────────────────────────────────────────
  'docker:templates:list',
  'docker:templates:view',
  'docker:templates:create',
  'docker:templates:edit',
  'docker:templates:delete',
  // ── Docker: Tasks ────────────────────────────────────────────────
  'docker:tasks',
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
] as const;

export type Scope = (typeof ALL_SCOPES)[number];

/** System-admin group: every scope including admin:system (protected) */
export const SYSTEM_ADMIN_SCOPES: readonly string[] = [...ALL_SCOPES];

/** Admin group: all scopes EXCEPT admin:system (cannot shield themselves from system-admins) */
export const ADMIN_SCOPES: readonly string[] = ALL_SCOPES.filter((s) => s !== 'admin:system');

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
  // Admin (alerts only)
  'admin:alerts',
  // Docker
  'docker:containers:list',
  'docker:containers:view',
  'docker:containers:edit',
  'docker:containers:manage',
  'docker:containers:environment',
  'docker:containers:webhooks',
  'docker:tasks',
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
  // Notifications
  'notifications:alerts:list',
  'notifications:alerts:view',
  'notifications:webhooks:list',
  'notifications:webhooks:view',
  'notifications:deliveries:list',
  'notifications:deliveries:view',
  'notifications:view',
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
  'nodes:rename',
  'nodes:delete',
  // Docker containers
  'docker:containers:view',
  'docker:containers:edit',
  'docker:containers:manage',
  'docker:containers:environment',
  'docker:containers:delete',
  'docker:containers:console',
  'docker:containers:files',
  'docker:containers:secrets',
];

const ALL_SCOPES_SET = new Set<string>(ALL_SCOPES);

/** Extract the base scope from a potentially resource-scoped string */
export function extractBaseScope(scope: string): string {
  // Try progressively shorter prefixes to find a match in ALL_SCOPES
  const parts = scope.split(':');
  for (let i = parts.length; i >= 1; i--) {
    const prefix = parts.slice(0, i).join(':');
    if (ALL_SCOPES_SET.has(prefix)) return prefix;
  }
  return scope;
}

/** Check if a scope string has a valid base scope */
export function isValidBaseScope(scope: string): boolean {
  return ALL_SCOPES_SET.has(extractBaseScope(scope));
}

/** Check if a scope string is a resource-scoped variant */
export function isResourceScoped(scope: string): boolean {
  const base = extractBaseScope(scope);
  return scope !== base && RESOURCE_SCOPABLE.includes(base);
}
