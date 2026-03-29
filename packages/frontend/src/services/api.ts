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
  DnsStatus,
  DNSChallenge,
  Domain,
  DomainSearchResult,
  DomainWithUsage,
  FolderTreeNode,
  GroupedProxyHostsResponse,
  HealthStatus,
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
  UserRole,
} from "@/types";

const API_BASE = "/api";
const AUTH_BASE = "/auth";

class ApiClient {
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
        throw new Error("Authentication required");
      }

      if (response.status === 403) {
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
    const params = new URLSearchParams({ format });
    if (passphrase) params.set("passphrase", passphrase);
    const response = await fetch(`${API_BASE}/certificates/${id}/export?${params}`, {
      headers: this.getHeaders(),
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

  async updateUserRole(userId: string, role: UserRole): Promise<User> {
    return this.request<User>(`/admin/users/${userId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
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
      return this.unwrapData(
        this.request<{ data: NginxProcessInfo }>("/monitoring/nginx/info")
      );
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
    return this.unwrapData(
      this.request<{ data: UpdateStatus }>("/system/version")
    );
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
}

export const api = new ApiClient();
