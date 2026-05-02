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

export interface AuthProvisioningGroupOption {
  id: string;
  name: string;
  isBuiltin: boolean;
}

export interface AuthProvisioningSettings {
  oidcAutoCreateUsers: boolean;
  oidcDefaultGroupId: string;
  mcpServerEnabled: boolean;
  networkSecurity: {
    clientIpSource: "auto" | "direct" | "reverse_proxy" | "cloudflare";
    trustedProxyCidrs: string[];
    trustCloudflareHeaders: boolean;
  };
  outboundWebhookPolicy: {
    allowPrivateNetworks: boolean;
    allowedPrivateCidrs: string[];
  };
  currentRequestIp: {
    ipAddress?: string;
    remoteAddress?: string;
    source: "remote" | "cloudflare" | "forwarded" | "real-ip" | "unknown";
    warning?: string;
  };
  availableGroups: AuthProvisioningGroupOption[];
}

export interface OAuthConsentPreview {
  requestId: string;
  client: {
    id: string;
    name: string;
    uri: string | null;
    logoUri: string | null;
  };
  account: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  };
  requestedScopes: string[];
  grantableScopes: string[];
  unavailableScopes: string[];
  manualApprovalScopes: string[];
  resource: string;
  resourceInfo: {
    resource: string;
    name: string;
    description: string;
  };
  expiresAt: string;
}

export interface OAuthAuthorization {
  clientId: string;
  clientName: string;
  clientUri: string | null;
  logoUri: string | null;
  scopes: string[];
  resource: string;
  resources: string[];
  activeAccessTokens: number;
  activeRefreshTokens: number;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export type LoggingSchemaMode = "loose" | "strip" | "reject";
export type LoggingSeverity = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type LoggingFieldType = "string" | "number" | "boolean" | "datetime" | "json";

export interface LoggingFieldDefinition {
  key: string;
  location: "label" | "field";
  type: LoggingFieldType;
  required: boolean;
  description?: string;
}

export interface LoggingEnvironment {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  enabled: boolean;
  schemaId: string | null;
  schemaName: string | null;
  schemaMode: LoggingSchemaMode;
  retentionDays: number;
  rateLimitRequestsPerWindow: number | null;
  rateLimitEventsPerWindow: number | null;
  fieldSchema: LoggingFieldDefinition[];
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoggingSchema {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  schemaMode: LoggingSchemaMode;
  fieldSchema: LoggingFieldDefinition[];
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoggingIngestToken {
  id: string;
  environmentId: string;
  name: string;
  tokenPrefix: string;
  enabled: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdById: string | null;
  createdAt: string;
  token?: string;
}

export interface LoggingSearchRequest {
  from?: string;
  to?: string;
  severities?: LoggingSeverity[];
  services?: string[];
  sources?: string[];
  message?: string;
  messageMatch?: "contains" | "startsWith" | "endsWith";
  traceId?: string;
  spanId?: string;
  requestId?: string;
  labels?: Record<string, string>;
  fields?: Record<string, { op: string; value: unknown }>;
  expression?: LoggingSearchExpression;
  limit?: number;
  cursor?: string | null;
}

export type LoggingSearchExpression =
  | { type: "and" | "or"; children: LoggingSearchExpression[] }
  | { type: "not"; child: LoggingSearchExpression }
  | { type: "text"; value: string; match?: "contains" | "startsWith" | "endsWith" }
  | { type: "label"; key: string; op: "exists" | "eq" | "neq"; value?: string }
  | {
      type: "field";
      key: string;
      op: "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte";
      value: unknown;
    }
  | { type: "severity"; op: "eq" | "gt" | "gte" | "lt" | "lte"; value: LoggingSeverity }
  | {
      type: "service" | "source" | "traceId" | "spanId" | "requestId";
      op: "eq" | "neq";
      value: string;
    };

export interface LoggingSearchResult {
  eventId: string;
  timestamp: string;
  ingestedAt: string;
  environmentId: string;
  severity: LoggingSeverity;
  message: string;
  service: string;
  source: string;
  traceId: string;
  spanId: string;
  requestId: string;
  labels: Record<string, string>;
  fields: Record<string, unknown>;
}

export interface LoggingFacets {
  services: string[];
  sources: string[];
  severities: Array<{ severity: LoggingSeverity; count: number }>;
  labels: Record<string, string[]>;
}

export interface LoggingMetadata {
  services: string[];
  sources: string[];
  labelKeys: string[];
  fieldKeys: string[];
  labelValues: Record<string, string[]>;
}

export interface LoggingFeatureStatus {
  enabled: boolean;
  available: boolean;
  reason?: string | null;
  config?: {
    database: string;
    table: string;
    requestTimeoutMs: number;
    ingestMaxBodyBytes: number;
    ingestMaxBatchSize: number;
    ingestMaxMessageBytes: number;
    ingestMaxLabels: number;
    ingestMaxFields: number;
    ingestMaxKeyLength: number;
    ingestMaxValueBytes: number;
    ingestMaxJsonDepth: number;
    rateLimitWindowSeconds: number;
    globalRequestsPerWindow: number;
    globalEventsPerWindow: number;
    tokenRequestsPerWindow: number;
    tokenEventsPerWindow: number;
  };
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
  serviceCreationLocked: boolean;
  daemonVersion: string | null;
  osInfo: string | null;
  configVersionHash: string | null;
  capabilities: Record<string, unknown>;
  lastSeenAt: string | null;
  lastHealthReport?: NodeHealthReport | null;
  lastStatsReport?: NodeStatsReport | null;
  healthHistory?: Array<{ ts: string; status: string }>;
  metadata: Record<string, unknown>;
  isConnected: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Check if a node is outside the supported gateway/daemon minor-version window. */
export function isNodeIncompatible(node: Node | NodeDetail): boolean {
  return !!(node.capabilities as Record<string, unknown>)?.versionMismatch;
}

export function isNodeUpdating(node: Node | NodeDetail): boolean {
  return (node.metadata as Record<string, unknown> | undefined)?.updateInProgress === true;
}

export function getNodeUpdateTargetVersion(node: Node | NodeDetail): string | null {
  const target = (node.metadata as Record<string, unknown> | undefined)?.updateTargetVersion;
  return typeof target === "string" && target.length > 0 ? target : null;
}

/** Compute effective node status from recent health history (mirrors proxy effectiveHealthStatus) */
export function effectiveNodeStatus(node: {
  status: NodeStatus;
  healthHistory?: Array<{ ts: string; status: string }>;
}): string {
  if (node.status !== "online" || !node.healthHistory?.length) return node.status;
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const recent = node.healthHistory.filter((h) => h.ts && new Date(h.ts).getTime() >= fiveMinAgo);
  if (recent.some((h) => h.status === "offline" || h.status === "degraded")) return "degraded";
  return "online";
}

export interface NodeDetail extends Node {
  lastHealthReport: NodeHealthReport | null;
  lastStatsReport: NodeStatsReport | null;
  liveHealthReport: NodeHealthReport | null;
  liveStatsReport: NodeStatsReport | null;
}

export interface CreateNodeResponse {
  node: Node;
  enrollmentToken: string;
  gatewayCertSha256: string;
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
  isSystem?: boolean;
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
  isSystem?: boolean;
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
export const AI_SCOPE = "feat:ai:use" as const;

// ── Notifications ──────────────────────────────────────────────────

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  type: "threshold" | "event";
  category: "node" | "container" | "proxy" | "certificate" | "database_postgres" | "database_redis";
  severity: "info" | "warning" | "critical";
  metric: string | null;
  metricTarget: string | null;
  operator: string | null;
  thresholdValue: number | null;
  durationSeconds: number;
  fireThresholdPercent: number;
  resolveAfterSeconds: number;
  resolveThresholdPercent: number;
  eventPattern: string | null;
  resourceIds: string[];
  messageTemplate: string | null;
  webhookIds: string[];
  cooldownSeconds: number;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationWebhook {
  id: string;
  name: string;
  url: string;
  method: string;
  enabled: boolean;
  signingSecret: string | null;
  signingHeader: string | null;
  templatePreset: string | null;
  bodyTemplate: string | null;
  headers: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  webhookName: string | null;
  eventType: string;
  severity: string;
  requestUrl: string;
  requestMethod: string;
  requestBody: string | null;
  requestBodyPreview?: string | null;
  requestBodyTruncated?: boolean;
  responseStatus: number | null;
  responseBody: string | null;
  responseBodyPreview?: string | null;
  responseBodyTruncated?: boolean;
  responseTimeMs: number | null;
  attempt: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  status: "pending" | "success" | "failed" | "retrying";
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface WebhookPreset {
  id: string;
  name: string;
  description: string;
  urlHint: string;
  defaultHeaders: Record<string, string>;
  bodyTemplate: string;
}

export interface AlertCategoryDef {
  id: string;
  label: string;
  metrics: Array<{
    id: string;
    label: string;
    unit: string;
    defaultOperator: string;
    defaultValue: number;
    defaultDurationSeconds?: number;
    defaultResolveAfterSeconds?: number;
  }>;
  events: Array<{
    id: string;
    label: string;
    defaultSeverity: string;
    supportsThreshold?: boolean;
  }>;
  variables: Array<{ name: string; description: string }>;
}

export const RESOURCE_SCOPABLE_SCOPES = [
  "pki:ca:create:intermediate",
  "pki:cert:view",
  "pki:cert:issue",
  "pki:cert:revoke",
  "pki:cert:export",
  "proxy:view",
  "proxy:create",
  "proxy:edit",
  "proxy:delete",
  "proxy:advanced",
  "proxy:advanced:bypass",
  "proxy:raw:read",
  "proxy:raw:write",
  "proxy:raw:toggle",
  "proxy:raw:bypass",
  "proxy:templates:view",
  "proxy:templates:edit",
  "proxy:templates:delete",
  "ssl:cert:view",
  "ssl:cert:delete",
  "ssl:cert:revoke",
  "ssl:cert:export",
  "acl:view",
  "acl:edit",
  "acl:delete",
  "nodes:details",
  "nodes:config:view",
  "nodes:config:edit",
  "nodes:logs",
  "nodes:console",
  "nodes:rename",
  "nodes:delete",
  "nodes:lock",
  "docker:containers:view",
  "docker:containers:create",
  "docker:containers:edit",
  "docker:containers:manage",
  "docker:containers:environment",
  "docker:containers:delete",
  "docker:containers:console",
  "docker:containers:files",
  "docker:containers:secrets",
  "docker:containers:webhooks",
  "docker:containers:mounts",
  "docker:images:view",
  "docker:images:pull",
  "docker:images:delete",
  "docker:volumes:view",
  "docker:volumes:create",
  "docker:volumes:delete",
  "docker:networks:view",
  "docker:networks:create",
  "docker:networks:edit",
  "docker:networks:delete",
  "databases:view",
  "databases:edit",
  "databases:delete",
  "databases:query:read",
  "databases:query:write",
  "databases:query:admin",
  "databases:credentials:reveal",
  "logs:environments:view",
  "logs:environments:edit",
  "logs:environments:delete",
  "logs:tokens:view",
  "logs:tokens:create",
  "logs:tokens:delete",
  "logs:schemas:view",
  "logs:schemas:edit",
  "logs:schemas:delete",
  "logs:read",
] as const;

// API Token / Group scopes
const RAW_TOKEN_SCOPES = [
  // PKI: Certificate Authorities
  {
    value: "pki:ca:view:root",
    label: "View Root CAs",
    desc: "View root certificate authorities",
    group: "PKI: Certificate Authorities",
  },
  {
    value: "pki:ca:view:intermediate",
    label: "View Intermediate CAs",
    desc: "View intermediate certificate authorities",
    group: "PKI: Certificate Authorities",
  },
  {
    value: "pki:ca:create:root",
    label: "Create Root CAs",
    desc: "Create new root certificate authorities",
    group: "PKI: Certificate Authorities",
  },
  {
    value: "pki:ca:create:intermediate",
    label: "Create Intermediate CAs",
    desc: "Create intermediate CAs under a root",
    group: "PKI: Certificate Authorities",
  },
  {
    value: "pki:ca:revoke:root",
    label: "Revoke Root CAs",
    desc: "Revoke root certificate authorities",
    group: "PKI: Certificate Authorities",
  },
  {
    value: "pki:ca:revoke:intermediate",
    label: "Revoke Intermediate CAs",
    desc: "Revoke intermediate certificate authorities",
    group: "PKI: Certificate Authorities",
  },
  // PKI: Certificates
  {
    value: "pki:cert:view",
    label: "View Certificates",
    desc: "View issued certificates",
    group: "PKI: Certificates",
  },
  {
    value: "pki:cert:issue",
    label: "Issue Certificates",
    desc: "Issue new certificates",
    group: "PKI: Certificates",
  },
  {
    value: "pki:cert:revoke",
    label: "Revoke Certificates",
    desc: "Revoke issued certificates",
    group: "PKI: Certificates",
  },
  {
    value: "pki:cert:export",
    label: "Export Certificates",
    desc: "Export certificates and keys",
    group: "PKI: Certificates",
  },
  // PKI: Templates
  {
    value: "pki:templates:view",
    label: "View Templates",
    desc: "View certificate templates",
    group: "PKI: Templates",
  },
  {
    value: "pki:templates:create",
    label: "Create Templates",
    desc: "Create certificate templates",
    group: "PKI: Templates",
  },
  {
    value: "pki:templates:edit",
    label: "Edit Templates",
    desc: "Edit certificate templates",
    group: "PKI: Templates",
  },
  {
    value: "pki:templates:delete",
    label: "Delete Templates",
    desc: "Delete certificate templates",
    group: "PKI: Templates",
  },
  // Domains
  { value: "domains:view", label: "View Domains", desc: "View managed domains", group: "Domains" },
  {
    value: "domains:create",
    label: "Create Domains",
    desc: "Create managed domains",
    group: "Domains",
  },
  { value: "domains:edit", label: "Edit Domains", desc: "Edit managed domains", group: "Domains" },
  {
    value: "domains:delete",
    label: "Delete Domains",
    desc: "Delete managed domains",
    group: "Domains",
  },
  // Proxy Hosts
  {
    value: "proxy:view",
    label: "View Proxy Hosts",
    desc: "View and search proxy hosts",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:create",
    label: "Create Proxy Hosts",
    desc: "Create new proxy hosts",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:edit",
    label: "Edit Proxy Hosts",
    desc: "Edit proxy host configuration",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:delete",
    label: "Delete Proxy Hosts",
    desc: "Delete proxy hosts",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:advanced",
    label: "Advanced Proxy Config",
    desc: "Use advanced proxy configuration",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:advanced:bypass",
    label: "Bypass Advanced Config Restrictions",
    desc: "Save unrestricted advanced nginx snippets",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:raw:read",
    label: "Read Raw Config",
    desc: "View raw nginx configuration",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:raw:write",
    label: "Write Raw Config",
    desc: "Edit raw nginx configuration",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:raw:toggle",
    label: "Toggle Raw Config",
    desc: "Switch between managed and raw config mode",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:raw:bypass",
    label: "Bypass Raw Config Restrictions",
    desc: "Save raw nginx config without dangerous directive restrictions",
    group: "Proxy Hosts",
  },
  {
    value: "proxy:folders:manage",
    label: "Manage Proxy Folders",
    desc: "Create, reorder, and remove proxy host folders",
    group: "Proxy Hosts",
  },
  // Proxy Templates
  {
    value: "proxy:templates:view",
    label: "View Nginx Templates",
    desc: "View nginx templates",
    group: "Proxy Templates",
  },
  {
    value: "proxy:templates:create",
    label: "Create Nginx Templates",
    desc: "Create nginx templates",
    group: "Proxy Templates",
  },
  {
    value: "proxy:templates:edit",
    label: "Edit Nginx Templates",
    desc: "Edit nginx templates",
    group: "Proxy Templates",
  },
  {
    value: "proxy:templates:delete",
    label: "Delete Nginx Templates",
    desc: "Delete nginx templates",
    group: "Proxy Templates",
  },
  // SSL Certificates
  {
    value: "ssl:cert:view",
    label: "View SSL Certificates",
    desc: "View SSL certificates",
    group: "SSL Certificates",
  },
  {
    value: "ssl:cert:issue",
    label: "Issue SSL Certificates",
    desc: "Provision ACME or upload SSL certificates",
    group: "SSL Certificates",
  },
  {
    value: "ssl:cert:delete",
    label: "Delete SSL Certificates",
    desc: "Delete SSL certificates",
    group: "SSL Certificates",
  },
  {
    value: "ssl:cert:revoke",
    label: "Revoke SSL Certificates",
    desc: "Revoke SSL certificates",
    group: "SSL Certificates",
  },
  {
    value: "ssl:cert:export",
    label: "Export SSL Certificates",
    desc: "Export SSL certificates",
    group: "SSL Certificates",
  },
  // Access Control Lists
  {
    value: "acl:view",
    label: "View Access Lists",
    desc: "View access control lists",
    group: "Access Control",
  },
  {
    value: "acl:create",
    label: "Create Access Lists",
    desc: "Create access control lists",
    group: "Access Control",
  },
  {
    value: "acl:edit",
    label: "Edit Access Lists",
    desc: "Edit access control lists",
    group: "Access Control",
  },
  {
    value: "acl:delete",
    label: "Delete Access Lists",
    desc: "Delete access control lists",
    group: "Access Control",
  },
  // Nodes
  { value: "nodes:details", label: "View Nodes", desc: "View managed nodes", group: "Nodes" },
  { value: "nodes:create", label: "Create Nodes", desc: "Enroll new nodes", group: "Nodes" },
  { value: "nodes:rename", label: "Rename Nodes", desc: "Rename nodes", group: "Nodes" },
  { value: "nodes:delete", label: "Delete Nodes", desc: "Remove nodes", group: "Nodes" },
  {
    value: "nodes:lock",
    label: "Lock Service Creation",
    desc: "Prevent new proxy hosts or containers on selected nodes",
    group: "Nodes",
  },
  {
    value: "nodes:config:view",
    label: "View Node Config",
    desc: "View node nginx configuration",
    group: "Nodes",
  },
  {
    value: "nodes:config:edit",
    label: "Edit Node Config",
    desc: "Edit node nginx configuration",
    group: "Nodes",
  },
  {
    value: "nodes:logs",
    label: "View Node Logs",
    desc: "View node daemon and nginx logs",
    group: "Nodes",
  },
  {
    value: "nodes:console",
    label: "Node Console",
    desc: "Open interactive shell on nodes",
    group: "Nodes",
  },
  // Administration
  {
    value: "admin:users",
    label: "Manage Users",
    desc: "Create, edit, and delete users",
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
    desc: "View the audit log",
    group: "Administration",
  },
  {
    value: "admin:system",
    label: "System Admin",
    desc: "System-level administration (protected)",
    group: "Administration",
  },
  {
    value: "admin:details:certificates",
    label: "View System Certificates",
    desc: "View internal system PKI and SSL certificates in read-only mode",
    group: "Administration",
  },
  {
    value: "admin:update",
    label: "Manage Updates",
    desc: "Check for and apply updates",
    group: "Administration",
  },
  {
    value: "admin:alerts",
    label: "Manage Alerts",
    desc: "View and manage alerts",
    group: "Administration",
  },
  // Gateway Settings
  {
    value: "settings:gateway:view",
    label: "View Gateway Settings",
    desc: "View sign-in provisioning and external control-plane settings",
    group: "Gateway Settings",
  },
  {
    value: "settings:gateway:edit",
    label: "Edit Gateway Settings",
    desc: "Edit sign-in provisioning and external control-plane settings",
    group: "Gateway Settings",
  },
  // Housekeeping
  {
    value: "housekeeping:view",
    label: "View Housekeeping",
    desc: "View housekeeping configuration, stats, and run history",
    group: "Housekeeping",
  },
  {
    value: "housekeeping:run",
    label: "Run Housekeeping",
    desc: "Manually run housekeeping tasks",
    group: "Housekeeping",
  },
  {
    value: "housekeeping:configure",
    label: "Configure Housekeeping",
    desc: "Edit housekeeping configuration and schedule",
    group: "Housekeeping",
  },
  // Licensing
  {
    value: "license:view",
    label: "View License",
    desc: "View Gateway license status and entitlement details",
    group: "Licensing",
  },
  {
    value: "license:manage",
    label: "Manage License",
    desc: "Activate, update, or remove the Gateway license",
    group: "Licensing",
  },
  // Notifications
  {
    value: "notifications:alerts:view",
    label: "View Alert Rules",
    desc: "View notification alert rules",
    group: "Notifications",
  },
  {
    value: "notifications:alerts:create",
    label: "Create Alert Rules",
    desc: "Create notification alert rules",
    group: "Notifications",
  },
  {
    value: "notifications:alerts:edit",
    label: "Edit Alert Rules",
    desc: "Edit notification alert rules",
    group: "Notifications",
  },
  {
    value: "notifications:alerts:delete",
    label: "Delete Alert Rules",
    desc: "Delete notification alert rules",
    group: "Notifications",
  },
  {
    value: "notifications:webhooks:view",
    label: "View Webhooks",
    desc: "View notification webhooks",
    group: "Notifications",
  },
  {
    value: "notifications:webhooks:create",
    label: "Create Webhooks",
    desc: "Create notification webhooks",
    group: "Notifications",
  },
  {
    value: "notifications:webhooks:edit",
    label: "Edit Webhooks",
    desc: "Edit notification webhooks",
    group: "Notifications",
  },
  {
    value: "notifications:webhooks:delete",
    label: "Delete Webhooks",
    desc: "Delete notification webhooks",
    group: "Notifications",
  },
  {
    value: "notifications:deliveries:view",
    label: "View Delivery Logs",
    desc: "View webhook delivery attempts",
    group: "Notifications",
  },
  {
    value: "notifications:view",
    label: "View Notifications",
    desc: "Read notification resources across alerts, webhooks, and deliveries",
    group: "Notifications",
  },
  {
    value: "notifications:manage",
    label: "Manage Notifications",
    desc: "Full management access to alerts, webhooks, and deliveries",
    group: "Notifications",
  },
  // Status Page
  {
    value: "status-page:view",
    label: "View Status Page",
    desc: "View status page configuration, exposed services, incidents, and preview",
    group: "Status Page",
  },
  {
    value: "status-page:manage",
    label: "Manage Status Page",
    desc: "Edit status page settings and exposed services",
    group: "Status Page",
  },
  {
    value: "status-page:incidents:create",
    label: "Create Incidents",
    desc: "Create manual incidents and promote automatic incidents",
    group: "Status Page",
  },
  {
    value: "status-page:incidents:update",
    label: "Update Incidents",
    desc: "Edit incident details and post incident timeline updates",
    group: "Status Page",
  },
  {
    value: "status-page:incidents:resolve",
    label: "Resolve Incidents",
    desc: "Resolve active status page incidents",
    group: "Status Page",
  },
  {
    value: "status-page:incidents:delete",
    label: "Delete Past Incidents",
    desc: "Delete resolved status page incidents",
    group: "Status Page",
  },
  // Features
  {
    value: "feat:ai:use",
    label: "Use AI Assistant",
    desc: "Use the AI assistant",
    group: "Features",
  },
  {
    value: "feat:ai:configure",
    label: "Configure AI",
    desc: "Configure AI settings and providers",
    group: "Features",
  },
  {
    value: "mcp:use",
    label: "Use MCP",
    desc: "Allow this user account to access the remote MCP server with OAuth",
    group: "Features",
  },
  // Docker: Containers
  {
    value: "docker:containers:view",
    label: "View Containers",
    desc: "View Docker containers",
    group: "Docker: Containers",
  },
  {
    value: "docker:containers:create",
    label: "Create Containers",
    desc: "Create and duplicate containers",
    group: "Docker: Containers",
  },
  {
    value: "docker:containers:edit",
    label: "Edit Containers",
    desc: "Edit container settings and configuration",
    group: "Docker: Containers",
  },
  {
    value: "docker:containers:manage",
    label: "Manage Containers",
    desc: "Start, stop, restart, kill, and recreate containers",
    group: "Docker: Containers",
  },
  {
    value: "docker:containers:environment",
    label: "Container Environment",
    desc: "Modify container environment variables",
    group: "Docker: Containers",
  },
  {
    value: "docker:containers:delete",
    label: "Delete Containers",
    desc: "Remove containers",
    group: "Docker: Containers",
  },
  {
    value: "docker:containers:console",
    label: "Container Console",
    desc: "Open interactive console in containers",
    group: "Docker: Containers",
  },
  {
    value: "docker:containers:files",
    label: "Container Files",
    desc: "Browse and edit files in containers",
    group: "Docker: Containers",
  },
  {
    value: "docker:containers:secrets",
    label: "Container Secrets",
    desc: "View and manage encrypted secrets",
    group: "Docker: Containers",
  },
  {
    value: "docker:containers:webhooks",
    label: "Container Webhooks",
    desc: "View and manage container webhook update triggers",
    group: "Docker: Containers",
  },
  {
    value: "docker:containers:mounts",
    label: "Container Mounts",
    desc: "Add, remove, or change container and deployment mounts",
    group: "Docker: Containers",
  },
  {
    value: "docker:containers:folders:manage",
    label: "Manage Container Folders",
    desc: "Create, reorder, and remove Docker container folders",
    group: "Docker: Containers",
  },
  // Docker: Images
  {
    value: "docker:images:view",
    label: "View Images",
    desc: "View Docker images",
    group: "Docker: Images",
  },
  {
    value: "docker:images:pull",
    label: "Pull Images",
    desc: "Pull Docker images",
    group: "Docker: Images",
  },
  {
    value: "docker:images:delete",
    label: "Delete Images",
    desc: "Remove and prune Docker images",
    group: "Docker: Images",
  },
  // Docker: Volumes
  {
    value: "docker:volumes:view",
    label: "View Volumes",
    desc: "View Docker volumes",
    group: "Docker: Volumes",
  },
  {
    value: "docker:volumes:create",
    label: "Create Volumes",
    desc: "Create Docker volumes",
    group: "Docker: Volumes",
  },
  {
    value: "docker:volumes:delete",
    label: "Delete Volumes",
    desc: "Remove Docker volumes",
    group: "Docker: Volumes",
  },
  // Docker: Networks
  {
    value: "docker:networks:view",
    label: "View Networks",
    desc: "View Docker networks",
    group: "Docker: Networks",
  },
  {
    value: "docker:networks:create",
    label: "Create Networks",
    desc: "Create Docker networks",
    group: "Docker: Networks",
  },
  {
    value: "docker:networks:edit",
    label: "Edit Networks",
    desc: "Connect and disconnect containers",
    group: "Docker: Networks",
  },
  {
    value: "docker:networks:delete",
    label: "Delete Networks",
    desc: "Remove Docker networks",
    group: "Docker: Networks",
  },
  // Docker: Registries
  {
    value: "docker:registries:view",
    label: "View Registries",
    desc: "View Docker registries",
    group: "Docker: Registries",
  },
  {
    value: "docker:registries:create",
    label: "Create Registries",
    desc: "Add Docker registries",
    group: "Docker: Registries",
  },
  {
    value: "docker:registries:edit",
    label: "Edit Registries",
    desc: "Edit Docker registry settings",
    group: "Docker: Registries",
  },
  {
    value: "docker:registries:delete",
    label: "Delete Registries",
    desc: "Remove Docker registries",
    group: "Docker: Registries",
  },
  // Docker: Tasks
  {
    value: "docker:tasks",
    label: "View Tasks",
    desc: "View Docker task progress",
    group: "Docker: Tasks",
  },
  // Databases
  {
    value: "databases:view",
    label: "View Databases",
    desc: "View saved database connections",
    group: "Databases",
  },
  {
    value: "databases:create",
    label: "Create Databases",
    desc: "Create saved database connections",
    group: "Databases",
  },
  {
    value: "databases:edit",
    label: "Edit Databases",
    desc: "Edit saved database connections",
    group: "Databases",
  },
  {
    value: "databases:delete",
    label: "Delete Databases",
    desc: "Delete saved database connections",
    group: "Databases",
  },
  {
    value: "databases:query:read",
    label: "Read Database Data",
    desc: "Browse tables, keys, and run read-only database queries",
    group: "Databases",
  },
  {
    value: "databases:query:write",
    label: "Write Database Data",
    desc: "Insert, update, delete, and run write queries against databases",
    group: "Databases",
  },
  {
    value: "databases:query:admin",
    label: "Admin Database Queries",
    desc: "Run administrative or DDL database commands",
    group: "Databases",
  },
  {
    value: "databases:credentials:reveal",
    label: "Reveal Database Credentials",
    desc: "Reveal saved database credentials and connection strings",
    group: "Databases",
  },
  {
    value: "logs:environments:view",
    label: "View Logging Environments",
    desc: "View external logging environments",
    group: "Logging",
  },
  {
    value: "logs:environments:create",
    label: "Create Logging Environments",
    desc: "Create logging environments",
    group: "Logging",
  },
  {
    value: "logs:environments:edit",
    label: "Edit Logging Environments",
    desc: "Edit logging environments and schemas",
    group: "Logging",
  },
  {
    value: "logs:environments:delete",
    label: "Delete Logging Environments",
    desc: "Delete logging environments",
    group: "Logging",
  },
  {
    value: "logs:tokens:view",
    label: "View Logging Tokens",
    desc: "View logging ingest tokens",
    group: "Logging",
  },
  {
    value: "logs:tokens:create",
    label: "Create Logging Tokens",
    desc: "Create logging ingest tokens",
    group: "Logging",
  },
  {
    value: "logs:tokens:delete",
    label: "Delete Logging Tokens",
    desc: "Revoke logging ingest tokens",
    group: "Logging",
  },
  {
    value: "logs:schemas:view",
    label: "View Logging Schemas",
    desc: "View reusable logging schemas",
    group: "Logging",
  },
  {
    value: "logs:schemas:create",
    label: "Create Logging Schemas",
    desc: "Create reusable logging schemas",
    group: "Logging",
  },
  {
    value: "logs:schemas:edit",
    label: "Edit Logging Schemas",
    desc: "Edit reusable logging schemas",
    group: "Logging",
  },
  {
    value: "logs:schemas:delete",
    label: "Delete Logging Schemas",
    desc: "Delete reusable logging schemas",
    group: "Logging",
  },
  {
    value: "logs:read",
    label: "Read Logs",
    desc: "Search and inspect external logs",
    group: "Logging",
  },
  {
    value: "logs:manage",
    label: "Manage Logging",
    desc: "Full access to external logging",
    group: "Logging",
  },
] as const;

export const TOKEN_SCOPES = RAW_TOKEN_SCOPES;

const PROGRAMMATIC_DENIED_SCOPE_VALUES = new Set<string>([
  "feat:ai:use",
  "feat:ai:configure",
  "mcp:use",
  "admin:system",
  "admin:users",
  "admin:groups",
  "settings:gateway:view",
  "settings:gateway:edit",
  "proxy:raw:read",
  "proxy:raw:write",
  "proxy:raw:toggle",
  "proxy:raw:bypass",
  "proxy:advanced:bypass",
  "nodes:config:view",
  "nodes:config:edit",
]);

export const API_TOKEN_SCOPES = TOKEN_SCOPES.filter(
  (scope) => !PROGRAMMATIC_DENIED_SCOPE_VALUES.has(scope.value)
);

export const GROUP_ASSIGNABLE_SCOPES = TOKEN_SCOPES.filter(
  (scope) => scope.value !== "admin:system"
);

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
  healthCheckBodyMatchMode: "includes" | "exact" | "starts_with" | "ends_with";
  healthCheckSlowThreshold: number | null;
  healthStatus: HealthStatus;
  effectiveHealthStatus?: string;
  lastHealthCheckAt: string | null;
  healthHistory?: Array<{ ts: string; status: string; responseMs?: number; slow?: boolean }>;
  isSystem?: boolean;
  systemKind?: string | null;
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
  acmePendingOperation: "issue" | "renewal" | null;
  acmePendingChallenges: DNSChallenge[] | null;
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

// Databases
export type DatabaseType = "postgres" | "redis";
export type DatabaseHealthStatus = "online" | "offline" | "degraded" | "unknown";

export interface DatabaseHealthEntry {
  ts: string;
  status: DatabaseHealthStatus;
  responseMs?: number;
  slow?: boolean;
}

export interface PostgresDatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslEnabled: boolean;
}

export interface RedisDatabaseConfig {
  host: string;
  port: number;
  username: string | null;
  password: string;
  db: number;
  tlsEnabled: boolean;
}

export interface DatabaseConnection {
  id: string;
  name: string;
  type: DatabaseType;
  description: string | null;
  tags: string[];
  manualSizeLimitMb: number | null;
  host: string;
  port: number;
  databaseName: string | null;
  username: string | null;
  tlsEnabled: boolean;
  healthStatus: DatabaseHealthStatus;
  lastHealthCheckAt: string | null;
  lastError: string | null;
  healthHistory?: DatabaseHealthEntry[];
  hasStoredPassword: boolean;
  config: PostgresDatabaseConfig | RedisDatabaseConfig;
  createdById: string;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseMetricSnapshot {
  timestamp: string;
  databaseId: string;
  type: DatabaseType;
  name: string;
  status: DatabaseHealthStatus;
  responseMs: number;
  metrics: Record<string, number | null>;
}

export interface PostgresTableColumn {
  name: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  hasDefault: boolean;
}

export interface PostgresTableMetadata {
  schema: string;
  table: string;
  columns: PostgresTableColumn[];
  primaryKey: string[];
  hasPrimaryKey: boolean;
}

export interface RedisKeyRecord {
  key: string;
  type: string;
  ttlSeconds: number;
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
  sslCertificateId?: string | null;
  internalCertificateId?: string | null;
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
  accessListId?: string | null;
  folderId?: string | null;
  nginxTemplateId?: string | null;
  templateVariables?: Record<string, string | number | boolean>;
  healthCheckEnabled?: boolean;
  healthCheckUrl?: string;
  healthCheckInterval?: number;
  healthCheckExpectedStatus?: number;
  healthCheckExpectedBody?: string | null;
  healthCheckBodyMatchMode?: "includes" | "exact" | "starts_with" | "ends_with" | null;
  healthCheckSlowThreshold?: number;
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

// Status Page
export type StatusPageSourceType =
  | "node"
  | "proxy_host"
  | "database"
  | "docker_container"
  | "docker_deployment";
export type StatusPageServiceStatus = "operational" | "degraded" | "outage" | "unknown";
export type StatusPageIncidentSeverity = "info" | "warning" | "critical";
export type StatusPageIncidentStatus = "active" | "resolved";
export type StatusPageIncidentType = "automatic" | "manual";
export type StatusPageIncidentUpdateStatus =
  | "update"
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved";

export interface StatusPageConfig {
  enabled: boolean;
  title: string;
  description: string;
  domain: string;
  nodeId: string | null;
  sslCertificateId: string | null;
  proxyTemplateId: string | null;
  upstreamUrl: string | null;
  proxyHostId: string | null;
  publicIncidentLimit: number;
  recentIncidentDays: number;
  autoDegradedEnabled: boolean;
  autoOutageEnabled: boolean;
  autoDegradedSeverity: StatusPageIncidentSeverity;
  autoOutageSeverity: StatusPageIncidentSeverity;
  autoCreateThresholdSeconds: number;
  autoResolveThresholdSeconds: number;
}

export interface StatusPageProxyTemplateOption {
  id: string;
  name: string;
}

export interface StatusPageServiceItem {
  id: string;
  sourceType: StatusPageSourceType;
  sourceId: string;
  publicName: string;
  publicDescription: string | null;
  publicGroup: string | null;
  sortOrder: number;
  enabled: boolean;
  createThresholdSeconds: number;
  resolveThresholdSeconds: number;
  lastEvaluatedStatus: string;
  unhealthySince: string | null;
  healthySince: string | null;
  createdAt: string;
  updatedAt: string;
  source: { label: string; status: StatusPageServiceStatus; rawStatus: string } | null;
  currentStatus: StatusPageServiceStatus;
  broken: boolean;
}

export interface StatusPageIncidentUpdate {
  id: string;
  incidentId?: string;
  status: StatusPageIncidentUpdateStatus;
  message: string;
  createdAt: string;
}

export interface StatusPageIncident {
  id: string;
  title: string;
  message: string;
  severity: StatusPageIncidentSeverity;
  status: StatusPageIncidentStatus;
  type: StatusPageIncidentType;
  autoManaged: boolean;
  affectedServiceIds: string[];
  startedAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  updates: StatusPageIncidentUpdate[];
}

export interface PublicStatusPageDto {
  title: string;
  description: string;
  generatedAt: string;
  overallStatus: "operational" | "degraded" | "outage";
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    group: string | null;
    status: StatusPageServiceStatus;
    healthHistory: Array<{ ts: string; status: StatusPageServiceStatus }>;
  }>;
  incidents: Array<{
    id: string;
    title: string;
    message: string;
    severity: StatusPageIncidentSeverity;
    status: StatusPageIncidentStatus;
    type: StatusPageIncidentType;
    startedAt: string;
    resolvedAt: string | null;
    affectedServiceIds: string[];
    updates: Array<{
      id: string;
      status: StatusPageIncidentUpdateStatus;
      message: string;
      createdAt: string;
    }>;
  }>;
}

export interface DockerContainerFolder {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  depth: number;
  isSystem: boolean;
  nodeId: string | null;
  composeProject: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DockerFolderTreeNode extends DockerContainerFolder {
  children: DockerFolderTreeNode[];
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

export interface SSLCertificateOperationResult {
  certificate: SSLCertificate;
  status: "issued" | "pending_dns_verification";
  challenges?: DNSChallenge[];
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

export type LicenseTier = "community" | "homelab" | "enterprise";

export type LicenseStatus =
  | "community"
  | "valid"
  | "valid_with_warning"
  | "unreachable_grace_expired"
  | "invalid"
  | "expired"
  | "revoked"
  | "replaced";

export interface LicenseStatusView {
  status: LicenseStatus;
  tier: LicenseTier;
  licensed: boolean;
  hasKey: boolean;
  keyLast4: string | null;
  licenseName: string | null;
  installationId: string;
  installationName: string;
  expiresAt: string | null;
  lastCheckedAt: string | null;
  lastValidAt: string | null;
  graceUntil: string | null;
  activeInstallationId: string | null;
  activeInstallationName: string | null;
  errorMessage: string | null;
  serverUrl: string;
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
  portsCount?: number;
  portsTruncated?: boolean;
  labels?: Record<string, string>;
  kind?: "container" | "deployment";
  deploymentId?: string;
  activeSlot?: "blue" | "green";
  primaryRoute?: { hostPort: number; containerPort: number } | null;
  activeSlotContainerId?: string | null;
  healthCheckId?: string | null;
  healthCheckEnabled?: boolean;
  healthStatus?: "online" | "offline" | "degraded" | "unknown" | "disabled";
  lastHealthCheckAt?: string | null;
  healthHistory?: Array<{ ts: string; status: string; responseMs?: number; slow?: boolean }>;
  folderId?: string | null;
  folderIsSystem?: boolean;
  folderSortOrder?: number;
  _transition?: string;
  _listTruncated?: boolean;
  _listTotal?: number;
  _listLimit?: number;
  // Stats (from health report, optional)
  cpuPercent?: number;
  memoryUsage?: number;
  memoryLimit?: number;
  networkRx?: number;
  networkTx?: number;
}

export interface DockerHealthRouteOption {
  id: string;
  scheme: "http" | "https";
  hostPort: number;
  containerPort: number;
  label: string;
  isPrimary?: boolean;
}

export interface DockerHealthCheck {
  id: string | null;
  target: "container" | "deployment";
  nodeId: string;
  containerName: string | null;
  deploymentId: string | null;
  enabled: boolean;
  scheme: "http" | "https";
  hostPort: number | null;
  containerPort: number | null;
  path: string;
  statusMin: number;
  statusMax: number;
  expectedBody: string | null;
  bodyMatchMode: "includes" | "exact" | "starts_with" | "ends_with";
  intervalSeconds: number;
  timeoutSeconds: number;
  slowThreshold: number;
  healthStatus: "online" | "offline" | "degraded" | "unknown" | "disabled";
  lastHealthCheckAt: string | null;
  healthHistory: Array<{ ts: string; status: string; responseMs?: number; slow?: boolean }>;
  routeOptions: DockerHealthRouteOption[];
}

export interface DockerDeploymentRoute {
  id: string;
  deploymentId: string;
  hostPort: number;
  containerPort: number;
  isPrimary: boolean;
}

export interface DockerDeploymentDesiredConfig {
  image: string;
  env?: Record<string, string>;
  restartPolicy?: string;
  [key: string]: unknown;
}

export interface DockerDeploymentSlot {
  id: string;
  deploymentId: string;
  slot: "blue" | "green";
  containerId: string | null;
  containerName: string;
  image: string | null;
  desiredConfig?: DockerDeploymentDesiredConfig | null;
  status: string;
  health: string;
  drainingUntil: string | null;
  updatedAt: string;
}

export interface DockerDeploymentRelease {
  id: string;
  deploymentId: string;
  fromSlot: "blue" | "green" | null;
  toSlot: "blue" | "green" | null;
  image: string | null;
  triggerSource: string;
  taskId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface DockerDeploymentHealthConfig {
  path: string;
  statusMin: number;
  statusMax: number;
  timeoutSeconds: number;
  intervalSeconds: number;
  successThreshold: number;
  startupGraceSeconds: number;
  deployTimeoutSeconds: number;
}

export interface DockerDeployment {
  id: string;
  nodeId: string;
  name: string;
  desiredConfig: DockerDeploymentDesiredConfig;
  activeSlot: "blue" | "green";
  status: string;
  routerName: string;
  routerImage: string;
  networkName: string;
  healthConfig: DockerDeploymentHealthConfig;
  drainSeconds: number;
  routes: DockerDeploymentRoute[];
  routesCount?: number;
  routesTruncated?: boolean;
  slots: DockerDeploymentSlot[];
  releases: DockerDeploymentRelease[];
  webhook?: DockerWebhook | null;
  healthCheck?: DockerHealthCheck | null;
  _transition?: string;
  _listTruncated?: boolean;
  _listTotal?: number;
  _listLimit?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DockerImage {
  id: string;
  repoTags: string[];
  repoTagsCount?: number;
  repoTagsTruncated?: boolean;
  repoDigests?: string[];
  repoDigestsCount?: number;
  repoDigestsTruncated?: boolean;
  size: number;
  created: number;
  _listTruncated?: boolean;
  _listTotal?: number;
  _listLimit?: number;
}

export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
  labels?: Record<string, string>;
  scope: string;
  createdAt?: string;
  usedBy?: string[];
  usedByCount?: number;
  usedByTruncated?: boolean;
  _listTruncated?: boolean;
  _listTotal?: number;
  _listLimit?: number;
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  ipam?: {
    subnet?: string;
    gateway?: string;
    config?: Array<{ subnet?: string; gateway?: string }>;
  };
  containers?: Record<string, { name?: string }>;
  containersCount?: number;
  containersTruncated?: boolean;
  _listTruncated?: boolean;
  _listTotal?: number;
  _listLimit?: number;
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
  trustedAuthRealm?: string | null;
  scope: "global" | "node";
  nodeId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DockerSecret {
  id: string;
  key: string;
  value: string; // masked as "••••••••" unless user has docker:secrets scope
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
  _listTruncated?: boolean;
  _listTotal?: number;
  _listLimit?: number;
}

export interface ContainerCreateConfig {
  image: string;
  registryId?: string;
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

export interface DockerWebhook {
  id: string;
  nodeId: string;
  containerName: string;
  token: string;
  enabled: boolean;
  cleanupEnabled: boolean;
  retentionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DaemonNodeUpdateStatus {
  nodeId: string;
  hostname: string;
  currentVersion: string;
  updateAvailable: boolean;
  arch?: string;
}

export interface DaemonUpdateStatus {
  daemonType: "nginx" | "docker" | "monitoring";
  latestVersion: string | null;
  lastCheckedAt: string | null;
  nodes: DaemonNodeUpdateStatus[];
}
