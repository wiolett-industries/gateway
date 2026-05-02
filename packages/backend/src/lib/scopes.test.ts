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
  OPERATOR_SCOPES,
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

function listScopeRemovalMigration(): string {
  return readFileSync(join(process.cwd(), 'src/db/migrations/0030_remove_list_scopes.sql'), 'utf8');
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

  it('keeps built-in admin broad while excluding protected operational scopes', () => {
    expect(ADMIN_SCOPES).toContain('settings:gateway:view');
    expect(ADMIN_SCOPES).not.toContain('settings:gateway:edit');
    expect(ADMIN_SCOPES).toContain('housekeeping:run');
    expect(ADMIN_SCOPES).not.toContain('housekeeping:configure');
    expect(ADMIN_SCOPES).toContain('docker:registries:view');
    expect(ADMIN_SCOPES).not.toContain('docker:registries:create');
    expect(ADMIN_SCOPES).not.toContain('docker:registries:edit');
    expect(ADMIN_SCOPES).not.toContain('docker:registries:delete');
    expect(ADMIN_SCOPES).toContain('docker:containers:mounts');
    expect(ADMIN_SCOPES).toContain('proxy:raw:bypass');
    expect(OPERATOR_SCOPES).not.toContain('proxy:raw:bypass');
    expect(ADMIN_SCOPES).not.toContain('admin:system');
  });

  it('grants Docker mount editing only to built-in admin tiers by default', () => {
    expect(SYSTEM_ADMIN_SCOPES).toContain('docker:containers:mounts');
    expect(ADMIN_SCOPES).toContain('docker:containers:mounts');
    expect(OPERATOR_SCOPES).not.toContain('docker:containers:mounts');
    expect(ALL_SCOPES).toContain('docker:containers:mounts');
  });

  it('removes deprecated housekeeping scope and rejects admin:system for API tokens', () => {
    expect(ALL_SCOPES).not.toContain('admin:housekeeping');
    expect(API_TOKEN_SCOPES).not.toContain('admin:system');
    expect(API_TOKEN_SCOPES).not.toContain('mcp:use');
    expect(API_TOKEN_SCOPES).not.toContain('admin:users');
    expect(API_TOKEN_SCOPES).not.toContain('settings:gateway:edit');
    expect(API_TOKEN_SCOPES).not.toContain('proxy:raw:write');
    expect(API_TOKEN_SCOPES).not.toContain('proxy:raw:bypass');
    expect(API_TOKEN_SCOPES).not.toContain('proxy:advanced:bypass');
    expect(isApiTokenScope('admin:system')).toBe(false);
    expect(isApiTokenScope('mcp:use')).toBe(false);
    expect(isApiTokenScope('admin:users')).toBe(false);
    expect(isApiTokenScope('proxy:raw:write:host-1')).toBe(false);
    expect(isApiTokenScope('proxy:raw:bypass:host-1')).toBe(false);
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

  it('removes obsolete list scopes from stored scope-bearing tables', () => {
    const migration = listScopeRemovalMigration();

    for (const scope of [
      'pki:ca:list:root',
      'pki:ca:list:intermediate',
      'pki:cert:list',
      'pki:templates:list',
      'proxy:list',
      'ssl:cert:list',
      'acl:list',
      'nodes:list',
      'docker:containers:list',
      'docker:images:list',
      'docker:volumes:list',
      'docker:networks:list',
      'docker:registries:list',
      'databases:list',
      'notifications:alerts:list',
      'notifications:webhooks:list',
      'notifications:deliveries:list',
      'logs:environments:list',
      'logs:tokens:list',
      'logs:schemas:list',
    ]) {
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
    expect(migration).toContain('"requested_scopes"');
    expect(migration).toContain("scope_value LIKE obsolete.scope || ':%'");
    expect(migration).not.toContain('proxy:view');
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
