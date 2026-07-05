import type {
  GitLabAllowlistEntry,
  GitLabAllowlistPreviewSearchRequest,
  GitLabConnector,
  GitLabConnectorCreateRequest,
  GitLabConnectorPreviewTestRequest,
  GitLabConnectorPreviewTestResult,
  GitLabConnectorSyncResult,
  GitLabConnectorUpdateRequest,
} from "@/types/integrations";
import type { ApiClientBaseConstructor } from "./api-mixins";

export function withIntegrationsApi<TBase extends ApiClientBaseConstructor>(Base: TBase) {
  return class IntegrationsApi extends Base {
    async listGitLabConnectors(params?: { enabled?: boolean }): Promise<GitLabConnector[]> {
      const searchParams = new URLSearchParams();
      if (params?.enabled !== undefined) searchParams.set("enabled", String(params.enabled));
      const query = searchParams.toString();
      return this.unwrapData(
        this.request<{ data: GitLabConnector[] }>(
          `/integrations/gitlab/connectors${query ? `?${query}` : ""}`
        )
      );
    }

    async getGitLabConnector(id: string): Promise<GitLabConnector> {
      return this.unwrapData(
        this.request<{ data: GitLabConnector }>(`/integrations/gitlab/connectors/${id}`)
      );
    }

    async createGitLabConnector(data: GitLabConnectorCreateRequest): Promise<GitLabConnector> {
      return this.unwrapData(
        this.request<{ data: GitLabConnector }>("/integrations/gitlab/connectors", {
          method: "POST",
          body: JSON.stringify(data),
        })
      );
    }

    async previewGitLabAllowlistSearch(
      data: GitLabAllowlistPreviewSearchRequest
    ): Promise<GitLabAllowlistEntry[]> {
      return this.unwrapData(
        this.request<{ data: GitLabAllowlistEntry[] }>(
          "/integrations/gitlab/allowlist/preview-search",
          {
            method: "POST",
            body: JSON.stringify(data),
          }
        )
      );
    }

    async previewGitLabConnectorTest(
      data: GitLabConnectorPreviewTestRequest
    ): Promise<GitLabConnectorPreviewTestResult> {
      return this.unwrapData(
        this.request<{ data: GitLabConnectorPreviewTestResult }>(
          "/integrations/gitlab/connectors/preview-test",
          {
            method: "POST",
            body: JSON.stringify(data),
          }
        )
      );
    }

    async updateGitLabConnector(
      id: string,
      data: GitLabConnectorUpdateRequest
    ): Promise<GitLabConnector> {
      return this.unwrapData(
        this.request<{ data: GitLabConnector }>(`/integrations/gitlab/connectors/${id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        })
      );
    }

    async deleteGitLabConnector(id: string): Promise<void> {
      await this.request<{ success: true }>(`/integrations/gitlab/connectors/${id}`, {
        method: "DELETE",
      });
    }

    async rotateGitLabConnectorToken(id: string, token: string): Promise<GitLabConnector> {
      return this.unwrapData(
        this.request<{ data: GitLabConnector }>(`/integrations/gitlab/connectors/${id}/token`, {
          method: "POST",
          body: JSON.stringify({ token }),
        })
      );
    }

    async getGitLabConnectorCapabilities(id: string): Promise<Record<string, boolean>> {
      return this.unwrapData(
        this.request<{ data: Record<string, boolean> }>(
          `/integrations/gitlab/connectors/${id}/capabilities`
        )
      );
    }

    async testGitLabConnector(id: string): Promise<GitLabConnector> {
      return this.unwrapData(
        this.request<{ data: GitLabConnector }>(`/integrations/gitlab/connectors/${id}/test`, {
          method: "POST",
        })
      );
    }

    async syncGitLabConnector(id: string): Promise<GitLabConnectorSyncResult> {
      return this.unwrapData(
        this.request<{ data: GitLabConnectorSyncResult }>(
          `/integrations/gitlab/connectors/${id}/sync`,
          {
            method: "POST",
          }
        )
      );
    }

    async searchGitLabAllowlist(id: string, query: string): Promise<GitLabAllowlistEntry[]> {
      return this.unwrapData(
        this.request<{ data: GitLabAllowlistEntry[] }>(
          `/integrations/gitlab/connectors/${id}/allowlist/search?q=${encodeURIComponent(query)}`
        )
      );
    }

    async listGitLabAllowlistOptions(id: string): Promise<GitLabAllowlistEntry[]> {
      return this.unwrapData(
        this.request<{ data: GitLabAllowlistEntry[] }>(
          `/integrations/gitlab/connectors/${id}/allowlist/options`
        )
      );
    }

    async refreshGitLabAllowlistOptions(id: string): Promise<GitLabAllowlistEntry[]> {
      return this.unwrapData(
        this.request<{ data: GitLabAllowlistEntry[] }>(
          `/integrations/gitlab/connectors/${id}/allowlist/options/refresh`,
          { method: "POST" }
        )
      );
    }
  };
}
