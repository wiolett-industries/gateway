export type {
  AIConfig,
  AIMessage,
  AIToolCall,
  AIToolDef,
  ChatMessage,
  PageContext,
  QuickAction,
  WSClientMessage,
  WSServerMessage,
} from "./ai";

// User roles
export type UserRole = "admin" | "operator" | "viewer" | "blocked";

// User
export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: UserRole;
}

// CA types
export type CAType = "root" | "intermediate";
export type CAStatus = "active" | "revoked" | "expired";
export type KeyAlgorithm = "rsa-2048" | "rsa-4096" | "ecdsa-p256" | "ecdsa-p384";

export interface CA {
  id: string;
  parentId: string | null;
  type: CAType;
  status: CAStatus;
  commonName: string;
  keyAlgorithm: KeyAlgorithm;
  serialNumber: string;
  certificatePem: string;
  subjectDn: string;
  issuerDn: string | null;
  pathLengthConstraint: number | null;
  maxValidityDays: number;
  notBefore: string;
  notAfter: string;
  ocspCertPem: string | null;
  crlNumber: number;
  lastCrlAt: string | null;
  crlDistributionUrl: string | null;
  ocspResponderUrl: string | null;
  caIssuersUrl: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  revocationReason: string | null;
  certCount: number;
}

// Certificate types
export type CertificateStatus = "active" | "revoked" | "expired";
export type CertificateType = "tls-server" | "tls-client" | "code-signing" | "email";
export type RevocationReason =
  | "unspecified"
  | "keyCompromise"
  | "caCompromise"
  | "affiliationChanged"
  | "superseded"
  | "cessationOfOperation"
  | "certificateHold";

export interface Certificate {
  id: string;
  caId: string;
  templateId: string | null;
  status: CertificateStatus;
  type: CertificateType;
  commonName: string;
  sans: string[];
  serialNumber: string;
  certificatePem: string;
  keyAlgorithm: KeyAlgorithm;
  subjectDn: string;
  issuerDn: string;
  notBefore: string;
  notAfter: string;
  csrPem: string | null;
  serverGenerated: boolean;
  keyUsage: string[];
  extKeyUsage: string[];
  revokedAt: string | null;
  revocationReason: string | null;
  issuedById: string;
  createdAt: string;
  updatedAt: string;
}

// Template types
export interface SubjectDnFields {
  o?: string;
  ou?: string;
  l?: string;
  st?: string;
  c?: string;
  serialNumber?: string;
}

export interface CertificatePolicy {
  oid: string;
  qualifier?: string;
}

export interface CustomExtension {
  oid: string;
  critical: boolean;
  value: string;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  certType: CertificateType;
  keyAlgorithm: KeyAlgorithm;
  validityDays: number;
  keyUsage: string[];
  extKeyUsage: string[];
  requireSans: boolean;
  sanTypes: string[];
  subjectDnFields: SubjectDnFields;
  crlDistributionPoints: string[];
  authorityInfoAccess: { ocspUrl?: string; caIssuersUrl?: string };
  certificatePolicies: CertificatePolicy[];
  customExtensions: CustomExtension[];
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

// Audit log
export interface AuditLogEntry {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  userName: string | null;
  userEmail: string | null;
}

// Alert types
export interface Alert {
  id: string;
  type: "expiry_warning" | "expiry_critical" | "ca_expiry" | "revocation";
  resourceType: string;
  resourceId: string;
  message: string;
  dismissed: boolean;
  createdAt: string;
}

// API Token scopes
export const TOKEN_SCOPES = [
  { value: "ca:read", label: "View CAs", group: "Certificate Authorities" },
  { value: "ca:create:root", label: "Create Root CAs", group: "Certificate Authorities" },
  {
    value: "ca:create:intermediate",
    label: "Create Intermediate CAs",
    group: "Certificate Authorities",
  },
  { value: "ca:revoke", label: "Revoke CAs", group: "Certificate Authorities" },
  { value: "cert:read", label: "View Certificates", group: "Certificates" },
  { value: "cert:issue", label: "Issue Certificates (any CA)", group: "Certificates" },
  { value: "cert:revoke", label: "Revoke Certificates", group: "Certificates" },
  { value: "cert:export", label: "Export Certificates", group: "Certificates" },
  { value: "template:read", label: "View Templates", group: "Templates" },
  { value: "template:manage", label: "Manage Templates", group: "Templates" },
  { value: "proxy:read", label: "View Proxy Hosts", group: "Proxy Hosts" },
  { value: "proxy:manage", label: "Create & Edit Proxy Hosts", group: "Proxy Hosts" },
  { value: "proxy:delete", label: "Delete Proxy Hosts", group: "Proxy Hosts" },
  { value: "ssl:read", label: "View SSL Certificates", group: "SSL Certificates" },
  { value: "ssl:manage", label: "Manage SSL Certificates", group: "SSL Certificates" },
  { value: "ssl:delete", label: "Delete SSL Certificates", group: "SSL Certificates" },
  { value: "access-list:read", label: "View Access Lists", group: "Access Lists" },
  { value: "access-list:manage", label: "Manage Access Lists", group: "Access Lists" },
  { value: "access-list:delete", label: "Delete Access Lists", group: "Access Lists" },
  { value: "admin:users", label: "Manage Users", group: "Administration" },
  { value: "admin:audit", label: "View Audit Log", group: "Administration" },
] as const;

export interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

// Pagination
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// API Error
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

// Request types
export interface CreateRootCARequest {
  commonName: string;
  keyAlgorithm: KeyAlgorithm;
  validityYears: number;
  pathLengthConstraint?: number;
  maxValidityDays?: number;
}

export interface CreateIntermediateCARequest {
  commonName: string;
  keyAlgorithm: KeyAlgorithm;
  validityYears: number;
  pathLengthConstraint?: number;
  maxValidityDays?: number;
}

export interface IssueCertificateRequest {
  caId: string;
  templateId?: string;
  type: CertificateType;
  commonName: string;
  sans: string[];
  keyAlgorithm: KeyAlgorithm;
  validityDays: number;
  subjectDnFields?: SubjectDnFields;
}

export interface IssueCertFromCSRRequest {
  caId: string;
  templateId?: string;
  type: CertificateType;
  csrPem: string;
  validityDays: number;
  overrideSans?: string[];
}

// Proxy Host Types
export type ProxyHostType = "proxy" | "redirect" | "404";
export type ForwardScheme = "http" | "https";
export type HealthStatus = "online" | "offline" | "degraded" | "unknown" | "disabled";

export interface CustomHeader {
  name: string;
  value: string;
}

export interface CacheOptions {
  maxAge?: number;
  staleWhileRevalidate?: number;
}

export interface RateLimitOptions {
  requestsPerSecond: number;
  burst?: number;
}

export interface RewriteRule {
  source: string;
  destination: string;
  type: "permanent" | "temporary";
}

export interface ProxyHost {
  id: string;
  type: ProxyHostType;
  domainNames: string[];
  enabled: boolean;
  forwardHost: string | null;
  forwardPort: number | null;
  forwardScheme: ForwardScheme;
  sslEnabled: boolean;
  sslForced: boolean;
  http2Support: boolean;
  sslCertificateId: string | null;
  internalCertificateId: string | null;
  websocketSupport: boolean;
  redirectUrl: string | null;
  redirectStatusCode: number;
  customHeaders: CustomHeader[];
  cacheEnabled: boolean;
  cacheOptions: CacheOptions | null;
  rateLimitEnabled: boolean;
  rateLimitOptions: RateLimitOptions | null;
  customRewrites: RewriteRule[];
  advancedConfig: string | null;
  accessListId: string | null;
  folderId: string | null;
  sortOrder: number;
  nginxTemplateId: string | null;
  templateVariables: Record<string, string | number | boolean>;
  healthCheckEnabled: boolean;
  healthCheckUrl: string;
  healthCheckInterval: number;
  healthCheckExpectedStatus: number | null;
  healthCheckExpectedBody: string | null;
  healthStatus: HealthStatus;
  lastHealthCheckAt: string | null;
  isSystem?: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  // Relations (populated in detail views)
  sslCertificate?: SSLCertificate;
  accessList?: AccessList;
}

// SSL Certificate Types
export type SSLCertType = "acme" | "upload" | "internal";
export type SSLCertStatus = "active" | "expired" | "pending" | "error";
export type ACMEChallengeType = "http-01" | "dns-01";

export interface SSLCertificate {
  id: string;
  name: string;
  type: SSLCertType;
  domainNames: string[];
  acmeProvider: string | null;
  acmeChallengeType: ACMEChallengeType | null;
  internalCertId: string | null;
  notBefore: string | null;
  notAfter: string | null;
  autoRenew: boolean;
  lastRenewedAt: string | null;
  renewalError: string | null;
  status: SSLCertStatus;
  isSystem?: boolean;
  createdAt: string;
  updatedAt: string;
}

// Access List Types
export interface IPRule {
  type: "allow" | "deny";
  value: string;
}

export interface BasicAuthUser {
  username: string;
}

export interface AccessList {
  id: string;
  name: string;
  description: string | null;
  ipRules: IPRule[];
  basicAuthEnabled: boolean;
  basicAuthUsers: BasicAuthUser[];
  createdAt: string;
  updatedAt: string;
  usageCount?: number;
}

// Dashboard Stats
export interface DashboardStats {
  proxyHosts: {
    total: number;
    enabled: number;
    online: number;
    offline: number;
    degraded: number;
  };
  sslCertificates: {
    total: number;
    active: number;
    expiringSoon: number;
    expired: number;
  };
  pkiCertificates: {
    total: number;
    active: number;
    revoked: number;
    expired: number;
  };
  cas: {
    total: number;
    active: number;
  };
}

// Request types (Gateway)
export interface CreateProxyHostRequest {
  type: ProxyHostType;
  domainNames: string[];
  forwardHost?: string;
  forwardPort?: number;
  forwardScheme?: ForwardScheme;
  sslEnabled?: boolean;
  sslForced?: boolean;
  http2Support?: boolean;
  sslCertificateId?: string;
  internalCertificateId?: string;
  websocketSupport?: boolean;
  redirectUrl?: string;
  redirectStatusCode?: number;
  customHeaders?: CustomHeader[];
  cacheEnabled?: boolean;
  cacheOptions?: CacheOptions;
  rateLimitEnabled?: boolean;
  rateLimitOptions?: RateLimitOptions;
  customRewrites?: RewriteRule[];
  advancedConfig?: string;
  accessListId?: string;
  folderId?: string;
  nginxTemplateId?: string;
  templateVariables?: Record<string, string | number | boolean>;
  healthCheckEnabled?: boolean;
  healthCheckUrl?: string;
  healthCheckInterval?: number;
  healthCheckExpectedStatus?: number;
  healthCheckExpectedBody?: string;
}

// Proxy Host Folder Types
export interface ProxyHostFolder {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  depth: number;
  createdAt: string;
  updatedAt: string;
}

export interface FolderTreeNode extends ProxyHostFolder {
  children: FolderTreeNode[];
  hosts: ProxyHost[];
}

export interface GroupedProxyHostsResponse {
  folders: FolderTreeNode[];
  ungroupedHosts: ProxyHost[];
  totalHosts: number;
}

// Nginx Config Template Types
export interface TemplateVariableDef {
  name: string;
  type: "string" | "number" | "boolean";
  default?: string | number | boolean;
  description?: string;
}

export interface NginxTemplate {
  id: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  type: ProxyHostType;
  content: string;
  variables: TemplateVariableDef[];
  createdAt: string;
  updatedAt: string;
}

export interface RequestACMECertRequest {
  domains: string[];
  challengeType: ACMEChallengeType;
  provider?: string;
  autoRenew?: boolean;
}

export interface UploadCertRequest {
  name: string;
  certificatePem: string;
  privateKeyPem: string;
  chainPem?: string;
}

export interface LinkInternalCertRequest {
  internalCertId: string;
  name?: string;
}

export interface CreateAccessListRequest {
  name: string;
  description?: string;
  ipRules: IPRule[];
  basicAuthEnabled?: boolean;
  basicAuthUsers?: { username: string; password: string }[];
}

export interface DNSChallenge {
  domain: string;
  recordName: string;
  recordValue: string;
}

// ── Nginx Monitoring ──────────────────────────────────────────────

export interface NginxStubStatus {
  activeConnections: number;
  accepts: number;
  handled: number;
  requests: number;
  reading: number;
  writing: number;
  waiting: number;
}

export interface NginxSystemStats {
  cpuUsagePercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  memoryUsagePercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
}

export interface NginxTrafficStats {
  statusCodes: { s2xx: number; s3xx: number; s4xx: number; s5xx: number };
  avgResponseTime: number;
  p95ResponseTime: number;
  totalRequests: number;
}

export interface NginxStatsSnapshot {
  timestamp: string;
  stubStatus: NginxStubStatus | null;
  systemStats: NginxSystemStats | null;
  trafficStats: NginxTrafficStats | null;
  derived: {
    requestsPerSec: number;
    connectionsPerSec: number;
  };
}

export interface NginxProcessInfo {
  version: string;
  workerCount: number;
  uptime: string;
  uptimeSeconds: number;
  containerStatus: string;
  configValid: boolean;
}

// ── Domains ───────────────────────────────────────────────────────

export type DnsStatus = "valid" | "invalid" | "pending" | "unknown";

export interface DnsRecords {
  a: string[];
  aaaa: string[];
  cname: string[];
  caa: Array<{ critical: number; issue?: string; issuewild?: string }>;
  mx: Array<{ exchange: string; priority: number }>;
  txt: string[][];
}

export interface Domain {
  id: string;
  domain: string;
  description: string | null;
  dnsStatus: DnsStatus;
  lastDnsCheckAt: string | null;
  dnsRecords: DnsRecords | null;
  isSystem?: boolean;
  sslCertCount?: number;
  proxyHostCount?: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface DomainUsage {
  proxyHosts: Array<{ id: string; domainNames: string[]; enabled: boolean }>;
  sslCertificates: Array<{
    id: string;
    domainNames: string[];
    status: string;
    notAfter: string | null;
  }>;
}

export interface DomainWithUsage extends Domain {
  usage: DomainUsage;
}

export interface DomainSearchResult {
  id: string;
  domain: string;
  dnsStatus: DnsStatus;
}

export interface CreateDomainRequest {
  domain: string;
  description?: string;
}

export interface UpdateDomainRequest {
  description?: string | null;
}

// System Update
export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseNotes: string | null;
  releaseUrl: string | null;
  lastCheckedAt: string | null;
}

// Housekeeping
export interface HousekeepingConfig {
  enabled: boolean;
  cronExpression: string;
  nginxLogs: { enabled: boolean; retentionDays: number };
  auditLog: { enabled: boolean; retentionDays: number };
  dismissedAlerts: { enabled: boolean; retentionDays: number };
  dockerPrune: { enabled: boolean };
  orphanedCerts: { enabled: boolean };
  acmeCleanup: { enabled: boolean };
}

export interface HousekeepingCategoryResult {
  category: string;
  success: boolean;
  itemsCleaned: number;
  spaceFreedBytes?: number;
  error?: string;
  durationMs: number;
}

export interface HousekeepingRunResult {
  startedAt: string;
  completedAt: string;
  trigger: "scheduled" | "manual";
  triggeredBy?: string;
  totalDurationMs: number;
  categories: HousekeepingCategoryResult[];
  overallSuccess: boolean;
}

export interface HousekeepingStats {
  nginxLogs: { totalSizeBytes: number; fileCount: number; oldestFile: string | null };
  auditLog: { totalRows: number; oldestEntry: string | null };
  dismissedAlerts: { count: number; oldestAlert: string | null };
  orphanedCerts: { count: number; certIds: string[] };
  acmeChallenges: { fileCount: number; totalSizeBytes: number };
  dockerImages: { oldImageCount: number; reclaimableBytes: number };
  lastRun: HousekeepingRunResult | null;
  isRunning: boolean;
}
