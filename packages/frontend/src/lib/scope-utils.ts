import { RESOURCE_SCOPABLE_SCOPES, TOKEN_SCOPES } from "@/types";

const RESOURCE_SCOPABLE_BY_LENGTH = [...RESOURCE_SCOPABLE_SCOPES].sort(
  (a, b) => b.length - a.length
);
const ALL_SCOPE_VALUES = new Set<string>(TOKEN_SCOPES.map((scope) => scope.value));

export function extractBaseScope(scope: string): string {
  if (ALL_SCOPE_VALUES.has(scope)) return scope;
  const base = RESOURCE_SCOPABLE_BY_LENGTH.find(
    (candidate) => scope.startsWith(`${candidate}:`) && scope.length > candidate.length + 1
  );
  return base ?? scope;
}

export function scopeMatches(availableScopes: readonly string[], requiredScope: string): boolean {
  if (availableScopes.includes(requiredScope)) return true;
  const base = extractBaseScope(requiredScope);
  return base !== requiredScope && availableScopes.includes(base);
}

export function hasSelectableScopeBase(
  availableScopes: readonly string[],
  baseScope: string
): boolean {
  if (availableScopes.includes(baseScope)) return true;
  return availableScopes.some(
    (availableScope) =>
      extractBaseScope(availableScope) === baseScope && availableScope !== baseScope
  );
}

export function deriveAllowedResourceIdsByScope(userScopes: readonly string[]) {
  const result: Record<string, string[]> = {};
  for (const scope of RESOURCE_SCOPABLE_SCOPES) {
    if (userScopes.includes(scope)) continue;
    const ids = userScopes
      .filter((candidate) => extractBaseScope(candidate) === scope && candidate !== scope)
      .map((candidate) => candidate.slice(scope.length + 1));
    if (ids.length > 0) result[scope] = [...new Set(ids)];
  }
  return result;
}

export function parseScopesForForm(scopes: readonly string[]) {
  const baseScopes: string[] = [];
  const resources: Record<string, string[]> = {};
  const restrictableScopeSet = new Set<string>(RESOURCE_SCOPABLE_SCOPES);

  for (const scope of scopes) {
    if (restrictableScopeSet.has(scope)) {
      if (!baseScopes.includes(scope)) baseScopes.push(scope);
      continue;
    }

    const base = RESOURCE_SCOPABLE_BY_LENGTH.find(
      (candidate) => scope.startsWith(`${candidate}:`) && scope.length > candidate.length + 1
    );
    if (!base) {
      if (!baseScopes.includes(scope)) baseScopes.push(scope);
      continue;
    }

    if (!baseScopes.includes(base)) baseScopes.push(base);
    resources[base] = [...new Set([...(resources[base] ?? []), scope.slice(base.length + 1)])];
  }

  return { baseScopes, resources };
}

export function buildFinalScopes(
  baseScopes: readonly string[],
  resources: Record<string, string[]>
) {
  const exact = new Set<string>();
  const scoped = new Map<string, Set<string>>();

  for (const scope of baseScopes) {
    const selectedResources = resources[scope] ?? [];
    if (selectedResources.length === 0) {
      exact.add(scope);
      continue;
    }
    if (!scoped.has(scope)) scoped.set(scope, new Set());
    for (const resourceId of selectedResources) scoped.get(scope)!.add(`${scope}:${resourceId}`);
  }

  const finalScopes = new Set<string>(exact);
  for (const [base, values] of scoped.entries()) {
    if (exact.has(base)) continue;
    for (const value of values) finalScopes.add(value);
  }

  return [...finalScopes].sort();
}

export function requiresResourceSelection(
  scope: string,
  allowedResourceIdsByScope: Record<string, string[]>,
  initialResourceLimitedScopes: readonly string[]
) {
  return (
    (allowedResourceIdsByScope[scope]?.length ?? 0) > 0 ||
    initialResourceLimitedScopes.includes(scope)
  );
}
