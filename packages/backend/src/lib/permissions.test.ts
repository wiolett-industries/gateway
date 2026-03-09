import { describe, it, expect } from 'vitest';
import {
  hasRole,
  canManageCAs,
  canIssueCertificates,
  canRevokeCertificates,
  canManageUsers,
  canManageTemplates,
  canExportCAKeys,
  canViewAuditLog,
} from './permissions.js';

describe('RBAC permissions', () => {
  describe('hasRole', () => {
    it('admin has all roles', () => {
      expect(hasRole('admin', 'admin')).toBe(true);
      expect(hasRole('admin', 'operator')).toBe(true);
      expect(hasRole('admin', 'viewer')).toBe(true);
    });

    it('operator has operator and viewer roles', () => {
      expect(hasRole('operator', 'admin')).toBe(false);
      expect(hasRole('operator', 'operator')).toBe(true);
      expect(hasRole('operator', 'viewer')).toBe(true);
    });

    it('viewer only has viewer role', () => {
      expect(hasRole('viewer', 'admin')).toBe(false);
      expect(hasRole('viewer', 'operator')).toBe(false);
      expect(hasRole('viewer', 'viewer')).toBe(true);
    });
  });

  describe('permission checks', () => {
    it('only admin can manage CAs', () => {
      expect(canManageCAs('admin')).toBe(true);
      expect(canManageCAs('operator')).toBe(false);
      expect(canManageCAs('viewer')).toBe(false);
    });

    it('admin and operator can issue certificates', () => {
      expect(canIssueCertificates('admin')).toBe(true);
      expect(canIssueCertificates('operator')).toBe(true);
      expect(canIssueCertificates('viewer')).toBe(false);
    });

    it('admin and operator can revoke certificates', () => {
      expect(canRevokeCertificates('admin')).toBe(true);
      expect(canRevokeCertificates('operator')).toBe(true);
      expect(canRevokeCertificates('viewer')).toBe(false);
    });

    it('only admin can manage users', () => {
      expect(canManageUsers('admin')).toBe(true);
      expect(canManageUsers('operator')).toBe(false);
      expect(canManageUsers('viewer')).toBe(false);
    });

    it('only admin can manage templates', () => {
      expect(canManageTemplates('admin')).toBe(true);
      expect(canManageTemplates('operator')).toBe(false);
      expect(canManageTemplates('viewer')).toBe(false);
    });

    it('only admin can export CA keys', () => {
      expect(canExportCAKeys('admin')).toBe(true);
      expect(canExportCAKeys('operator')).toBe(false);
      expect(canExportCAKeys('viewer')).toBe(false);
    });

    it('only admin can view audit log', () => {
      expect(canViewAuditLog('admin')).toBe(true);
      expect(canViewAuditLog('operator')).toBe(false);
      expect(canViewAuditLog('viewer')).toBe(false);
    });
  });
});
