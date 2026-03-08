import { useAuthStore } from "@/stores/auth";
import type {
  Alert,
  ApiError,
  ApiToken,
  AuditLogEntry,
  CA,
  Certificate,
  CertificateStatus,
  CertificateType,
  CreateCARequest,
  DashboardStats,
  IssueCertificateRequest,
  PaginatedResponse,
  RevokeCertificateRequest,
  Template,
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

  // ── Dashboard ─────────────────────────────────────────────────────

  async getDashboardStats(): Promise<DashboardStats> {
    return this.request<DashboardStats>("/dashboard/stats");
  }

  // ── Certificate Authorities ───────────────────────────────────────

  async listCAs(): Promise<PaginatedResponse<CA>> {
    return this.request<PaginatedResponse<CA>>("/cas");
  }

  async getCA(id: string): Promise<CA> {
    return this.request<CA>(`/cas/${id}`);
  }

  async createCA(data: CreateCARequest): Promise<CA> {
    return this.request<CA>("/cas", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async revokeCA(id: string, reason: string): Promise<CA> {
    return this.request<CA>(`/cas/${id}/revoke`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  async getCAChain(id: string): Promise<{ pem: string }> {
    return this.request<{ pem: string }>(`/cas/${id}/chain`);
  }

  async getCACRL(id: string): Promise<{ crl: string }> {
    return this.request<{ crl: string }>(`/cas/${id}/crl`);
  }

  // ── Certificates ──────────────────────────────────────────────────

  async listCertificates(params?: {
    page?: number;
    limit?: number;
    search?: string;
    status?: CertificateStatus;
    type?: CertificateType;
    caId?: string;
  }): Promise<PaginatedResponse<Certificate>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.search) searchParams.set("search", params.search);
    if (params?.status) searchParams.set("status", params.status);
    if (params?.type) searchParams.set("type", params.type);
    if (params?.caId) searchParams.set("caId", params.caId);

    const query = searchParams.toString();
    return this.request<PaginatedResponse<Certificate>>(
      `/certificates${query ? `?${query}` : ""}`
    );
  }

  async getCertificate(id: string): Promise<Certificate> {
    return this.request<Certificate>(`/certificates/${id}`);
  }

  async issueCertificate(data: IssueCertificateRequest): Promise<Certificate> {
    return this.request<Certificate>("/certificates", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async revokeCertificate(id: string, data: RevokeCertificateRequest): Promise<Certificate> {
    return this.request<Certificate>(`/certificates/${id}/revoke`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async renewCertificate(id: string): Promise<Certificate> {
    return this.request<Certificate>(`/certificates/${id}/renew`, {
      method: "POST",
    });
  }

  async downloadCertificate(id: string, format: "pem" | "der" | "pkcs12"): Promise<Blob> {
    const sessionId = useAuthStore.getState().sessionId;
    const headers: HeadersInit = {};
    if (sessionId) headers.Authorization = `Bearer ${sessionId}`;

    const response = await fetch(`${API_BASE}/certificates/${id}/download?format=${format}`, {
      headers,
    });

    if (!response.ok) {
      throw new Error("Failed to download certificate");
    }

    return response.blob();
  }

  // ── Templates ─────────────────────────────────────────────────────

  async listTemplates(): Promise<{ data: Template[] }> {
    return this.request<{ data: Template[] }>("/templates");
  }

  async getTemplate(id: string): Promise<Template> {
    return this.request<Template>(`/templates/${id}`);
  }

  async createTemplate(data: Omit<Template, "id" | "createdAt" | "updatedAt">): Promise<Template> {
    return this.request<Template>("/templates", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateTemplate(
    id: string,
    data: Partial<Omit<Template, "id" | "createdAt" | "updatedAt">>
  ): Promise<Template> {
    return this.request<Template>(`/templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteTemplate(id: string): Promise<void> {
    return this.request<void>(`/templates/${id}`, {
      method: "DELETE",
    });
  }

  // ── Audit Log ─────────────────────────────────────────────────────

  async listAuditLogs(params?: {
    page?: number;
    limit?: number;
    action?: string;
    actorId?: string;
    resourceType?: string;
    from?: string;
    to?: string;
  }): Promise<PaginatedResponse<AuditLogEntry>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.action) searchParams.set("action", params.action);
    if (params?.actorId) searchParams.set("actorId", params.actorId);
    if (params?.resourceType) searchParams.set("resourceType", params.resourceType);
    if (params?.from) searchParams.set("from", params.from);
    if (params?.to) searchParams.set("to", params.to);

    const query = searchParams.toString();
    return this.request<PaginatedResponse<AuditLogEntry>>(
      `/audit${query ? `?${query}` : ""}`
    );
  }

  // ── Alerts ────────────────────────────────────────────────────────

  async listAlerts(params?: {
    acknowledged?: boolean;
    severity?: string;
  }): Promise<{ data: Alert[] }> {
    const searchParams = new URLSearchParams();
    if (params?.acknowledged !== undefined)
      searchParams.set("acknowledged", params.acknowledged.toString());
    if (params?.severity) searchParams.set("severity", params.severity);

    const query = searchParams.toString();
    return this.request<{ data: Alert[] }>(`/alerts${query ? `?${query}` : ""}`);
  }

  async acknowledgeAlert(id: string): Promise<Alert> {
    return this.request<Alert>(`/alerts/${id}/acknowledge`, {
      method: "POST",
    });
  }

  // ── API Tokens ────────────────────────────────────────────────────

  async listTokens(): Promise<{ data: ApiToken[] }> {
    return this.request<{ data: ApiToken[] }>("/tokens");
  }

  async createToken(data: {
    name: string;
    scopes: string[];
    expiresInDays?: number;
  }): Promise<{ token: ApiToken; secret: string }> {
    return this.request<{ token: ApiToken; secret: string }>("/tokens", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async revokeToken(id: string): Promise<void> {
    return this.request<void>(`/tokens/${id}`, {
      method: "DELETE",
    });
  }

  // ── Admin ─────────────────────────────────────────────────────────

  async listUsers(): Promise<{ data: User[] }> {
    return this.request<{ data: User[] }>("/admin/users");
  }

  async updateUserRole(userId: string, role: UserRole): Promise<User> {
    return this.request<User>(`/admin/users/${userId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
  }

  async deleteUser(userId: string): Promise<void> {
    return this.request<void>(`/admin/users/${userId}`, {
      method: "DELETE",
    });
  }
}

export const api = new ApiClient();
