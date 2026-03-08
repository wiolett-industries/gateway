// User roles
export type UserRole = "admin" | "operator" | "auditor" | "viewer";

// User
export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

// CA types
export type CAType = "root" | "intermediate";
export type CAStatus = "active" | "revoked" | "expired" | "pending";

export type KeyAlgorithm = "RSA-2048" | "RSA-4096" | "EC-P256" | "EC-P384";
export type SignatureAlgorithm =
  | "SHA256WithRSA"
  | "SHA384WithRSA"
  | "SHA512WithRSA"
  | "ECDSAWithSHA256"
  | "ECDSAWithSHA384";

export interface CA {
  id: string;
  name: string;
  type: CAType;
  status: CAStatus;
  parentId: string | null;
  subject: CertificateSubject;
  keyAlgorithm: KeyAlgorithm;
  signatureAlgorithm: SignatureAlgorithm;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  maxPathLength: number;
  crlDistributionPoints: string[];
  ocspResponderUrl?: string;
  children?: CA[];
  certificateCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateSubject {
  commonName: string;
  organization?: string;
  organizationalUnit?: string;
  country?: string;
  state?: string;
  locality?: string;
}

// Certificate types
export type CertificateStatus = "active" | "revoked" | "expired" | "pending";
export type CertificateType = "server" | "client" | "codesign" | "email";
export type RevocationReason =
  | "unspecified"
  | "keyCompromise"
  | "caCompromise"
  | "affiliationChanged"
  | "superseded"
  | "cessationOfOperation";

export interface Certificate {
  id: string;
  caId: string;
  caName: string;
  templateId?: string;
  templateName?: string;
  type: CertificateType;
  status: CertificateStatus;
  subject: CertificateSubject;
  serialNumber: string;
  keyAlgorithm: KeyAlgorithm;
  signatureAlgorithm: SignatureAlgorithm;
  notBefore: string;
  notAfter: string;
  subjectAlternativeNames: string[];
  keyUsage: string[];
  extendedKeyUsage: string[];
  revocationReason?: RevocationReason;
  revokedAt?: string;
  pemCertificate?: string;
  pemChain?: string;
  issuedBy: string;
  createdAt: string;
  updatedAt: string;
}

// Template types
export interface Template {
  id: string;
  name: string;
  description: string;
  type: CertificateType;
  keyAlgorithm: KeyAlgorithm;
  signatureAlgorithm: SignatureAlgorithm;
  validityDays: number;
  keyUsage: string[];
  extendedKeyUsage: string[];
  subjectConstraints: {
    allowedOrganizations?: string[];
    allowedCountries?: string[];
    requireCommonName: boolean;
  };
  sanConstraints: {
    allowDNS: boolean;
    allowIP: boolean;
    allowEmail: boolean;
    allowedDomains?: string[];
  };
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// Audit log
export type AuditAction =
  | "ca.create"
  | "ca.revoke"
  | "ca.update"
  | "cert.issue"
  | "cert.revoke"
  | "cert.renew"
  | "cert.download"
  | "template.create"
  | "template.update"
  | "template.delete"
  | "user.login"
  | "user.logout"
  | "user.create"
  | "user.update"
  | "user.delete"
  | "settings.update"
  | "token.create"
  | "token.revoke";

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  actorId: string;
  actorName: string;
  actorEmail: string;
  resourceType: string;
  resourceId: string;
  resourceName: string;
  details: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
}

// Alert types
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertType = "expiry" | "crl" | "revocation" | "system";

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  resourceType: string;
  resourceId: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  createdAt: string;
}

// API Token
export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

// Pagination
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// API Error
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Stats
export interface DashboardStats {
  totalCAs: number;
  activeCAs: number;
  totalCertificates: number;
  activeCertificates: number;
  expiringCertificates: number;
  revokedCertificates: number;
  recentActivity: AuditLogEntry[];
  alerts: Alert[];
}

// Create/Issue request types
export interface CreateCARequest {
  name: string;
  type: CAType;
  parentId?: string;
  subject: CertificateSubject;
  keyAlgorithm: KeyAlgorithm;
  signatureAlgorithm: SignatureAlgorithm;
  validityYears: number;
  maxPathLength: number;
  crlDistributionPoints?: string[];
  ocspResponderUrl?: string;
}

export interface IssueCertificateRequest {
  caId: string;
  templateId?: string;
  type: CertificateType;
  subject: CertificateSubject;
  subjectAlternativeNames?: string[];
  validityDays: number;
  keyAlgorithm?: KeyAlgorithm;
}

export interface RevokeCertificateRequest {
  reason: RevocationReason;
}
