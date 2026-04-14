import { describe, expect, it } from 'vitest';
import { canManageUser, canUseAI, hasAllScopes, hasAnyScope, hasScope, isScopeSubset } from './permissions.js';

describe('Scope-based permissions', () => {
  describe('hasScope', () => {
    it('exact match', () => {
      expect(hasScope(['cert:read', 'cert:issue'], 'cert:issue')).toBe(true);
    });

    it('no match', () => {
      expect(hasScope(['cert:read'], 'cert:issue')).toBe(false);
    });

    it('hierarchical: parent grants child', () => {
      expect(hasScope(['cert:issue'], 'cert:issue:ca-123')).toBe(true);
    });

    it('hierarchical: child does not grant parent', () => {
      expect(hasScope(['cert:issue:ca-123'], 'cert:issue')).toBe(false);
    });

    it('hierarchical: exact resource match', () => {
      expect(hasScope(['cert:issue:ca-123'], 'cert:issue:ca-123')).toBe(true);
    });

    it('hierarchical: different resource no match', () => {
      expect(hasScope(['cert:issue:ca-123'], 'cert:issue:ca-456')).toBe(false);
    });

    it('empty scopes', () => {
      expect(hasScope([], 'cert:read')).toBe(false);
    });
  });

  describe('hasAnyScope', () => {
    it('matches one of many', () => {
      expect(hasAnyScope(['cert:read'], ['admin:users', 'cert:read'])).toBe(true);
    });

    it('matches none', () => {
      expect(hasAnyScope(['cert:read'], ['admin:users', 'admin:audit'])).toBe(false);
    });
  });

  describe('hasAllScopes', () => {
    it('has all', () => {
      expect(hasAllScopes(['cert:read', 'cert:issue'], ['cert:read', 'cert:issue'])).toBe(true);
    });

    it('missing one', () => {
      expect(hasAllScopes(['cert:read'], ['cert:read', 'cert:issue'])).toBe(false);
    });
  });

  describe('canUseAI', () => {
    it('user with feat:ai:use can use AI', () => {
      expect(canUseAI(['feat:ai:use', 'cert:read'])).toBe(true);
    });

    it('user without feat:ai:use cannot use AI', () => {
      expect(canUseAI(['cert:read', 'cert:issue'])).toBe(false);
    });
  });

  describe('isScopeSubset', () => {
    it('subset passes', () => {
      expect(isScopeSubset(['cert:read', 'cert:issue'], ['cert:read', 'cert:issue', 'ca:read'])).toBe(true);
    });

    it('resource-scoped is subset of parent', () => {
      expect(isScopeSubset(['cert:issue:ca-123'], ['cert:issue'])).toBe(true);
    });

    it('non-subset fails', () => {
      expect(isScopeSubset(['admin:users'], ['cert:read', 'cert:issue'])).toBe(false);
    });
  });

  describe('canManageUser', () => {
    it('admin can manage operator', () => {
      const admin = ['admin:users', 'admin:system', 'cert:read', 'cert:issue'];
      const operator = ['cert:read', 'cert:issue'];
      expect(canManageUser(admin, operator)).toBe(null);
    });

    it('operator cannot manage admin (admin has scopes operator lacks)', () => {
      const operator = ['admin:users', 'cert:read', 'cert:issue'];
      const admin = ['admin:users', 'admin:system', 'cert:read', 'cert:issue'];
      expect(canManageUser(operator, admin)).toMatch(/system administrator/);
    });

    it('admin:system is a hard shield', () => {
      // Even if actor has MORE scopes overall, lacking admin:system blocks management
      const actor = ['admin:users', 'cert:read', 'cert:issue', 'proxy:manage', 'ssl:manage'];
      const target = ['admin:system', 'cert:read'];
      expect(canManageUser(actor, target)).toMatch(/system administrator/);
    });

    it('admin:system holder can manage another admin:system holder', () => {
      const actor = ['admin:users', 'admin:system', 'cert:read'];
      const target = ['admin:system', 'cert:read'];
      expect(canManageUser(actor, target)).toBe(null);
    });

    it('cannot manage user with scope you lack', () => {
      const actor = ['admin:users', 'cert:read'];
      const target = ['cert:read', 'cert:issue']; // actor lacks cert:issue
      expect(canManageUser(actor, target)).toMatch(/permissions you do not possess/);
    });

    it('equal scopes allows management', () => {
      const scopes = ['admin:users', 'cert:read', 'cert:issue'];
      expect(canManageUser(scopes, scopes)).toBe(null);
    });
  });
});
