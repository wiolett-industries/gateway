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
  CreateRootCARequest,
  CreateIntermediateCARequest,
  IssueCertificateRequest,
  IssueCertFromCSRRequest,
  PaginatedResponse,
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
    return this.request<PaginatedResponse<Certificate>>(
      `/certificates${query ? `?${query}` : ""}`
    );
  }

  async getCertificate(id: string): Promise<Certificate> {
    return this.request<Certificate>(`/certificates/${id}`);
  }

  async issueCertificate(data: IssueCertificateRequest): Promise<{ certificate: Certificate; privateKeyPem: string }> {
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
    return this.request<PaginatedResponse<AuditLogEntry>>(
      `/audit${query ? `?${query}` : ""}`
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

  async createToken(data: { name: string; scopes: string[] }): Promise<ApiToken & { token: string }> {
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
}

export const api = new ApiClient();
