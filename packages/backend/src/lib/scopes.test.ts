import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_SCOPES,
  ALL_SCOPES,
  API_TOKEN_SCOPES,
  isApiTokenScope,
  RESOURCE_SCOPABLE,
  SYSTEM_ADMIN_SCOPES,
} from './scopes.js';

function frontendResourceScopableScopes(): string[] {
  const source = readFileSync(join(process.cwd(), '../frontend/src/types/index.ts'), 'utf8');
  const match = source.match(/export const RESOURCE_SCOPABLE_SCOPES = \[([\s\S]*?)\] as const;/);
  if (!match) throw new Error('RESOURCE_SCOPABLE_SCOPES not found');
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
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
    expect(isApiTokenScope('admin:system')).toBe(false);
  });

  it('keeps backend and frontend resource-scopable lists aligned', () => {
    expect(frontendResourceScopableScopes()).toEqual([...RESOURCE_SCOPABLE]);
  });
});
