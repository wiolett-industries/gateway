import type {
  CA,
  Certificate,
  CertificateStatus,
  CertificateType,
  CreateIntermediateCARequest,
  CreateRootCARequest,
  IssueCertFromCSRRequest,
  IssueCertificateRequest,
  PaginatedResponse,
  Template,
} from "@/types";
import { API_BASE } from "./api-base";
import type { ApiClientBaseConstructor } from "./api-mixins";

export function withPkiApi<TBase extends ApiClientBaseConstructor>(Base: TBase) {
  return class PkiApiClient extends Base {
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
      return this.request<PaginatedResponse<Certificate>>(
        `/certificates${query ? `?${query}` : ""}`
      );
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
  };
}
