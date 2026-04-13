import { useAuthStore } from "@/stores/auth";
import { useUIStore } from "@/stores/ui";
import type {
  AccessList,
  Alert,
  ApiToken,
  AuditLogEntry,
  CA,
  Certificate,
  CertificateStatus,
  CertificateType,
  ContainerCreateConfig,
  CreateAccessListRequest,
  CreateDomainRequest,
  CreateIntermediateCARequest,
  CreateProxyHostRequest,
  CreateRootCARequest,
  DashboardStats,
  DNSChallenge,
  DnsStatus,
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerRegistry,
  DockerSecret,
  DaemonUpdateStatus,
  DockerWebhook,
  DockerTask,
  DockerTemplate,
  DockerVolume,
  Domain,
  DomainSearchResult,
  DomainWithUsage,
  FileEntry,
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
  PermissionGroup,
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
} from "@/types";
import { ApiClientBase, API_BASE } from "./api-base";

const AUTH_BASE = "/auth";

class ApiClient extends ApiClientBase {
  /**
   * Prefetch key data for all pages in background.
   * Called once after auth to prime the cache.
   */
  prefetchAll(isAdmin: boolean): void {
    const quiet = <T>(p: Promise<T>) => p.then((d) => d).catch(() => {});
    const showSystem =
      useUIStore.getState().showSystemCertificates &&
      useAuthStore.getState().hasScope("admin:details:certificates");

    // Dashboard data
    quiet(
      this.getDashboardStats(showSystem).then((d) =>
        this.setCache(`dashboard:stats:${showSystem ? "system" : "default"}`, d)
      )
    );
    quiet(this.getHealthOverview().then((d) => this.setCache("dashboard:health", d)));

    // CAs
    quiet(
      this.listCAs({ showSystem }).then((d) =>
        this.setCache(`cas:list:${showSystem ? "system" : "default"}`, d)
      )
    );

    // Proxy hosts (grouped)
    quiet(this.getGroupedProxyHosts({}).then((d) => this.setCache("proxy:grouped", d)));

    // SSL Certificates
    quiet(
      this.listSSLCertificates({ showSystem }).then((d) =>
        this.setCache(`ssl:list:${showSystem ? "system" : "default"}`, d)
      )
    );

    // PKI Certificates
    quiet(
      this.listCertificates({ showSystem }).then((d) =>
        this.setCache(`certificates:list:${showSystem ? "system" : "default"}`, d)
      )
    );

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

  async listCAs(params?: { showSystem?: boolean }): Promise<CA[]> {
    return this.request<CA[]>(`/cas${params?.showSystem ? "?showSystem=true" : ""}`);
  }

  async getCA(id: string, params?: { showSystem?: boolean }): Promise<CA> {
    return this.request<CA>(`/cas/${id}${params?.showSystem ? "?showSystem=true" : ""}`);
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
    showSystem?: boolean;
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
    if (params?.showSystem) searchParams.set("showSystem", "true");
    searchParams.set("meta", "v2");

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

  async renameToken(id: string, name: string): Promise<void> {
    return this.request<void>(`/tokens/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
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
    parentId?: string | null;
  }): Promise<PermissionGroup> {
    return this.request<PermissionGroup>("/admin/groups", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateGroup(
    id: string,
    data: {
      name?: string;
      description?: string | null;
      scopes?: string[];
      parentId?: string | null;
    }
  ): Promise<PermissionGroup> {
    return this.request<PermissionGroup>(`/admin/groups/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteGroup(id: string): Promise<void> {
    await this.request(`/admin/groups/${id}`, { method: "DELETE" });
  }

  // ── Nodes ──

  async listNodes(params?: {
    search?: string;
    type?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    data: import("@/types").Node[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const query = new URLSearchParams();
    if (params?.search) query.set("search", params.search);
    if (params?.type) query.set("type", params.type);
    if (params?.status) query.set("status", params.status);
    if (params?.page) query.set("page", String(params.page));
    if (params?.limit) query.set("limit", String(params.limit));
    const qs = query.toString();
    return this.request(`/nodes${qs ? `?${qs}` : ""}`);
  }

  async getNode(id: string): Promise<import("@/types").NodeDetail> {
    return this.unwrapData(this.request(`/nodes/${id}`));
  }

  async createNode(data: {
    type?: string;
    hostname: string;
    displayName?: string;
  }): Promise<import("@/types").CreateNodeResponse> {
    return this.unwrapData(
      this.request("/nodes", {
        method: "POST",
        body: JSON.stringify(data),
      })
    );
  }

  async updateNode(id: string, data: { displayName?: string }): Promise<import("@/types").Node> {
    return this.unwrapData(
      this.request(`/nodes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      })
    );
  }

  async deleteNode(id: string): Promise<void> {
    await this.request(`/nodes/${id}`, { method: "DELETE" });
  }

  createNodeMonitoringStream(nodeId: string): EventSource {
    const sessionId = useAuthStore.getState().sessionId;
    const params = new URLSearchParams();
    if (sessionId) params.set("token", sessionId);
    return new EventSource(`${API_BASE}/nodes/${nodeId}/monitoring/stream?${params}`);
  }

  async getNodeNginxConfig(nodeId: string): Promise<string> {
    const result = await this.unwrapData(
      this.request<{ data: { content: string } }>(`/nodes/${nodeId}/config`)
    );
    return result.content;
  }

  async updateNodeNginxConfig(
    nodeId: string,
    content: string
  ): Promise<{ valid: boolean; error?: string }> {
    return this.unwrapData(
      this.request<{ data: { valid: boolean; error?: string } }>(`/nodes/${nodeId}/config`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      })
    );
  }

  async testNodeNginxConfig(
    nodeId: string,
    content?: string
  ): Promise<{ valid: boolean; error?: string }> {
    return this.unwrapData(
      this.request<{ data: { valid: boolean; error?: string } }>(`/nodes/${nodeId}/config/test`, {
        method: "POST",
        body: content ? JSON.stringify({ content }) : undefined,
      })
    );
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
    nodeId?: string;
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
    if (params?.nodeId) searchParams.set("nodeId", params.nodeId);

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

  async validateProxyConfig(
    snippet: string,
    mode: "advanced" | "raw" = "advanced"
  ): Promise<{ valid: boolean; errors: string[] }> {
    return this.unwrapData(
      this.request<{ data: { valid: boolean; errors: string[] } }>("/proxy-hosts/validate-config", {
        method: "POST",
        body: JSON.stringify({ snippet, mode }),
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
    showSystem?: boolean;
  }): Promise<PaginatedResponse<SSLCertificate>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.search) searchParams.set("search", params.search);
    if (params?.type) searchParams.set("type", params.type);
    if (params?.status) searchParams.set("status", params.status);
    if (params?.sortBy) searchParams.set("sortBy", params.sortBy);
    if (params?.sortOrder) searchParams.set("sortOrder", params.sortOrder);
    if (params?.showSystem) searchParams.set("showSystem", "true");

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

  async getDashboardStats(showSystem?: boolean): Promise<DashboardStats> {
    return this.unwrapData(
      this.request<{ data: DashboardStats }>(
        `/monitoring/dashboard${showSystem ? "?showSystem=true" : ""}`
      )
    );
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

  // ── System / Updates ──────────────────────────────────────────────

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

  // ── Daemon Updates ──────────────────────────────────────────────

  async getDaemonUpdates(): Promise<DaemonUpdateStatus[]> {
    return this.unwrapData(
      this.request<{ data: DaemonUpdateStatus[] }>("/system/daemon-updates"),
    );
  }

  async checkDaemonUpdates(): Promise<DaemonUpdateStatus[]> {
    return this.unwrapData(
      this.request<{ data: DaemonUpdateStatus[] }>("/system/daemon-updates/check", {
        method: "POST",
      }),
    );
  }

  async triggerDaemonUpdate(
    nodeId: string,
  ): Promise<{ scheduled: boolean; targetVersion: string }> {
    return this.unwrapData(
      this.request<{ data: { scheduled: boolean; targetVersion: string } }>(
        `/system/daemon-updates/${nodeId}`,
        { method: "POST" },
      ),
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

  // ── Docker Containers ─────────────────────────────────────────────

  async listDockerContainers(nodeId: string, noCache = false): Promise<DockerContainer[]> {
    const url = noCache
      ? `/docker/nodes/${nodeId}/containers?_t=${Date.now()}`
      : `/docker/nodes/${nodeId}/containers`;
    return this.unwrapData(this.request<{ data: DockerContainer[] }>(url));
  }

  async inspectContainer(nodeId: string, containerId: string): Promise<Record<string, unknown>> {
    return this.unwrapData(
      this.request<{ data: Record<string, unknown> }>(
        `/docker/nodes/${nodeId}/containers/${containerId}`
      )
    );
  }

  async createContainer(
    nodeId: string,
    config: ContainerCreateConfig
  ): Promise<Record<string, unknown>> {
    return this.unwrapData(
      this.request<{ data: Record<string, unknown> }>(`/docker/nodes/${nodeId}/containers`, {
        method: "POST",
        body: JSON.stringify(config),
      })
    );
  }

  async startContainer(nodeId: string, containerId: string): Promise<void> {
    await this.request<void>(`/docker/nodes/${nodeId}/containers/${containerId}/start`, {
      method: "POST",
    });
  }

  async stopContainer(nodeId: string, containerId: string, timeout = 30): Promise<void> {
    await this.request<void>(`/docker/nodes/${nodeId}/containers/${containerId}/stop`, {
      method: "POST",
      body: JSON.stringify({ timeout }),
    });
  }

  async restartContainer(nodeId: string, containerId: string, timeout = 30): Promise<void> {
    await this.request<void>(`/docker/nodes/${nodeId}/containers/${containerId}/restart`, {
      method: "POST",
      body: JSON.stringify({ timeout }),
    });
  }

  async killContainer(nodeId: string, containerId: string, signal = "SIGKILL"): Promise<void> {
    await this.request<void>(`/docker/nodes/${nodeId}/containers/${containerId}/kill`, {
      method: "POST",
      body: JSON.stringify({ signal }),
    });
  }

  async removeContainer(nodeId: string, containerId: string, force = false): Promise<void> {
    await this.request<void>(`/docker/nodes/${nodeId}/containers/${containerId}`, {
      method: "DELETE",
      body: JSON.stringify({ force }),
    });
  }

  async renameContainer(nodeId: string, containerId: string, name: string): Promise<void> {
    await this.request<void>(`/docker/nodes/${nodeId}/containers/${containerId}/rename`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  async duplicateContainer(
    nodeId: string,
    containerId: string,
    name: string
  ): Promise<Record<string, unknown>> {
    return this.unwrapData(
      this.request<{ data: Record<string, unknown> }>(
        `/docker/nodes/${nodeId}/containers/${containerId}/duplicate`,
        { method: "POST", body: JSON.stringify({ name }) }
      )
    );
  }

  async updateContainer(
    nodeId: string,
    containerId: string,
    config: { tag?: string; env?: Record<string, string>; removeEnv?: string[] }
  ): Promise<Record<string, unknown>> {
    return this.unwrapData(
      this.request<{ data: Record<string, unknown> }>(
        `/docker/nodes/${nodeId}/containers/${containerId}/update`,
        { method: "POST", body: JSON.stringify(config) }
      )
    );
  }

  async getContainerLogs(
    nodeId: string,
    containerId: string,
    params?: { tail?: number; timestamps?: boolean }
  ): Promise<string[]> {
    const qs = new URLSearchParams();
    if (params?.tail) qs.set("tail", String(params.tail));
    if (params?.timestamps) qs.set("timestamps", "true");
    const query = qs.toString();
    return this.unwrapData(
      this.request<{ data: string[] }>(
        `/docker/nodes/${nodeId}/containers/${containerId}/logs${query ? `?${query}` : ""}`
      )
    );
  }

  async getContainerStats(nodeId: string, containerId: string): Promise<Record<string, unknown>> {
    return this.unwrapData(
      this.request<{ data: Record<string, unknown> }>(
        `/docker/nodes/${nodeId}/containers/${containerId}/stats`
      )
    );
  }

  async getContainerTop(
    nodeId: string,
    containerId: string
  ): Promise<{ Titles: string[]; Processes: string[][] }> {
    return this.unwrapData(
      this.request<{ data: { Titles: string[]; Processes: string[][] } }>(
        `/docker/nodes/${nodeId}/containers/${containerId}/top`
      )
    );
  }

  async getContainerStatsHistory(
    nodeId: string,
    containerId: string
  ): Promise<Record<string, unknown>[]> {
    return this.unwrapData(
      this.request<{ data: Record<string, unknown>[] }>(
        `/docker/nodes/${nodeId}/containers/${containerId}/stats/history`
      )
    );
  }

  async getContainerEnv(nodeId: string, containerId: string): Promise<string[]> {
    return this.unwrapData(
      this.request<{ data: string[] }>(`/docker/nodes/${nodeId}/containers/${containerId}/env`)
    );
  }

  async updateContainerEnv(
    nodeId: string,
    containerId: string,
    env: Record<string, string>,
    removeEnv?: string[]
  ): Promise<Record<string, unknown>> {
    return this.unwrapData(
      this.request<{ data: Record<string, unknown> }>(
        `/docker/nodes/${nodeId}/containers/${containerId}/env`,
        { method: "PUT", body: JSON.stringify({ env, removeEnv }) }
      )
    );
  }

  async liveUpdateContainer(
    nodeId: string,
    containerId: string,
    config: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.unwrapData(
      this.request<{ data: Record<string, unknown> }>(
        `/docker/nodes/${nodeId}/containers/${containerId}/live-update`,
        { method: "POST", body: JSON.stringify(config) }
      )
    );
  }

  async recreateWithConfig(
    nodeId: string,
    containerId: string,
    config: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.unwrapData(
      this.request<{ data: Record<string, unknown> }>(
        `/docker/nodes/${nodeId}/containers/${containerId}/recreate`,
        { method: "POST", body: JSON.stringify(config) }
      )
    );
  }

  // ── Docker Secrets ────────────────────────────────────────────────

  async listDockerSecrets(nodeId: string, containerId: string): Promise<DockerSecret[]> {
    return this.unwrapData(
      this.request<{ data: DockerSecret[] }>(
        `/docker/nodes/${nodeId}/containers/${containerId}/secrets`
      )
    );
  }

  async createDockerSecret(
    nodeId: string,
    containerId: string,
    key: string,
    value: string
  ): Promise<DockerSecret> {
    return this.unwrapData(
      this.request<{ data: DockerSecret }>(
        `/docker/nodes/${nodeId}/containers/${containerId}/secrets`,
        {
          method: "POST",
          body: JSON.stringify({ key, value }),
        }
      )
    );
  }

  async updateDockerSecret(
    nodeId: string,
    containerId: string,
    secretId: string,
    value: string
  ): Promise<DockerSecret> {
    return this.unwrapData(
      this.request<{ data: DockerSecret }>(
        `/docker/nodes/${nodeId}/containers/${containerId}/secrets/${secretId}`,
        {
          method: "PUT",
          body: JSON.stringify({ value }),
        }
      )
    );
  }

  async deleteDockerSecret(nodeId: string, containerId: string, secretId: string): Promise<void> {
    await this.request(`/docker/nodes/${nodeId}/containers/${containerId}/secrets/${secretId}`, {
      method: "DELETE",
    });
  }

  // ── Docker Images ─────────────────────────────────────────────────

  async listDockerImages(nodeId: string): Promise<DockerImage[]> {
    return this.unwrapData(this.request<{ data: DockerImage[] }>(`/docker/nodes/${nodeId}/images`));
  }

  async pullImage(
    nodeId: string,
    imageRef: string,
    registryId?: string
  ): Promise<Record<string, unknown>> {
    return this.unwrapData(
      this.request<{ data: Record<string, unknown> }>(`/docker/nodes/${nodeId}/images/pull`, {
        method: "POST",
        body: JSON.stringify({ imageRef, registryId }),
      })
    );
  }

  async removeImage(nodeId: string, imageId: string): Promise<void> {
    await this.request<void>(`/docker/nodes/${nodeId}/images/${encodeURIComponent(imageId)}`, {
      method: "DELETE",
    });
  }

  async pruneImages(nodeId: string): Promise<Record<string, unknown>> {
    return this.unwrapData(
      this.request<{ data: Record<string, unknown> }>(`/docker/nodes/${nodeId}/images/prune`, {
        method: "POST",
      })
    );
  }

  // ── Docker Volumes ────────────────────────────────────────────────

  async listDockerVolumes(nodeId: string): Promise<DockerVolume[]> {
    return this.unwrapData(
      this.request<{ data: DockerVolume[] }>(`/docker/nodes/${nodeId}/volumes`)
    );
  }

  async createVolume(
    nodeId: string,
    config: { name: string; driver?: string; labels?: Record<string, string> }
  ): Promise<Record<string, unknown>> {
    return this.unwrapData(
      this.request<{ data: Record<string, unknown> }>(`/docker/nodes/${nodeId}/volumes`, {
        method: "POST",
        body: JSON.stringify(config),
      })
    );
  }

  async removeVolume(nodeId: string, name: string): Promise<void> {
    await this.request<void>(`/docker/nodes/${nodeId}/volumes/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  // ── Docker Networks ───────────────────────────────────────────────

  async listDockerNetworks(nodeId: string): Promise<DockerNetwork[]> {
    return this.unwrapData(
      this.request<{ data: DockerNetwork[] }>(`/docker/nodes/${nodeId}/networks`)
    );
  }

  async createNetwork(
    nodeId: string,
    config: { name: string; driver?: string; subnet?: string; gateway?: string }
  ): Promise<Record<string, unknown>> {
    return this.unwrapData(
      this.request<{ data: Record<string, unknown> }>(`/docker/nodes/${nodeId}/networks`, {
        method: "POST",
        body: JSON.stringify(config),
      })
    );
  }

  async removeNetwork(nodeId: string, networkId: string): Promise<void> {
    await this.request<void>(`/docker/nodes/${nodeId}/networks/${networkId}`, { method: "DELETE" });
  }

  async connectContainerToNetwork(
    nodeId: string,
    networkId: string,
    containerId: string
  ): Promise<void> {
    await this.request<void>(`/docker/nodes/${nodeId}/networks/${networkId}/connect`, {
      method: "POST",
      body: JSON.stringify({ containerId }),
    });
  }

  async disconnectContainerFromNetwork(
    nodeId: string,
    networkId: string,
    containerId: string
  ): Promise<void> {
    await this.request<void>(`/docker/nodes/${nodeId}/networks/${networkId}/disconnect`, {
      method: "POST",
      body: JSON.stringify({ containerId }),
    });
  }

  // ── Docker File Browser ───────────────────────────────────────────

  async listContainerDir(nodeId: string, containerId: string, path: string): Promise<FileEntry[]> {
    return this.unwrapData(
      this.request<{ data: FileEntry[] }>(
        `/docker/nodes/${nodeId}/containers/${containerId}/files?path=${encodeURIComponent(path)}`
      )
    );
  }

  async readContainerFile(nodeId: string, containerId: string, path: string): Promise<string> {
    return this.unwrapData(
      this.request<{ data: string }>(
        `/docker/nodes/${nodeId}/containers/${containerId}/files/read?path=${encodeURIComponent(path)}`
      )
    );
  }

  async writeContainerFile(nodeId: string, containerId: string, path: string, content: string) {
    return this.unwrapData(
      this.request<{ data: unknown }>(
        `/docker/nodes/${nodeId}/containers/${containerId}/files/write`,
        { method: "PUT", body: JSON.stringify({ path, content }) }
      )
    );
  }

  // ── Docker Registries ─────────────────────────────────────────────

  async listDockerRegistries(): Promise<DockerRegistry[]> {
    return this.unwrapData(this.request<{ data: DockerRegistry[] }>("/docker/registries"));
  }

  async createRegistry(config: {
    name: string;
    url: string;
    username?: string;
    password?: string;
    scope?: string;
    nodeId?: string;
  }): Promise<DockerRegistry> {
    return this.unwrapData(
      this.request<{ data: DockerRegistry }>("/docker/registries", {
        method: "POST",
        body: JSON.stringify(config),
      })
    );
  }

  async updateRegistry(
    id: string,
    config: Partial<{
      name: string;
      url: string;
      username?: string;
      password?: string;
      scope?: string;
      nodeId?: string;
    }>
  ): Promise<DockerRegistry> {
    return this.unwrapData(
      this.request<{ data: DockerRegistry }>(`/docker/registries/${id}`, {
        method: "PUT",
        body: JSON.stringify(config),
      })
    );
  }

  async deleteRegistry(id: string): Promise<void> {
    await this.request<void>(`/docker/registries/${id}`, { method: "DELETE" });
  }

  async testRegistry(id: string): Promise<{ ok: boolean; error?: string }> {
    const result = await this.unwrapData(
      this.request<{
        data: { success?: boolean; ok?: boolean; error?: string; statusText?: string };
      }>(`/docker/registries/${id}/test`, { method: "POST" })
    );
    return { ok: result.success ?? result.ok ?? false, error: result.error || result.statusText };
  }

  async testRegistryDirect(creds: {
    url: string;
    username?: string;
    password?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const result = await this.unwrapData(
      this.request<{ data: { success?: boolean; error?: string; statusText?: string } }>(
        `/docker/registries/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(creds),
        }
      )
    );
    return { ok: result.success ?? false, error: result.error || result.statusText };
  }

  // ── Docker Templates ──────────────────────────────────────────────

  async listDockerTemplates(): Promise<DockerTemplate[]> {
    return this.unwrapData(this.request<{ data: DockerTemplate[] }>("/docker/templates"));
  }

  async createDockerTemplate(config: {
    name: string;
    description?: string;
    config: object;
  }): Promise<DockerTemplate> {
    return this.unwrapData(
      this.request<{ data: DockerTemplate }>("/docker/templates", {
        method: "POST",
        body: JSON.stringify(config),
      })
    );
  }

  async updateDockerTemplate(
    id: string,
    config: Partial<{ name: string; description?: string; config: object }>
  ): Promise<DockerTemplate> {
    return this.unwrapData(
      this.request<{ data: DockerTemplate }>(`/docker/templates/${id}`, {
        method: "PUT",
        body: JSON.stringify(config),
      })
    );
  }

  async deleteDockerTemplate(id: string): Promise<void> {
    await this.request<void>(`/docker/templates/${id}`, { method: "DELETE" });
  }

  async deployTemplate(
    id: string,
    config: { nodeId: string; overrides?: object }
  ): Promise<Record<string, unknown>> {
    return this.unwrapData(
      this.request<{ data: Record<string, unknown> }>(`/docker/templates/${id}/deploy`, {
        method: "POST",
        body: JSON.stringify(config),
      })
    );
  }

  // ── Docker Tasks ──────────────────────────────────────────────────

  async listDockerTasks(params?: {
    nodeId?: string;
    status?: string;
    type?: string;
  }): Promise<DockerTask[]> {
    const qs = new URLSearchParams();
    if (params?.nodeId) qs.set("nodeId", params.nodeId);
    if (params?.status) qs.set("status", params.status);
    if (params?.type) qs.set("type", params.type);
    const query = qs.toString();
    return this.unwrapData(
      this.request<{ data: DockerTask[] }>(`/docker/tasks${query ? `?${query}` : ""}`)
    );
  }

  async getDockerTask(id: string): Promise<DockerTask> {
    return this.unwrapData(this.request<{ data: DockerTask }>(`/docker/tasks/${id}`));
  }

  // ── Docker Exec WebSocket ─────────────────────────────────────────

  createExecWebSocket(nodeId: string, containerId: string, shell = "/bin/sh"): WebSocket {
    const sessionId = useAuthStore.getState().sessionId;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/docker/nodes/${nodeId}/containers/${containerId}/exec?token=${sessionId}&shell=${encodeURIComponent(shell)}`;
    return new WebSocket(url);
  }

  // ── Node Console WebSocket ─────────────────────────────────────

  createNodeExecWebSocket(nodeId: string, shell = "auto"): WebSocket {
    const sessionId = useAuthStore.getState().sessionId;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/nodes/${nodeId}/exec?token=${sessionId}&shell=${encodeURIComponent(shell)}`;
    return new WebSocket(url);
  }

  // ── Docker Webhooks ────────────────────────────────────────────

  async getContainerWebhook(
    nodeId: string,
    containerName: string,
  ): Promise<DockerWebhook | null> {
    const result = await this.request<{ data: DockerWebhook | null }>(
      `/docker/nodes/${nodeId}/containers/${encodeURIComponent(containerName)}/webhook`,
    );
    return result.data;
  }

  async upsertContainerWebhook(
    nodeId: string,
    containerName: string,
    input: { cleanupEnabled?: boolean; retentionCount?: number },
  ): Promise<DockerWebhook> {
    return this.unwrapData(
      this.request<{ data: DockerWebhook }>(
        `/docker/nodes/${nodeId}/containers/${encodeURIComponent(containerName)}/webhook`,
        { method: "PUT", body: JSON.stringify(input) },
      ),
    );
  }

  async deleteContainerWebhook(
    nodeId: string,
    containerName: string,
  ): Promise<void> {
    await this.request<void>(
      `/docker/nodes/${nodeId}/containers/${encodeURIComponent(containerName)}/webhook`,
      { method: "DELETE" },
    );
  }

  async regenerateWebhookToken(
    nodeId: string,
    containerName: string,
  ): Promise<DockerWebhook> {
    return this.unwrapData(
      this.request<{ data: DockerWebhook }>(
        `/docker/nodes/${nodeId}/containers/${encodeURIComponent(containerName)}/webhook/regenerate`,
        { method: "POST" },
      ),
    );
  }

  async pullImageSync(
    nodeId: string,
    imageRef: string,
    registryId?: string,
  ): Promise<{ success: boolean; imageRef: string }> {
    return this.unwrapData(
      this.request<{ data: { success: boolean; imageRef: string } }>(
        `/docker/nodes/${nodeId}/images/pull-sync`,
        { method: "POST", body: JSON.stringify({ imageRef, registryId }) },
      ),
    );
  }

  // ── Docker Log Stream WebSocket ─────────────────────────────────

  createLogStreamWebSocket(nodeId: string, containerId: string, tail = 100): WebSocket {
    const sessionId = useAuthStore.getState().sessionId;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/docker/nodes/${nodeId}/containers/${containerId}/logs/stream?token=${sessionId}&tail=${tail}`;
    return new WebSocket(url);
  }
  // ── Notification Alert Rules ──────────────────────────────────────

  async listAlertRules(params?: {
    page?: number;
    limit?: number;
    type?: string;
    enabled?: boolean;
    search?: string;
  }): Promise<{
    data: import("@/types").AlertRule[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.type) query.set("type", params.type);
    if (params?.enabled !== undefined) query.set("enabled", String(params.enabled));
    if (params?.search) query.set("search", params.search);
    const qs = query.toString();
    return this.request(`/notifications/alert-rules${qs ? `?${qs}` : ""}`);
  }

  async getAlertCategories(): Promise<import("@/types").AlertCategoryDef[]> {
    return this.unwrapData(this.request("/notifications/alert-rules/categories"));
  }

  async createAlertRule(
    data: Omit<import("@/types").AlertRule, "id" | "createdAt" | "updatedAt" | "isBuiltin">,
  ): Promise<import("@/types").AlertRule> {
    return this.unwrapData(
      this.request("/notifications/alert-rules", { method: "POST", body: JSON.stringify(data) }),
    );
  }

  async updateAlertRule(
    id: string,
    data: Partial<Omit<import("@/types").AlertRule, "id" | "createdAt" | "updatedAt" | "isBuiltin">>,
  ): Promise<import("@/types").AlertRule> {
    return this.unwrapData(
      this.request(`/notifications/alert-rules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    );
  }

  async deleteAlertRule(id: string): Promise<void> {
    await this.request(`/notifications/alert-rules/${id}`, { method: "DELETE" });
  }

  // ── Notification Webhooks ───────────────────────────────────────

  async listWebhooks(params?: {
    page?: number;
    limit?: number;
    enabled?: boolean;
    search?: string;
  }): Promise<{
    data: import("@/types").NotificationWebhook[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.enabled !== undefined) query.set("enabled", String(params.enabled));
    if (params?.search) query.set("search", params.search);
    const qs = query.toString();
    return this.request(`/notifications/webhooks${qs ? `?${qs}` : ""}`);
  }

  async getWebhookPresets(): Promise<import("@/types").WebhookPreset[]> {
    return this.unwrapData(this.request("/notifications/webhooks/presets"));
  }

  async createWebhook(
    data: Omit<import("@/types").NotificationWebhook, "id" | "createdAt" | "updatedAt">,
  ): Promise<import("@/types").NotificationWebhook> {
    return this.unwrapData(
      this.request("/notifications/webhooks", { method: "POST", body: JSON.stringify(data) }),
    );
  }

  async updateWebhook(
    id: string,
    data: Partial<Omit<import("@/types").NotificationWebhook, "id" | "createdAt" | "updatedAt">>,
  ): Promise<import("@/types").NotificationWebhook> {
    return this.unwrapData(
      this.request(`/notifications/webhooks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    );
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.request(`/notifications/webhooks/${id}`, { method: "DELETE" });
  }

  async testWebhook(id: string): Promise<{ success: boolean; statusCode?: number; error?: string; rendered?: string }> {
    return this.unwrapData(
      this.request(`/notifications/webhooks/${id}/test`, { method: "POST" }),
    );
  }

  async previewWebhookTemplate(bodyTemplate: string): Promise<{ rendered: string; context: Record<string, unknown> }> {
    return this.unwrapData(
      this.request("/notifications/webhooks/preview", {
        method: "POST",
        body: JSON.stringify({ bodyTemplate }),
      }),
    );
  }

  // ── Notification Deliveries ─────────────────────────────────────

  async listDeliveries(params?: {
    page?: number;
    limit?: number;
    webhookId?: string;
    status?: string;
    eventType?: string;
  }): Promise<{
    data: import("@/types").WebhookDelivery[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.webhookId) query.set("webhookId", params.webhookId);
    if (params?.status) query.set("status", params.status);
    if (params?.eventType) query.set("eventType", params.eventType);
    const qs = query.toString();
    return this.request(`/notifications/deliveries${qs ? `?${qs}` : ""}`);
  }

  async getDeliveryStats(webhookId?: string): Promise<{ total: number; success: number; failed: number; retrying: number }> {
    const qs = webhookId ? `?webhookId=${webhookId}` : "";
    return this.unwrapData(this.request(`/notifications/deliveries/stats${qs}`));
  }
}

export const api = new ApiClient();
