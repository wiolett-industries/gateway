/**
 * Unified scope definitions for the group-based permissions system.
 * Both session users (via group membership) and API tokens use these scopes.
 */

export const ALL_SCOPES = [
  // Certificate Authorities
  'ca:read',
  'ca:create:root',
  'ca:create:intermediate',
  'ca:revoke',
  // Certificates
  'cert:read',
  'cert:issue',
  'cert:revoke',
  'cert:export',
  // Templates
  'template:read',
  'template:manage',
  // Proxy Hosts
  'proxy:list',
  'proxy:view',
  'proxy:create',
  'proxy:edit',
  'proxy:delete',
  'proxy:raw-read',
  'proxy:raw-write',
  'proxy:raw-toggle',
  // SSL Certificates
  'ssl:read',
  'ssl:manage',
  'ssl:delete',
  // Access Lists
  'access-list:read',
  'access-list:manage',
  'access-list:delete',
  // Nodes
  'nodes:list',
  'nodes:details',
  'nodes:config',
  'nodes:logs',
  'nodes:rename',
  'nodes:config-edit',
  'nodes:create',
  'nodes:delete',
  // Administration
  'admin:users',
  'admin:groups',
  'admin:audit',
  'admin:system',
  'admin:update',
  'admin:housekeeping',
  'admin:alerts',
  'admin:ai-config',
  // Features
  'ai:use',
  'proxy:advanced',
] as const;

export type Scope = (typeof ALL_SCOPES)[number];

/** System-admin group: every scope including admin:system (protected) */
export const SYSTEM_ADMIN_SCOPES: readonly string[] = [...ALL_SCOPES];

/** Admin group: all scopes EXCEPT admin:system (cannot shield themselves from system-admins) */
export const ADMIN_SCOPES: readonly string[] = ALL_SCOPES.filter((s) => s !== 'admin:system');

/** Operator group: operational + management scopes */
export const OPERATOR_SCOPES: readonly string[] = [
  'ca:read',
  'cert:read',
  'cert:issue',
  'cert:revoke',
  'cert:export',
  'template:read',
  'template:manage',
  'proxy:list',
  'proxy:view',
  'proxy:create',
  'proxy:edit',
  'ssl:read',
  'ssl:manage',
  'access-list:read',
  'access-list:manage',
  'nodes:list',
  'nodes:details',
  'nodes:config',
  'nodes:logs',
  'nodes:rename',
  'ai:use',
  'admin:alerts',
];

/** Viewer group: read-only scopes */
export const VIEWER_SCOPES: readonly string[] = [
  'ca:read',
  'cert:read',
  'template:read',
  'proxy:list',
  'proxy:view',
  'ssl:read',
  'access-list:read',
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

/** Scopes that support resource-level suffixes (e.g., cert:issue:ca-uuid) */
export const RESOURCE_SCOPABLE: readonly string[] = [
  'cert:issue',
  'ca:create:intermediate',
  'proxy:view',
  'proxy:create',
  'proxy:edit',
  'proxy:delete',
  'proxy:advanced',
  'proxy:raw-read',
  'proxy:raw-write',
  'proxy:raw-toggle',
  'ssl:manage',
  'ssl:delete',
  'access-list:manage',
  'access-list:delete',
  'nodes:details',
  'nodes:config',
  'nodes:logs',
  'nodes:rename',
  'nodes:config-edit',
  'nodes:delete',
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
