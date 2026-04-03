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

// User
export interface User {
  id: string;
  oidcSubject: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  groupId: string;
  groupName: string;
  scopes: string[];
  isBlocked: boolean;
}

// Permission Group
export interface PermissionGroup {
  id: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  parentId: string | null;
  scopes: string[];
  inheritedScopes?: string[];
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
}

// Nodes
export type NodeType = "nginx" | "bastion" | "monitoring" | "docker";
export type NodeStatus = "pending" | "online" | "offline" | "error";

export interface NodeHealthReport {
  nginxRunning: boolean;
  configValid: boolean;
  nginxUptimeSeconds: number;
  workerCount: number;
  nginxVersion: string;
  cpuPercent: number;
  memoryBytes: number;
  diskFreeBytes: number;
  timestamp: number;
  // System
  loadAverage1m: number;
  loadAverage5m: number;
  loadAverage15m: number;
  systemMemoryTotalBytes: number;
  systemMemoryUsedBytes: number;
  systemMemoryAvailableBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  systemUptimeSeconds: number;
  openFileDescriptors: number;
  maxFileDescriptors: number;
  // Disk
  diskMounts: Array<{
    mountPoint: string;
    filesystem: string;
    device: string;
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
  }>;
  diskReadBytes: number;
  diskWriteBytes: number;
  // Network
  networkInterfaces: Array<{
    name: string;
    rxBytes: number;
    txBytes: number;
    rxPackets: number;
    txPackets: number;
    rxErrors: number;
    txErrors: number;
  }>;
  // Nginx
  nginxRssBytes: number;
  errorRate4xx: number;
  errorRate5xx: number;
}

export interface NodeStatsReport {
  activeConnections: number;
  accepts: number;
  handled: number;
  requests: number;
  reading: number;
  writing: number;
  waiting: number;
  timestamp: number;
}

export interface Node {
  id: string;
  type: NodeType;
  hostname: string;
  displayName: string | null;
  status: NodeStatus;
  daemonVersion: string | null;
  osInfo: string | null;
  configVersionHash: string | null;
  capabilities: Record<string, unknown>;
  lastSeenAt: string | null;
  lastHealthReport: NodeHealthReport | null;
  lastStatsReport: NodeStatsReport | null;
  healthHistory: Array<{ hour: string; healthy: boolean }>;
  metadata: Record<string, unknown>;
  isDefault: boolean;
  isConnected: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NodeDetail extends Node {
  liveHealthReport: NodeHealthReport | null;
  liveStatsReport: NodeStatsReport | null;
}

export interface CreateNodeResponse {
  node: Node;
  enrollmentToken: string;
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

/** The scope that grants access to the AI assistant — must match backend canUseAI() */
export const AI_SCOPE = "ai:use" as const;

// API Token / Group scopes
export const TOKEN_SCOPES = [
  {
    value: "ca:read",
    label: "View CAs",
    desc: "List and view certificate authority details",
    group: "Certificate Authorities",
  },
  {
    value: "ca:create:root",
    label: "Create Root CAs",
    desc: "Create new root certificate authorities",
    group: "Certificate Authorities",
  },
  {
    value: "ca:create:intermediate",
    label: "Create Intermediate CAs",
    desc: "Create intermediate CAs under an existing root",
    group: "Certificate Authorities",
  },
  {
    value: "ca:revoke",
    label: "Revoke CAs",
    desc: "Revoke certificate authorities and their chains",
    group: "Certificate Authorities",
  },
  {
    value: "cert:read",
    label: "View Certificates",
    desc: "List and view issued certificate details",
    group: "Certificates",
  },
  {
    value: "cert:issue",
    label: "Issue Certificates",
    desc: "Issue new certificates from any CA",
    group: "Certificates",
  },
  {
    value: "cert:revoke",
    label: "Revoke Certificates",
    desc: "Revoke issued certificates",
    group: "Certificates",
  },
  {
    value: "cert:export",
    label: "Export Certificates",
    desc: "Download certificates and private keys",
    group: "Certificates",
  },
  {
    value: "template:read",
    label: "View Templates",
    desc: "List and view certificate issuance templates",
    group: "Templates",
  },
  {
    value: "template:manage",
    label: "Manage Templates",
    desc: "Create, edit, and delete certificate templates",
    group: "Templates",
  },
  {
    value: "proxy:list",
    label: "List Proxy Hosts",
    desc: "View the list of proxy hosts",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:view",
    label: "View Proxy Host Details",
    desc: "View proxy host details and settings",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:create",
    label: "Create Proxy Hosts",
    desc: "Create new proxy host configurations",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:edit",
    label: "Edit Proxy Hosts",
    desc: "Modify proxy host configurations",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:delete",
    label: "Delete Proxy Hosts",
    desc: "Remove proxy host configurations",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:advanced",
    label: "Advanced Config",
    desc: "Edit nginx advanced configuration blocks",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:raw-read",
    label: "View Raw Config",
    desc: "View rendered nginx configuration",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:raw-write",
    label: "Edit Raw Config",
    desc: "Edit raw nginx configuration directly",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:raw-toggle",
    label: "Toggle Raw Mode",
    desc: "Enable or disable raw config mode",
    group: "Proxy Hosts",
  },
  {
    value: "ssl:read",
    label: "View SSL Certificates",
    desc: "List and view SSL/TLS certificates",
    group: "SSL Certificates",
  },
  {
    value: "ssl:manage",
    label: "Manage SSL Certificates",
    desc: "Upload, request, and renew SSL certificates",
    group: "SSL Certificates",
  },
  {
    value: "ssl:delete",
    label: "Delete SSL Certificates",
    desc: "Remove SSL certificates",
    group: "SSL Certificates",
  },
  {
    value: "access-list:read",
    label: "View Access Lists",
    desc: "List and view IP-based access lists",
    group: "Access Lists",
  },
  {
    value: "access-list:manage",
    label: "Manage Access Lists",
    desc: "Create and edit access list rules",
    group: "Access Lists",
  },
  {
    value: "access-list:delete",
    label: "Delete Access Lists",
    desc: "Remove access lists",
    group: "Access Lists",
  },
  {
    value: "admin:users",
    label: "Manage Users",
    desc: "View, assign groups, block, and delete users",
    group: "Administration",
  },
  {
    value: "admin:groups",
    label: "Manage Groups",
    desc: "Create, edit, and delete permission groups",
    group: "Administration",
  },
  {
    value: "admin:audit",
    label: "View Audit Log",
    desc: "Access the full audit trail of system events",
    group: "Administration",
  },
  {
    value: "admin:system",
    label: "System Admin",
    desc: "Protected flag — holders cannot be managed by non-system-admins",
    group: "Administration",
  },
  {
    value: "admin:update",
    label: "Update Application",
    desc: "Check for and trigger application updates",
    group: "Administration",
  },
  {
    value: "admin:housekeeping",
    label: "Housekeeping",
    desc: "Run cleanup tasks like log rotation and expired cert removal",
    group: "Administration",
  },
  {
    value: "admin:alerts",
    label: "System Alerts",
    desc: "View and dismiss system alerts (expiry warnings, etc.)",
    group: "Administration",
  },
  {
    value: "admin:ai-config",
    label: "AI Configuration",
    desc: "Configure AI model, API keys, and tool access",
    group: "Administration",
  },
  {
    value: "nodes:list",
    label: "List Nodes",
    desc: "View the list of registered nodes",
    group: "Nodes",
  },
  {
    value: "nodes:details",
    label: "View Node Details",
    desc: "View node details and monitoring",
    group: "Nodes",
  },
  {
    value: "nodes:config",
    label: "View Node Config",
    desc: "View node nginx configuration",
    group: "Nodes",
  },
  {
    value: "nodes:logs",
    label: "View Node Logs",
    desc: "View nginx and daemon logs",
    group: "Nodes",
  },
  {
    value: "nodes:rename",
    label: "Rename Node",
    desc: "Change node display name",
    group: "Nodes",
  },
  {
    value: "nodes:config-edit",
    label: "Edit Node Config",
    desc: "Edit nginx configuration of node",
    group: "Nodes",
  },
  {
    value: "nodes:create",
    label: "Create Node",
    desc: "Register new nodes",
    group: "Nodes",
  },
  {
    value: "nodes:delete",
    label: "Delete Node",
    desc: "Remove registered nodes",
    group: "Nodes",
  },
  {
    value: "ai:use",
    label: "Use AI Assistant",
    desc: "Access the AI-powered assistant for guided operations",
    group: "Features",
  },
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
export type ProxyHostType = "proxy" | "redirect" | "404" | "raw";
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
  rawConfig: string | null;
  rawConfigEnabled: boolean;
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
  effectiveHealthStatus?: string;
  lastHealthCheckAt: string | null;
  healthHistory?: Array<{ ts: string; status: string }>;
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
  rawConfig?: string;
  rawConfigEnabled?: boolean;
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

// ── Docker Types ──────────────────────────────────────────────────

export interface DockerPort {
  privatePort: number;
  publicPort?: number;
  type: string;
  ip?: string;
}

export interface DockerMount {
  hostPath?: string;
  containerPath: string;
  name?: string;
  readOnly: boolean;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: number;
  ports: DockerPort[];
  labels?: Record<string, string>;
  // Stats (from health report, optional)
  cpuPercent?: number;
  memoryUsage?: number;
  memoryLimit?: number;
  networkRx?: number;
  networkTx?: number;
}

export interface DockerImage {
  id: string;
  repoTags: string[];
  size: number;
  created: number;
}

export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
  labels: Record<string, string>;
  scope: string;
  createdAt?: string;
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  ipam?: { subnet?: string; gateway?: string };
  containers?: Record<string, { name: string }>;
}

export interface DockerTemplate {
  id: string;
  name: string;
  description?: string;
  config: Record<string, unknown>;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DockerTask {
  id: string;
  nodeId: string;
  containerId?: string;
  containerName?: string;
  type: string;
  status: "pending" | "running" | "succeeded" | "failed";
  progress?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface DockerRegistry {
  id: string;
  name: string;
  url: string;
  username?: string;
  scope: "global" | "node";
  nodeId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileEntry {
  name: string;
  size: number;
  permissions: string;
  isDir: boolean;
  modified: string;
  isSymlink?: boolean;
  linkTarget?: string;
  isSpecial?: boolean;
  isWritable?: boolean;
}

export interface ContainerCreateConfig {
  image: string;
  name?: string;
  ports?: Array<{ hostPort: number; containerPort: number; protocol?: string }>;
  volumes?: Array<{
    hostPath?: string;
    containerPath: string;
    name?: string;
    readOnly?: boolean;
  }>;
  env?: Record<string, string>;
  networks?: string[];
  restartPolicy?: string;
  labels?: Record<string, string>;
  command?: string[];
}
