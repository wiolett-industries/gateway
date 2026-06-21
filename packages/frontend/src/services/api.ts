import { useAuthStore } from "@/stores/auth";
import { useUIStore } from "@/stores/ui";
import type {
  AccessList,
  Alert,
  ApiToken,
  AuditLogEntry,
  AuthProvisioningSettings,
  CA,
  Certificate,
  CertificateStatus,
  CertificateType,
  CreateAccessListRequest,
  CreateDomainRequest,
  CreateIntermediateCARequest,
  CreateRootCARequest,
  DashboardStats,
  DnsStatus,
  Domain,
  DomainSearchResult,
  DomainWithUsage,
  IssueCertFromCSRRequest,
  IssueCertificateRequest,
  LinkInternalCertRequest,
  NginxTemplate,
  PaginatedResponse,
  PermissionGroup,
  ProxyHost,
  ProxyHostFolder,
  PublicStatusPageDto,
  RequestACMECertRequest,
  SSLCertificate,
  SSLCertificateOperationResult,
  SSLCertStatus,
  SSLCertType,
  StatusPageConfig,
  StatusPageIncident,
  StatusPageIncidentUpdate,
  StatusPageIncidentUpdateStatus,
  StatusPageProxyTemplateOption,
  StatusPageServiceItem,
  StatusPageSourceType,
  Template,
  TemplateVariableDef,
  UpdateDomainRequest,
  UploadCertRequest,
  User,
} from "@/types";
import { withAuthApi } from "./api-auth";
import { API_BASE, ApiClientBase } from "./api-base";
import { withDatabaseApi } from "./api-databases";
import { withDockerApi } from "./api-docker";
import { withLoggingApi } from "./api-logging";
import { withNotificationApi } from "./api-notifications";
import { withProxyApi } from "./api-proxy";
import { withSystemApi } from "./api-system";

class ApiClient extends withLoggingApi(
  withNotificationApi(
    withAuthApi(withSystemApi(withDockerApi(withDatabaseApi(withProxyApi(ApiClientBase)))))
  )
) {
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
    if (useAuthStore.getState().hasScope("domains:view")) {
      quiet(this.listDomains({}).then((d) => this.setCache("domains:list", d)));
    }

    // Templates
    if (useAuthStore.getState().hasScope("pki:templates:view")) {
      quiet(this.listTemplates().then((d) => this.setCache("templates:list", d)));
    }

    // Access Lists
    quiet(this.listAccessLists().then((d) => this.setCache("access-lists:list", d)));

    // Nginx Templates
    if (useAuthStore.getState().hasScopedAccess("proxy:templates:view")) {
      quiet(this.listNginxTemplates().then((d) => this.setCache("nginx-templates:list", d)));
    }

    // Version info
    quiet(this.getVersionInfo().then((d) => this.setCache("system:version", d)));

    if (isAdmin) {
      quiet(this.getAuditLog({ limit: 25 }).then((d) => this.setCache("audit:list", d)));
      quiet(this.listUsers().then((d) => this.setCache("admin:users", d)));
    }
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
    actions?: string[];
    resourceType?: string;
    resourceTypes?: string[];
    userId?: string;
    userIds?: string[];
    from?: string;
    to?: string;
    excludedActions?: string[];
    excludedResourceTypes?: string[];
  }): Promise<PaginatedResponse<AuditLogEntry>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.action) searchParams.set("action", params.action);
    for (const action of params?.actions ?? []) searchParams.append("action", action);
    if (params?.resourceType) searchParams.set("resourceType", params.resourceType);
    for (const resourceType of params?.resourceTypes ?? []) {
      searchParams.append("resourceType", resourceType);
    }
    if (params?.userId) searchParams.set("userId", params.userId);
    for (const userId of params?.userIds ?? []) searchParams.append("userId", userId);
    if (params?.from) searchParams.set("from", params.from);
    if (params?.to) searchParams.set("to", params.to);
    for (const action of params?.excludedActions ?? [])
      searchParams.append("excludeAction", action);
    for (const resourceType of params?.excludedResourceTypes ?? []) {
      searchParams.append("excludeResourceType", resourceType);
    }

    const query = searchParams.toString();
    return this.request<PaginatedResponse<AuditLogEntry>>(`/audit${query ? `?${query}` : ""}`);
  }

  async getAuditUsers(): Promise<
    Array<{ userId: string | null; userName: string | null; userEmail: string | null }>
  > {
    return this.unwrapData(
      this.request<{
        data: Array<{ userId: string | null; userName: string | null; userEmail: string | null }>;
      }>("/audit/users")
    );
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
    return this.updateToken(id, { name });
  }

  async updateToken(id: string, data: { name?: string; scopes?: string[] }): Promise<void> {
    return this.request<void>(`/tokens/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
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

  async createUser(data: { email: string; name?: string; groupId: string }): Promise<User> {
    return this.request<User>("/admin/users", {
      method: "POST",
      body: JSON.stringify(data),
    });
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

  async getAuthProvisioningSettings(): Promise<AuthProvisioningSettings> {
    return this.request<AuthProvisioningSettings>("/admin/auth-settings");
  }

  async updateAuthProvisioningSettings(data: {
    oidcAutoCreateUsers?: boolean;
    oidcDefaultGroupId?: string;
    oidcRequireVerifiedEmail?: boolean;
    oauthExtendedCallbackCompatibility?: boolean;
    mcpServerEnabled?: boolean;
    networkSecurity?: Partial<AuthProvisioningSettings["networkSecurity"]>;
    outboundWebhookPolicy?: Partial<AuthProvisioningSettings["outboundWebhookPolicy"]>;
  }): Promise<AuthProvisioningSettings> {
    return this.request<AuthProvisioningSettings>("/admin/auth-settings", {
      method: "PUT",
      body: JSON.stringify(data),
    });
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

  async getNodeHealthHistory(id: string): Promise<Array<{ ts: string; status: string }>> {
    return this.unwrapData(this.request(`/nodes/${id}/health-history`));
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

  async setNodeServiceCreationLock(
    id: string,
    serviceCreationLocked: boolean
  ): Promise<import("@/types").NodeDetail> {
    return this.unwrapData(
      this.request(`/nodes/${id}/service-creation-lock`, {
        method: "PATCH",
        body: JSON.stringify({ serviceCreationLocked }),
      })
    );
  }

  async deleteNode(id: string): Promise<void> {
    await this.request(`/nodes/${id}`, { method: "DELETE" });
  }

  createNodeMonitoringStream(nodeId: string): EventSource {
    return new EventSource(`${API_BASE}/nodes/${nodeId}/monitoring/stream`, {
      withCredentials: true,
    });
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

  // ── Status Page ─────────────────────────────────────────────────

  async getStatusPageSettings(): Promise<StatusPageConfig> {
    return this.unwrapData(this.request<{ data: StatusPageConfig }>("/status-page/settings"));
  }

  async updateStatusPageSettings(data: Partial<StatusPageConfig>): Promise<StatusPageConfig> {
    return this.unwrapData(
      this.request<{ data: StatusPageConfig }>("/status-page/settings", {
        method: "PUT",
        body: JSON.stringify(data),
      })
    );
  }

  async listStatusPageProxyTemplates(): Promise<StatusPageProxyTemplateOption[]> {
    return this.unwrapData(
      this.request<{ data: StatusPageProxyTemplateOption[] }>("/status-page/proxy-templates")
    );
  }

  async listStatusPageServices(): Promise<StatusPageServiceItem[]> {
    return this.unwrapData(
      this.request<{ data: StatusPageServiceItem[] }>("/status-page/services")
    );
  }

  async createStatusPageService(data: {
    sourceType: StatusPageSourceType;
    sourceId: string;
    publicName: string;
    publicDescription?: string | null;
    publicGroup?: string | null;
    sortOrder?: number;
    enabled?: boolean;
    createThresholdSeconds?: number;
    resolveThresholdSeconds?: number;
  }): Promise<StatusPageServiceItem> {
    return this.unwrapData(
      this.request<{ data: StatusPageServiceItem }>("/status-page/services", {
        method: "POST",
        body: JSON.stringify(data),
      })
    );
  }

  async updateStatusPageService(
    id: string,
    data: Partial<Omit<StatusPageServiceItem, "id" | "sourceType" | "sourceId">>
  ): Promise<StatusPageServiceItem> {
    return this.unwrapData(
      this.request<{ data: StatusPageServiceItem }>(`/status-page/services/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      })
    );
  }

  async deleteStatusPageService(id: string): Promise<void> {
    await this.request<void>(`/status-page/services/${id}`, { method: "DELETE" });
  }

  async listStatusPageIncidents(params?: {
    status?: "active" | "resolved" | "all";
    limit?: number;
  }): Promise<StatusPageIncident[]> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    const query = searchParams.toString();
    return this.unwrapData(
      this.request<{ data: StatusPageIncident[] }>(
        `/status-page/incidents${query ? `?${query}` : ""}`
      )
    );
  }

  async createStatusPageIncident(data: {
    title: string;
    message: string;
    severity: "info" | "warning" | "critical";
    affectedServiceIds: string[];
  }): Promise<StatusPageIncident> {
    return this.unwrapData(
      this.request<{ data: StatusPageIncident }>("/status-page/incidents", {
        method: "POST",
        body: JSON.stringify(data),
      })
    );
  }

  async updateStatusPageIncident(
    id: string,
    data: Partial<
      Pick<
        StatusPageIncident,
        "title" | "message" | "severity" | "affectedServiceIds" | "status" | "autoManaged"
      >
    >
  ): Promise<StatusPageIncident> {
    return this.unwrapData(
      this.request<{ data: StatusPageIncident }>(`/status-page/incidents/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      })
    );
  }

  async deleteStatusPageIncident(id: string): Promise<void> {
    await this.request<void>(`/status-page/incidents/${id}`, { method: "DELETE" });
  }

  async resolveStatusPageIncident(id: string): Promise<StatusPageIncident> {
    return this.unwrapData(
      this.request<{ data: StatusPageIncident }>(`/status-page/incidents/${id}/resolve`, {
        method: "POST",
      })
    );
  }

  async promoteStatusPageIncident(id: string): Promise<StatusPageIncident> {
    return this.unwrapData(
      this.request<{ data: StatusPageIncident }>(`/status-page/incidents/${id}/promote`, {
        method: "POST",
      })
    );
  }

  async createStatusPageIncidentUpdate(
    id: string,
    data: { message: string; status?: StatusPageIncidentUpdateStatus }
  ): Promise<StatusPageIncidentUpdate> {
    const update = await this.unwrapData(
      this.request<{ data: StatusPageIncidentUpdate }>(`/status-page/incidents/${id}/updates`, {
        method: "POST",
        body: JSON.stringify(data),
      })
    );
    this.invalidateCache("req:/api/status-page/incidents");
    return update;
  }

  async getStatusPagePreview(): Promise<PublicStatusPageDto> {
    return this.unwrapData(this.request<{ data: PublicStatusPageDto }>("/status-page/preview"));
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

  async requestACMECert(data: RequestACMECertRequest): Promise<SSLCertificateOperationResult> {
    return this.unwrapData(
      this.request<{ data: SSLCertificateOperationResult }>("/ssl-certificates/acme", {
        method: "POST",
        body: JSON.stringify(data),
      })
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

  async renewSSLCert(id: string): Promise<SSLCertificate | SSLCertificateOperationResult> {
    return this.unwrapData(
      this.request<{ data: SSLCertificate | SSLCertificateOperationResult }>(
        `/ssl-certificates/${id}/renew`,
        { method: "POST" }
      )
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
    return new EventSource(`${API_BASE}/monitoring/logs/${hostId}/stream`, {
      withCredentials: true,
    });
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
}

export const api = new ApiClient();
