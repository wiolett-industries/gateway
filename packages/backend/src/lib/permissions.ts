/**
 * Scope-based permission helpers.
 * Replaces the old role-based helpers (hasRole, canManageCAs, etc.)
 */

/**
 * Check if a set of scopes grants a required permission.
 * Supports hierarchical matching: 'cert:issue' grants 'cert:issue:ca-123'
 */
export function hasScope(scopes: string[], requiredScope: string): boolean {
  if (scopes.includes(requiredScope)) return true;
  const parts = requiredScope.split(':');
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join(':');
    if (scopes.includes(prefix)) return true;
  }
  return false;
}

/** Check if scopes grant any of the required scopes */
export function hasAnyScope(scopes: string[], requiredScopes: string[]): boolean {
  return requiredScopes.some((s) => hasScope(scopes, s));
}

/** Check if scopes grant all of the required scopes */
export function hasAllScopes(scopes: string[], requiredScopes: string[]): boolean {
  return requiredScopes.every((s) => hasScope(scopes, s));
}

/** Check if a user can use the AI assistant */
export function canUseAI(scopes: string[]): boolean {
  return hasScope(scopes, 'feat:ai:use');
}

/** Check if all requested scopes are a subset of the allowed scopes */
export function isScopeSubset(requestedScopes: string[], allowedScopes: string[]): boolean {
  return requestedScopes.every((s) => hasScope(allowedScopes, s));
}

/**
 * Bound delegated scopes by the principal's current scopes.
 *
 * This is not a simple array intersection because scopes are hierarchical:
 * a broad token scope plus a resource-scoped user scope should still allow
 * that specific resource, and vice versa.
 */
export function boundScopes(delegatedScopes: string[], principalScopes: string[]): string[] {
  const bounded = new Set<string>();

  for (const scope of delegatedScopes) {
    if (hasScope(principalScopes, scope)) bounded.add(scope);
  }

  for (const scope of principalScopes) {
    if (hasScope(delegatedScopes, scope)) bounded.add(scope);
  }

  return [...bounded];
}

/**
 * Check if actor can manage target based on scope containment.
 * Returns null if allowed, or an error message string if denied.
 *
 * Rules:
 * 1. Target has admin:system → actor must also have admin:system
 * 2. Target's scopes must be a subset of actor's scopes
 *    (you can't touch someone who has permissions you lack)
 */
export function canManageUser(actorScopes: string[], targetScopes: string[]): string | null {
  // Rule 1: admin:system is a hard shield
  if (targetScopes.includes('admin:system') && !actorScopes.includes('admin:system')) {
    return 'Cannot manage a system administrator';
  }

  // Rule 2: target's scopes must be contained by actor's scopes
  if (!isScopeSubset(targetScopes, actorScopes)) {
    return 'Cannot manage a user with permissions you do not possess';
  }

  return null;
}
