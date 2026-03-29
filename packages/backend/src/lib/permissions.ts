import type { UserRole } from '@/types.js';

const ROLE_HIERARCHY: Record<UserRole, number> = {
  blocked: -1,
  viewer: 0,
  operator: 1,
  admin: 2,
};

export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export function canManageCAs(role: UserRole): boolean {
  return role === 'admin';
}

export function canIssueCertificates(role: UserRole): boolean {
  return role === 'admin' || role === 'operator';
}

export function canRevokeCertificates(role: UserRole): boolean {
  return role === 'admin' || role === 'operator';
}

export function canManageUsers(role: UserRole): boolean {
  return role === 'admin';
}

export function canManageTemplates(role: UserRole): boolean {
  return role === 'admin';
}

export function canExportCAKeys(role: UserRole): boolean {
  return role === 'admin';
}

export function canViewAuditLog(role: UserRole): boolean {
  return role === 'admin';
}
