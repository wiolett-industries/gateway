import { useAuthStore } from "@/stores/auth";
import type {
  AccessList,
  Alert,
  ApiError,
  ApiToken,
  AuditLogEntry,
  CA,
  Certificate,
  CertificateStatus,
  CertificateType,
  CreateAccessListRequest,
  CreateDomainRequest,
  CreateIntermediateCARequest,
  CreateProxyHostRequest,
  CreateRootCARequest,
  DashboardStats,
  DNSChallenge,
  DnsStatus,
  Domain,
  DomainSearchResult,
  DomainWithUsage,
  FolderTreeNode,
  GroupedProxyHostsResponse,
  HealthStatus,
  HousekeepingConfig,
  HousekeepingRunResult,
  HousekeepingStats,
  IssueCertFromCSRRequest,
  IssueCertificateRequest,
  LinkInternalCertRequest,
  NginxProcessInfo,
  NginxTemplate,
  PaginatedResponse,
  ProxyHost,
  ProxyHostFolder,
  ProxyHostType,
  RequestACMECertRequest,
  SSLCertificate,
  SSLCertStatus,
  SSLCertType,
  Template,
  TemplateVariableDef,
  UpdateDomainRequest,
  UpdateStatus,
  UploadCertRequest,
  User,
  PermissionGroup,
} from "@/types";

const API_BASE = "/api";
const AUTH_BASE = "/auth";

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
}

const DEFAULT_CACHE_TTL = 60_000; // 1 minute

class ApiClient {
  private cache = new Map<string, CacheEntry>();

  /** Get cached data if fresh enough. */
  getCached<T>(key: string, ttl = DEFAULT_CACHE_TTL): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > ttl) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  /** Store data in cache. */
  setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /** Invalidate a specific cache key or prefix. */
  invalidateCache(prefix?: string): void {
    if (!prefix) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  /**
   * Fetch with cache: returns cached data if available, fetches in background to update.
   * Returns [data, isFromCache].
   */
  async cachedRequest<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl = DEFAULT_CACHE_TTL
  ): Promise<T> {
    const cached = this.getCached<T>(key, ttl);
    // Always fetch fresh data
    const fresh = fetcher().then((data) => {
      this.setCache(key, data);
      return data;
    });
    // If we have cache, return it immediately (fresh fetch still updates cache in background)
    if (cached !== undefined) return cached;
    return fresh;
  }

  /**
   * Prefetch key data for all pages in background.
   * Called once after auth to prime the cache.
   */
  prefetchAll(isAdmin: boolean): void {
    const quiet = <T>(p: Promise<T>) => p.then((d) => d).catch(() => {});

    // Dashboard data
    quiet(this.getDashboardStats().then((d) => this.setCache("dashboard:stats", d)));
    quiet(this.getHealthOverview().then((d) => this.setCache("dashboard:health", d)));

    // CAs
    quiet(this.listCAs().then((d) => this.setCache("cas:list", d)));

    // Proxy hosts (grouped)
    quiet(this.getGroupedProxyHosts({}).then((d) => this.setCache("proxy:grouped", d)));

    // SSL Certificates
    quiet(this.listSSLCertificates({}).then((d) => this.setCache("ssl:list", d)));

    // PKI Certificates
    quiet(this.listCertificates({}).then((d) => this.setCache("certificates:list", d)));

    // Domains
    quiet(this.listDomains({}).then((d) => this.setCache("domains:list", d)));

    // Templates
    quiet(this.listTemplates().then((d) => this.setCache("templates:list", d)));

    // Access Lists
    quiet(this.listAccessLists().then((d) => this.setCache("access-lists:list", d)));

    // Nginx Templates
    quiet(this.listNginxTemplates().then((d) => this.setCache("nginx-templates:list", d)));

    // Version info
    quiet(this.getVersionInfo().then((d) => this.setCache("system:version", d)));

    if (isAdmin) {
      quiet(this.getAuditLog({ limit: 25 }).then((d) => this.setCache("audit:list", d)));
      quiet(this.listUsers().then((d) => this.setCache("admin:users", d)));
    }
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    const sessionId = useAuthStore.getState().sessionId;
    if (sessionId) {
      headers.Authorization = `Bearer ${sessionId}`;
    }

    return headers;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = endpoint.startsWith("/auth") ? endpoint : `${API_BASE}${endpoint}`;
    const method = (options.method || "GET").toUpperCase();

    // For GET requests: return cached data if fresh, refresh in background
    if (method === "GET") {
      const cacheKey = `req:${url}`;
      const cached = this.getCached<T>(cacheKey);
      if (cached !== undefined) {
        // Refresh in background
        this.fetchRaw<T>(url, options)
          .then((data) => this.setCache(cacheKey, data))
          .catch(() => {});
        return cached;
      }
      // No cache — fetch and cache
      const data = await this.fetchRaw<T>(url, options);
      this.setCache(cacheKey, data);
      return data;
    }

    // Non-GET: invalidate cached GET requests for this endpoint path
    const basePath = url.split("?")[0];
    for (const key of this.cache.keys()) {
      if (key.startsWith("req:") && key.includes(basePath.replace(/\/[^/]+$/, ""))) {
        this.cache.delete(key);
      }
    }
    return this.fetchRaw<T>(url, options);
  }

  private async fetchRaw<T>(url: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      if (response.status >= 500) {
        throw new Error("Service unavailable");
      }

      if (response.status === 401) {
        useAuthStore.getState().logout();
        window.location.href = "/login";
        throw new Error("Session expired");
      }

      if (response.status === 403) {
        const body = await response.json().catch(() => ({ message: "" }));
        if (body.message === "Account is blocked") {
          window.location.href = "/blocked";
          throw new Error("Account is blocked");
        }
        throw new Error("Insufficient permissions");
      }

      const error: ApiError = await response.json().catch(() => ({
        code: "UNKNOWN_ERROR",
        message: "An unknown error occurred",
      }));

      throw new Error(error.message);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  /**
   * Unwrap a single-resource response wrapped in `{ data: ... }` by the backend.
   */
  private unwrapData<T>(promise: Promise<{ data: T }>): Promise<T> {
    return promise.then((r) => r.data);
  }

  // ── Auth ──────────────────────────────────────────────────────────

  async getCurrentUser(): Promise<User> {
    return this.request<User>("/auth/me");
  }

  async logout(): Promise<void> {
    await this.request<void>("/auth/logout", { method: "POST" });
    useAuthStore.getState().logout();
  }

  getLoginUrl(): string {
    return `${AUTH_BASE}/login`;
  }

  // ── Certificate Authorities ───────────────────────────────────────

  async listCAs(): Promise<CA[]> {
    return this.request<CA[]>("/cas");
  }

  async getCA(id: string): Promise<CA> {
    return this.request<CA>(`/cas/${id}`);
  }

  async createRootCA(data: CreateRootCARequest): Promise<CA> {
    return this.request<CA>("/cas", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async createIntermediateCA(parentId: string, data: CreateIntermediateCARequest): Promise<CA> {
    return this.request<CA>(`/cas/${parentId}/intermediate`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateCA(
    id: string,
    data: {
      crlDistributionUrl?: string | null;
      ocspResponderUrl?: string | null;
      caIssuersUrl?: string | null;
      maxValidityDays?: number;
    }
  ): Promise<CA> {
    return this.request<CA>(`/cas/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async revokeCA(id: string, reason: string): Promise<void> {
    return this.request<void>(`/cas/${id}/revoke`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  async deleteCA(id: string): Promise<void> {
    return this.request<void>(`/cas/${id}`, { method: "DELETE" });
  }

  async exportCAKey(id: string, passphrase: string): Promise<Blob> {
    const response = await fetch(`${API_BASE}/cas/${id}/export-key`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ passphrase }),
    });
    if (!response.ok) throw new Error("Failed to export CA key");
    return response.blob();
  }

  async generateOCSPResponder(id: string): Promise<void> {
    return this.request<void>(`/cas/${id}/ocsp-responder`, { method: "POST" });
  }

  // ── Certificates ──────────────────────────────────────────────────

  async listCertificates(params?: {
    page?: number;
    limit?: number;
    search?: string;
    status?: CertificateStatus;
    type?: CertificateType;
    caId?: string;
    sortBy?: string;
    sortOrder?: string;
  }): Promise<PaginatedResponse<Certificate>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.search) searchParams.set("search", params.search);
    if (params?.status) searchParams.set("status", params.status);
    if (params?.type) searchParams.set("type", params.type);
    if (params?.caId) searchParams.set("caId", params.caId);
    if (params?.sortBy) searchParams.set("sortBy", params.sortBy);
    if (params?.sortOrder) searchParams.set("sortOrder", params.sortOrder);

    const query = searchParams.toString();
    return this.request<PaginatedResponse<Certificate>>(`/certificates${query ? `?${query}` : ""}`);
  }

  async getCertificate(id: string): Promise<Certificate> {
    return this.request<Certificate>(`/certificates/${id}`);
  }

  async issueCertificate(
    data: IssueCertificateRequest
  ): Promise<{ certificate: Certificate; privateKeyPem: string }> {
    return this.request(`/certificates`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async issueCertificateFromCSR(data: IssueCertFromCSRRequest): Promise<Certificate> {
    return this.request<Certificate>(`/certificates/from-csr`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async revokeCertificate(id: string, reason: string): Promise<void> {
    return this.request<void>(`/certificates/${id}/revoke`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  async exportCertificate(id: string, format: string, passphrase?: string): Promise<Blob> {
    const body: Record<string, string> = { format };
    if (passphrase) body.passphrase = passphrase;
    const response = await fetch(`${API_BASE}/certificates/${id}/export`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Failed to export certificate");
    return response.blob();
  }

  async downloadChain(id: string): Promise<Blob> {
    const response = await fetch(`${API_BASE}/certificates/${id}/chain`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error("Failed to download chain");
    return response.blob();
  }

  // ── Templates ─────────────────────────────────────────────────────

  async listTemplates(): Promise<Template[]> {
    return this.request<Template[]>("/templates");
  }

  async getTemplate(id: string): Promise<Template> {
    return this.request<Template>(`/templates/${id}`);
  }

  async createTemplate(data: Partial<Template>): Promise<Template> {
    return this.request<Template>("/templates", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateTemplate(id: string, data: Partial<Template>): Promise<Template> {
    return this.request<Template>(`/templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteTemplate(id: string): Promise<void> {
    return this.request<void>(`/templates/${id}`, { method: "DELETE" });
  }

  // ── Audit ─────────────────────────────────────────────────────────

  async getAuditLog(params?: {
    page?: number;
    limit?: number;
    action?: string;
    resourceType?: string;
  }): Promise<PaginatedResponse<AuditLogEntry>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.action) searchParams.set("action", params.action);
    if (params?.resourceType) searchParams.set("resourceType", params.resourceType);

    const query = searchParams.toString();
    return this.request<PaginatedResponse<AuditLogEntry>>(`/audit${query ? `?${query}` : ""}`);
  }

  // ── Alerts ────────────────────────────────────────────────────────

  async getAlerts(): Promise<Alert[]> {
    return this.request<Alert[]>("/alerts");
  }

  async dismissAlert(id: string): Promise<void> {
    return this.request<void>(`/alerts/${id}/dismiss`, { method: "POST" });
  }

  // ── Tokens ────────────────────────────────────────────────────────

  async listTokens(): Promise<ApiToken[]> {
    return this.request<ApiToken[]>("/tokens");
  }

  async createToken(data: {
    name: string;
    scopes: string[];
  }): Promise<ApiToken & { token: string }> {
    return this.request(`/tokens`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async revokeToken(id: string): Promise<void> {
    return this.request<void>(`/tokens/${id}`, { method: "DELETE" });
  }

  // ── Admin ─────────────────────────────────────────────────────────

  async listUsers(): Promise<User[]> {
    return this.request<User[]>("/admin/users");
  }

  async updateUserGroup(userId: string, groupId: string): Promise<User> {
    return this.request<User>(`/admin/users/${userId}/group`, {
      method: "PATCH",
      body: JSON.stringify({ groupId }),
    });
  }

  async blockUser(userId: string, blocked: boolean): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/admin/users/${userId}/block`, {
      method: "PATCH",
      body: JSON.stringify({ blocked }),
    });
  }

  async deleteUser(userId: string): Promise<void> {
    await this.request(`/admin/users/${userId}`, { method: "DELETE" });
  }

  // ── Permission Groups ──

  async listGroups(): Promise<PermissionGroup[]> {
    return this.request<PermissionGroup[]>("/admin/groups");
  }

  async getGroup(id: string): Promise<PermissionGroup> {
    return this.request<PermissionGroup>(`/admin/groups/${id}`);
  }

  async createGroup(data: {
    name: string;
    description?: string;
    scopes: string[];
  }): Promise<PermissionGroup> {
    return this.request<PermissionGroup>("/admin/groups", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateGroup(
    id: string,
    data: { name?: string; description?: string | null; scopes?: string[] }
  ): Promise<PermissionGroup> {
    return this.request<PermissionGroup>(`/admin/groups/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteGroup(id: string): Promise<void> {
    await this.request(`/admin/groups/${id}`, { method: "DELETE" });
  }

  // ── AI Assistant ──

  async getAIStatus(): Promise<{ enabled: boolean }> {
    return this.request<{ enabled: boolean }>("/ai/status");
  }

  async getAIConfig(): Promise<Record<string, unknown>> {
    const res = await this.request<{ data: Record<string, unknown> }>("/ai/config");
    return res.data;
  }

  async updateAIConfig(config: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this.request<{ data: Record<string, unknown> }>("/ai/config", {
      method: "PUT",
      body: JSON.stringify(config),
    });
    return res.data;
  }

  async getAITools(): Promise<
    Record<
      string,
      Array<{ name: string; description: string; destructive: boolean; requiredRole: string }>
    >
  > {
    const res = await this.request<{
      data: Record<
        string,
        Array<{ name: string; description: string; destructive: boolean; requiredRole: string }>
      >;
    }>("/ai/tools");
    return res.data;
  }

  // ── Proxy Hosts ──────────────────────────────────────────────────

  async listProxyHosts(params?: {
    page?: number;
    limit?: number;
    search?: string;
    type?: ProxyHostType;
    healthStatus?: HealthStatus;
    enabled?: boolean;
    sortBy?: string;
    sortOrder?: string;
  }): Promise<PaginatedResponse<ProxyHost>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.search) searchParams.set("search", params.search);
    if (params?.type) searchParams.set("type", params.type);
    if (params?.healthStatus) searchParams.set("healthStatus", params.healthStatus);
    if (params?.enabled !== undefined) searchParams.set("enabled", params.enabled.toString());
    if (params?.sortBy) searchParams.set("sortBy", params.sortBy);
    if (params?.sortOrder) searchParams.set("sortOrder", params.sortOrder);

    const query = searchParams.toString();
    return this.request<PaginatedResponse<ProxyHost>>(`/proxy-hosts${query ? `?${query}` : ""}`);
  }

  async getProxyHost(id: string): Promise<ProxyHost> {
    return this.unwrapData(this.request<{ data: ProxyHost }>(`/proxy-hosts/${id}`));
  }

  async createProxyHost(data: CreateProxyHostRequest): Promise<ProxyHost> {
    return this.unwrapData(
      this.request<{ data: ProxyHost }>("/proxy-hosts", {
        method: "POST",
        body: JSON.stringify(data),
      })
    );
  }

  async updateProxyHost(id: string, data: Partial<CreateProxyHostRequest>): Promise<ProxyHost> {
    return this.unwrapData(
      this.request<{ data: ProxyHost }>(`/proxy-hosts/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      })
    );
  }

  async deleteProxyHost(id: string): Promise<void> {
    return this.request<void>(`/proxy-hosts/${id}`, { method: "DELETE" });
  }

  async toggleProxyHost(id: string, enabled: boolean): Promise<ProxyHost> {
    return this.unwrapData(
      this.request<{ data: ProxyHost }>(`/proxy-hosts/${id}/toggle`, {
        method: "POST",
        body: JSON.stringify({ enabled }),
      })
    );
  }

  async getRenderedProxyConfig(id: string): Promise<{ rendered: string }> {
    return this.unwrapData(
      this.request<{ data: { rendered: string } }>(`/proxy-hosts/${id}/rendered-config`)
    );
  }

  async validateProxyConfig(snippet: string): Promise<{ valid: boolean; errors: string[] }> {
    return this.unwrapData(
      this.request<{ data: { valid: boolean; errors: string[] } }>("/proxy-hosts/validate-config", {
        method: "POST",
        body: JSON.stringify({ snippet }),
      })
    );
  }

  // ── Proxy Host Folders ─────────────────────────────────────────

  async listFolders(): Promise<FolderTreeNode[]> {
    return this.unwrapData(this.request<{ data: FolderTreeNode[] }>("/proxy-host-folders"));
  }

  async getGroupedProxyHosts(params?: {
    search?: string;
    type?: ProxyHostType;
    healthStatus?: HealthStatus;
    enabled?: boolean;
  }): Promise<GroupedProxyHostsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set("search", params.search);
    if (params?.type) searchParams.set("type", params.type);
    if (params?.healthStatus) searchParams.set("healthStatus", params.healthStatus);
    if (params?.enabled !== undefined) searchParams.set("enabled", params.enabled.toString());
    const query = searchParams.toString();
    return this.unwrapData(
      this.request<{ data: GroupedProxyHostsResponse }>(
        `/proxy-host-folders/grouped${query ? `?${query}` : ""}`
      )
    );
  }

  async createFolder(data: { name: string; parentId?: string }): Promise<ProxyHostFolder> {
    return this.unwrapData(
      this.request<{ data: ProxyHostFolder }>("/proxy-host-folders", {
        method: "POST",
        body: JSON.stringify(data),
      })
    );
  }

  async updateFolder(id: string, data: { name: string }): Promise<ProxyHostFolder> {
    return this.unwrapData(
      this.request<{ data: ProxyHostFolder }>(`/proxy-host-folders/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      })
    );
  }

  async moveFolder(id: string, parentId: string | null): Promise<ProxyHostFolder> {
    return this.unwrapData(
      this.request<{ data: ProxyHostFolder }>(`/proxy-host-folders/${id}/move`, {
        method: "PUT",
        body: JSON.stringify({ parentId }),
      })
    );
  }

  async deleteFolder(id: string): Promise<void> {
    return this.request<void>(`/proxy-host-folders/${id}`, { method: "DELETE" });
  }

  async reorderFolders(items: { id: string; sortOrder: number }[]): Promise<void> {
    return this.request<void>("/proxy-host-folders/reorder", {
      method: "PUT",
      body: JSON.stringify({ items }),
    });
  }

  async reorderHosts(items: { id: string; sortOrder: number }[]): Promise<void> {
    return this.request<void>("/proxy-host-folders/reorder-hosts", {
      method: "PUT",
      body: JSON.stringify({ items }),
    });
  }

  async moveHostsToFolder(hostIds: string[], folderId: string | null): Promise<void> {
    return this.request<void>("/proxy-host-folders/move-hosts", {
      method: "POST",
      body: JSON.stringify({ hostIds, folderId }),
    });
  }

  // ── Nginx Config Templates ─────────────────────────────────────

  async listNginxTemplates(): Promise<NginxTemplate[]> {
    return this.unwrapData(this.request<{ data: NginxTemplate[] }>("/nginx-templates"));
  }

  async getNginxTemplate(id: string): Promise<NginxTemplate> {
    return this.unwrapData(this.request<{ data: NginxTemplate }>(`/nginx-templates/${id}`));
  }

  async createNginxTemplate(data: {
    name: string;
    description?: string;
    type: string;
    content: string;
    variables?: TemplateVariableDef[];
  }): Promise<NginxTemplate> {
    return this.unwrapData(
      this.request<{ data: NginxTemplate }>("/nginx-templates", {
        method: "POST",
        body: JSON.stringify(data),
      })
    );
  }

  async updateNginxTemplate(
    id: string,
    data: {
      name?: string;
      description?: string | null;
      content?: string;
      variables?: TemplateVariableDef[];
    }
  ): Promise<NginxTemplate> {
    return this.unwrapData(
      this.request<{ data: NginxTemplate }>(`/nginx-templates/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      })
    );
  }

  async deleteNginxTemplate(id: string): Promise<void> {
    return this.request<void>(`/nginx-templates/${id}`, { method: "DELETE" });
  }

  async cloneNginxTemplate(id: string): Promise<NginxTemplate> {
    return this.unwrapData(
      this.request<{ data: NginxTemplate }>(`/nginx-templates/${id}/clone`, {
        method: "POST",
      })
    );
  }

  async previewNginxTemplate(content: string, hostId?: string): Promise<{ rendered: string }> {
    return this.unwrapData(
      this.request<{ data: { rendered: string } }>("/nginx-templates/preview", {
        method: "POST",
        body: JSON.stringify({ content, hostId }),
      })
    );
  }

  async testNginxTemplate(
    content: string
  ): Promise<{ rendered: string; valid: boolean; errors: string[] }> {
    return this.unwrapData(
      this.request<{ data: { rendered: string; valid: boolean; errors: string[] } }>(
        "/nginx-templates/test",
        {
          method: "POST",
          body: JSON.stringify({ content }),
        }
      )
    );
  }

  // ── SSL Certificates ───────────────────────────────────────────

  async listSSLCertificates(params?: {
    page?: number;
    limit?: number;
    search?: string;
    type?: SSLCertType;
    status?: SSLCertStatus;
    sortBy?: string;
    sortOrder?: string;
  }): Promise<PaginatedResponse<SSLCertificate>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.search) searchParams.set("search", params.search);
    if (params?.type) searchParams.set("type", params.type);
    if (params?.status) searchParams.set("status", params.status);
    if (params?.sortBy) searchParams.set("sortBy", params.sortBy);
    if (params?.sortOrder) searchParams.set("sortOrder", params.sortOrder);

    const query = searchParams.toString();
    return this.request<PaginatedResponse<SSLCertificate>>(
      `/ssl-certificates${query ? `?${query}` : ""}`
    );
  }

  async getSSLCertificate(id: string): Promise<SSLCertificate> {
    return this.unwrapData(this.request<{ data: SSLCertificate }>(`/ssl-certificates/${id}`));
  }

  async requestACMECert(
    data: RequestACMECertRequest
  ): Promise<SSLCertificate | { challenges: DNSChallenge[] }> {
    return this.unwrapData(
      this.request<{ data: SSLCertificate | { challenges: DNSChallenge[] } }>(
        "/ssl-certificates/acme",
        {
          method: "POST",
          body: JSON.stringify(data),
        }
      )
    );
  }

  async uploadCert(data: UploadCertRequest): Promise<SSLCertificate> {
    return this.unwrapData(
      this.request<{ data: SSLCertificate }>("/ssl-certificates/upload", {
        method: "POST",
        body: JSON.stringify(data),
      })
    );
  }

  async linkInternalCert(data: LinkInternalCertRequest): Promise<SSLCertificate> {
    return this.unwrapData(
      this.request<{ data: SSLCertificate }>("/ssl-certificates/internal", {
        method: "POST",
        body: JSON.stringify(data),
      })
    );
  }

  async renewSSLCert(id: string): Promise<SSLCertificate> {
    return this.unwrapData(
      this.request<{ data: SSLCertificate }>(`/ssl-certificates/${id}/renew`, { method: "POST" })
    );
  }

  async completeDNSVerify(id: string): Promise<SSLCertificate> {
    return this.unwrapData(
      this.request<{ data: SSLCertificate }>(`/ssl-certificates/${id}/dns-verify`, {
        method: "POST",
      })
    );
  }

  async deleteSSLCert(id: string): Promise<void> {
    return this.request<void>(`/ssl-certificates/${id}`, { method: "DELETE" });
  }

  // ── Access Lists ───────────────────────────────────────────────

  async listAccessLists(params?: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<PaginatedResponse<AccessList>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.search) searchParams.set("search", params.search);

    const query = searchParams.toString();
    return this.request<PaginatedResponse<AccessList>>(`/access-lists${query ? `?${query}` : ""}`);
  }

  async getAccessList(id: string): Promise<AccessList> {
    return this.unwrapData(this.request<{ data: AccessList }>(`/access-lists/${id}`));
  }

  async createAccessList(data: CreateAccessListRequest): Promise<AccessList> {
    return this.unwrapData(
      this.request<{ data: AccessList }>("/access-lists", {
        method: "POST",
        body: JSON.stringify(data),
      })
    );
  }

  async updateAccessList(id: string, data: Partial<CreateAccessListRequest>): Promise<AccessList> {
    return this.unwrapData(
      this.request<{ data: AccessList }>(`/access-lists/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      })
    );
  }

  async deleteAccessList(id: string): Promise<void> {
    return this.request<void>(`/access-lists/${id}`, { method: "DELETE" });
  }

  // ── Monitoring ─────────────────────────────────────────────────

  async getDashboardStats(): Promise<DashboardStats> {
    return this.unwrapData(this.request<{ data: DashboardStats }>("/monitoring/dashboard"));
  }

  async getHealthOverview(): Promise<ProxyHost[]> {
    return this.unwrapData(this.request<{ data: ProxyHost[] }>("/monitoring/health-status"));
  }

  // ── SSE (Live Logs) ────────────────────────────────────────────

  createLogStream(hostId: string): EventSource {
    const sessionId = useAuthStore.getState().sessionId;
    const params = new URLSearchParams();
    if (sessionId) params.set("token", sessionId);
    return new EventSource(`${API_BASE}/monitoring/logs/${hostId}/stream?${params}`);
  }

  // ── Domains ────────────────────────────────────────────────────

  async listDomains(params?: {
    page?: number;
    limit?: number;
    search?: string;
    dnsStatus?: DnsStatus;
  }): Promise<PaginatedResponse<Domain>> {
    const sp = new URLSearchParams();
    if (params?.page) sp.set("page", params.page.toString());
    if (params?.limit) sp.set("limit", params.limit.toString());
    if (params?.search) sp.set("search", params.search);
    if (params?.dnsStatus) sp.set("dnsStatus", params.dnsStatus);
    const q = sp.toString();
    return this.request<PaginatedResponse<Domain>>(`/domains${q ? `?${q}` : ""}`);
  }

  async getDomain(id: string): Promise<DomainWithUsage> {
    return this.unwrapData(this.request<{ data: DomainWithUsage }>(`/domains/${id}`));
  }

  async createDomain(data: CreateDomainRequest): Promise<Domain> {
    return this.unwrapData(
      this.request<{ data: Domain }>("/domains", {
        method: "POST",
        body: JSON.stringify(data),
      })
    );
  }

  async updateDomain(id: string, data: UpdateDomainRequest): Promise<Domain> {
    return this.unwrapData(
      this.request<{ data: Domain }>(`/domains/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      })
    );
  }

  async deleteDomain(id: string): Promise<void> {
    await this.request<void>(`/domains/${id}`, { method: "DELETE" });
  }

  async checkDomainDns(id: string): Promise<Domain> {
    return this.unwrapData(
      this.request<{ data: Domain }>(`/domains/${id}/check-dns`, { method: "POST" })
    );
  }

  async issueDomainCert(id: string): Promise<SSLCertificate> {
    return this.unwrapData(
      this.request<{ data: SSLCertificate }>(`/domains/${id}/issue-cert`, { method: "POST" })
    );
  }

  async searchDomains(q: string): Promise<DomainSearchResult[]> {
    return this.unwrapData(
      this.request<{ data: DomainSearchResult[] }>(`/domains/search?q=${encodeURIComponent(q)}`)
    );
  }

  // ── Nginx Management ──────────────────────────────────────────

  async checkNginxAvailable(): Promise<boolean> {
    try {
      const result = await this.unwrapData(
        this.request<{ data: { available: boolean } }>("/monitoring/nginx/available")
      );
      return result.available;
    } catch {
      return false;
    }
  }

  async getNginxInfo(): Promise<NginxProcessInfo | null> {
    try {
      return this.unwrapData(this.request<{ data: NginxProcessInfo }>("/monitoring/nginx/info"));
    } catch {
      return null;
    }
  }

  async getNginxConfig(): Promise<string> {
    const result = await this.unwrapData(
      this.request<{ data: { content: string } }>("/monitoring/nginx/config")
    );
    return result.content;
  }

  async updateNginxConfig(content: string): Promise<{ valid: boolean; error?: string }> {
    return this.unwrapData(
      this.request<{ data: { valid: boolean; error?: string } }>("/monitoring/nginx/config", {
        method: "PUT",
        body: JSON.stringify({ content }),
      })
    );
  }

  async testNginxConfig(): Promise<{ valid: boolean; error?: string }> {
    return this.unwrapData(
      this.request<{ data: { valid: boolean; error?: string } }>("/monitoring/nginx/config/test", {
        method: "POST",
      })
    );
  }

  createNginxStatsStream(): EventSource {
    const sessionId = useAuthStore.getState().sessionId;
    const params = new URLSearchParams();
    if (sessionId) params.set("token", sessionId);
    return new EventSource(`${API_BASE}/monitoring/nginx/stats/stream?${params}`);
  }

  // ── System / Updates ──────────────────────────────────��───────────

  async getVersionInfo(): Promise<UpdateStatus> {
    return this.unwrapData(this.request<{ data: UpdateStatus }>("/system/version"));
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    return this.unwrapData(
      this.request<{ data: UpdateStatus }>("/system/check-update", { method: "POST" })
    );
  }

  async triggerUpdate(version: string): Promise<{ status: string; targetVersion: string }> {
    return this.unwrapData(
      this.request<{ data: { status: string; targetVersion: string } }>("/system/update", {
        method: "POST",
        body: JSON.stringify({ version }),
      })
    );
  }

  async getReleaseNotes(version: string): Promise<string> {
    const result = await this.unwrapData(
      this.request<{ data: { version: string; notes: string } }>(
        `/system/release-notes/${encodeURIComponent(version)}`
      )
    );
    return result.notes;
  }

  async getAllReleaseNotes(): Promise<{ version: string; notes: string }[]> {
    return this.unwrapData(
      this.request<{ data: { version: string; notes: string }[] }>("/system/release-notes")
    );
  }

  // ── Housekeeping ────────────────────────────────────────────────

  async getHousekeepingConfig(): Promise<HousekeepingConfig> {
    return this.unwrapData(this.request<{ data: HousekeepingConfig }>("/housekeeping/config"));
  }

  async updateHousekeepingConfig(config: Partial<HousekeepingConfig>): Promise<HousekeepingConfig> {
    return this.unwrapData(
      this.request<{ data: HousekeepingConfig }>("/housekeeping/config", {
        method: "PUT",
        body: JSON.stringify(config),
      })
    );
  }

  async getHousekeepingStats(): Promise<HousekeepingStats> {
    return this.unwrapData(this.request<{ data: HousekeepingStats }>("/housekeeping/stats"));
  }

  async runHousekeeping(): Promise<HousekeepingRunResult> {
    return this.unwrapData(
      this.request<{ data: HousekeepingRunResult }>("/housekeeping/run", { method: "POST" })
    );
  }

  async getHousekeepingHistory(): Promise<HousekeepingRunResult[]> {
    return this.unwrapData(
      this.request<{ data: HousekeepingRunResult[] }>("/housekeeping/history")
    );
  }
}

export const api = new ApiClient();
