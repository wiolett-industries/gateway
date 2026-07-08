export type IntegrationProvider = "gitlab" | "cloudflare";
export type GitLabAllowlistMode = "selected" | "all_visible";
export type GitLabAllowlistEntryType = "group" | "project";
export type IntegrationSyncStatus = "never" | "idle" | "running" | "success" | "error";

export interface GitLabConnectorSettings {
  autoSyncEnabled: boolean;
  autoSyncIntervalSeconds: number;
  cloneShallow: boolean;
  cloneDepth: number;
  cloneLfs: boolean;
  cloneSubmodules: boolean;
  cloneMaxSizeMb: number;
  cloneTimeoutSeconds: number;
}

export type GitLabConnectorCapabilities = Record<string, boolean>;
export type CloudflareConnectorCapabilities = Record<string, boolean>;

export interface GitLabAllowlistEntry {
  entryType: GitLabAllowlistEntryType;
  remoteId: string;
  fullPath: string;
  name?: string | null;
  webUrl?: string | null;
}

export interface GitLabConnector {
  id: string;
  provider: "gitlab";
  name: string;
  baseUrl: string;
  enabled: boolean;
  allowlistMode: GitLabAllowlistMode;
  settings: GitLabConnectorSettings;
  capabilities: GitLabConnectorCapabilities;
  syncStatus: IntegrationSyncStatus;
  syncLastError?: string | null;
  syncFailureCount: number;
  syncStartedAt?: string | null;
  syncFinishedAt?: string | null;
  syncLastOverlapAt?: string | null;
  syncNextRetryAt?: string | null;
  testedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  hasToken: boolean;
  tokenMasked?: string | null;
  allowlistEntries?: GitLabAllowlistEntry[];
}

export interface CloudflareConnectorSettings {
  autoSyncEnabled: boolean;
  autoSyncIntervalSeconds: number;
  defaultTtl: number;
  defaultProxied: boolean;
}

export interface CloudflareZone {
  id: string;
  connectorId: string;
  remoteId: string;
  name: string;
  status: string | null;
  accountName: string | null;
  permissions: string[];
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CloudflareConnector {
  id: string;
  provider: "cloudflare";
  name: string;
  baseUrl: string | null;
  enabled: boolean;
  settings: CloudflareConnectorSettings;
  capabilities: CloudflareConnectorCapabilities;
  syncStatus: IntegrationSyncStatus;
  syncLastError?: string | null;
  syncFailureCount: number;
  syncStartedAt?: string | null;
  syncFinishedAt?: string | null;
  syncLastOverlapAt?: string | null;
  syncNextRetryAt?: string | null;
  testedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  hasToken: boolean;
  tokenMasked?: string | null;
  zones?: CloudflareZone[];
}

export interface GitLabConnectorSyncResult {
  status: "success" | "skipped";
  reason?: string;
  projectCount?: number;
  registryCount?: number;
}

export interface CloudflareConnectorSyncResult {
  status: "success" | "skipped";
  reason?: string;
  zoneCount?: number;
}

export interface CloudflareConnectorPreviewTestRequest {
  token: string;
}

export interface CloudflareConnectorPreviewTestResult {
  capabilities: CloudflareConnectorCapabilities;
  zones: CloudflareZone[];
}

export interface CloudflareConnectorCreateRequest {
  name: string;
  enabled: boolean;
  token: string;
  settings?: Partial<CloudflareConnectorSettings>;
}

export interface CloudflareConnectorUpdateRequest {
  name?: string;
  enabled?: boolean;
  settings?: Partial<CloudflareConnectorSettings>;
}

export interface GitLabConnectorPreviewTestRequest {
  baseUrl: string;
  token: string;
}

export interface GitLabConnectorPreviewTestResult {
  capabilities: GitLabConnectorCapabilities;
  allowlistEntries: GitLabAllowlistEntry[];
}

export interface GitLabConnectorCreateRequest {
  name: string;
  baseUrl: string;
  enabled: boolean;
  token: string;
  allowlistMode: GitLabAllowlistMode;
  settings?: Partial<GitLabConnectorSettings>;
  allowlistEntries?: GitLabAllowlistEntry[];
}

export interface GitLabAllowlistPreviewSearchRequest {
  baseUrl: string;
  token: string;
  q: string;
}

export interface GitLabConnectorUpdateRequest {
  name?: string;
  baseUrl?: string;
  enabled?: boolean;
  token?: string;
  allowlistMode?: GitLabAllowlistMode;
  settings?: Partial<GitLabConnectorSettings>;
  allowlistEntries?: GitLabAllowlistEntry[];
}
