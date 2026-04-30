import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_SCOPES,
  ALL_SCOPES,
  API_TOKEN_SCOPES,
  canonicalizeScopes,
  extractBaseScope,
  isApiTokenScope,
  isValidBaseScope,
  MANUAL_APPROVAL_SCOPES,
  PROGRAMMATIC_DENIED_BASE_SCOPES,
  RESOURCE_SCOPABLE,
  SYSTEM_ADMIN_SCOPES,
} from './scopes.js';

function frontendResourceScopableScopes(): string[] {
  const source = readFileSync(join(process.cwd(), '../frontend/src/types/index.ts'), 'utf8');
  const match = source.match(/export const RESOURCE_SCOPABLE_SCOPES = \[([\s\S]*?)\] as const;/);
  if (!match) throw new Error('RESOURCE_SCOPABLE_SCOPES not found');
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function programmaticSurfaceMigration(): string {
  return readFileSync(join(process.cwd(), 'src/db/migrations/0028_programmatic_api_surface.sql'), 'utf8');
}

function migratedProgrammaticStoredScopes(scopes: string[]): string[] {
  return canonicalizeScopes(
    scopes.filter(
      (scope) => !PROGRAMMATIC_DENIED_BASE_SCOPES.some((denied) => scope === denied || scope.startsWith(`${denied}:`))
    )
  );
}

describe('canonical scope definitions', () => {
  it('keeps system-admin on every canonical scope', () => {
    expect(SYSTEM_ADMIN_SCOPES).toEqual([...ALL_SCOPES]);
  });

  it('keeps built-in admin curated instead of auto-inheriting sensitive scopes', () => {
    expect(ADMIN_SCOPES).toContain('settings:gateway:view');
    expect(ADMIN_SCOPES).toContain('housekeeping:run');
    expect(ADMIN_SCOPES).toContain('docker:registries:list');
    expect(ADMIN_SCOPES).not.toContain('admin:system');
    expect(ADMIN_SCOPES).not.toContain('settings:gateway:edit');
    expect(ADMIN_SCOPES).not.toContain('housekeeping:configure');
    expect(ADMIN_SCOPES).not.toContain('docker:registries:create');
    expect(ADMIN_SCOPES).not.toContain('docker:registries:edit');
    expect(ADMIN_SCOPES).not.toContain('docker:registries:delete');
  });

  it('removes deprecated housekeeping scope and rejects admin:system for API tokens', () => {
    expect(ALL_SCOPES).not.toContain('admin:housekeeping');
    expect(API_TOKEN_SCOPES).not.toContain('admin:system');
    expect(API_TOKEN_SCOPES).not.toContain('mcp:use');
    expect(API_TOKEN_SCOPES).not.toContain('admin:users');
    expect(API_TOKEN_SCOPES).not.toContain('settings:gateway:edit');
    expect(API_TOKEN_SCOPES).not.toContain('proxy:raw:write');
    expect(API_TOKEN_SCOPES).not.toContain('proxy:advanced:bypass');
    expect(isApiTokenScope('admin:system')).toBe(false);
    expect(isApiTokenScope('mcp:use')).toBe(false);
    expect(isApiTokenScope('admin:users')).toBe(false);
    expect(isApiTokenScope('proxy:raw:write:host-1')).toBe(false);
  });

  it('keeps OAuth manual approval scopes focused on high-risk delegated access', () => {
    expect(MANUAL_APPROVAL_SCOPES).toEqual([
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
    ]);
    expect(MANUAL_APPROVAL_SCOPES).not.toContain('docker:containers:environment');
  });

  it('keeps backend and frontend resource-scopable lists aligned', () => {
    expect(frontendResourceScopableScopes()).toEqual([...RESOURCE_SCOPABLE]);
  });

  it('uses longest-match parsing for resource-scoped scopes', () => {
    expect(extractBaseScope('proxy:advanced:bypass:host-1')).toBe('proxy:advanced:bypass');
    expect(extractBaseScope('proxy:advanced:host-1')).toBe('proxy:advanced');
    expect(isValidBaseScope('admin:users:team-1')).toBe(false);
  });

  it('canonicalizes scopes with broad scopes winning over resource variants', () => {
    expect(canonicalizeScopes(['proxy:view:host-1', 'proxy:view', 'proxy:view:host-2'])).toEqual(['proxy:view']);
    expect(canonicalizeScopes(['proxy:view:host-2', 'proxy:view:host-1'])).toEqual([
      'proxy:view:host-1',
      'proxy:view:host-2',
    ]);
  });

  it('keeps the destructive stored-scope cleanup migration aligned with runtime scope rules', () => {
    const migration = programmaticSurfaceMigration();

    for (const scope of PROGRAMMATIC_DENIED_BASE_SCOPES) {
      expect(migration).toContain(`('${scope}')`);
    }
    for (const scope of RESOURCE_SCOPABLE) {
      expect(migration).toContain(`('${scope}')`);
    }
    for (const scope of ALL_SCOPES) {
      expect(migration).toContain(`('${scope}')`);
    }
    for (const table of [
      'permission_groups',
      'api_tokens',
      'oauth_authorization_codes',
      'oauth_refresh_tokens',
      'oauth_access_tokens',
    ]) {
      expect(migration).toContain(`UPDATE "${table}"`);
    }
    expect(migration).toContain('gateway_canonicalize_scopes');
    expect(migration).toContain("scope LIKE denied.scope || ':%'");
    expect(migration).toContain('parsed.base_scope IS NOT NULL');
    expect(migration).not.toContain('split_part(scope');
  });

  it('models the stored-scope migration behavior for denied suffixes and overlapping resource scopes', () => {
    expect(
      migratedProgrammaticStoredScopes([
        'mcp:use:any',
        'admin:system:legacy',
        'proxy:raw:write:host-1',
        'proxy:advanced:bypass:host-1',
        'proxy:advanced:host-1',
        'proxy:advanced:bypasser',
        'proxy:view',
        'proxy:view:host-1',
        'unknown:scope',
      ])
    ).toEqual(['proxy:advanced:bypasser', 'proxy:advanced:host-1', 'proxy:view']);
  });
});
