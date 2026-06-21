import type {
  LoggingEnvironment,
  LoggingFacets,
  LoggingFeatureStatus,
  LoggingIngestToken,
  LoggingMetadata,
  LoggingSchema,
  LoggingSearchRequest,
  LoggingSearchResult,
} from "@/types";
import type { ApiClientBaseConstructor } from "./api-mixins";

export function withLoggingApi<TBase extends ApiClientBaseConstructor>(Base: TBase) {
  return class LoggingApiClient extends Base {
    // ── External Logging ────────────────────────────────────────────

    async getLoggingStatus(): Promise<LoggingFeatureStatus> {
      return this.unwrapData(this.request<{ data: LoggingFeatureStatus }>("/logging/status"));
    }

    async listLoggingEnvironments(params?: { search?: string }): Promise<LoggingEnvironment[]> {
      const query = new URLSearchParams();
      if (params?.search) query.set("search", params.search);
      const qs = query.toString();
      return this.unwrapData(
        this.request<{ data: LoggingEnvironment[] }>(`/logging/environments${qs ? `?${qs}` : ""}`)
      );
    }

    async createLoggingEnvironment(data: Partial<LoggingEnvironment>): Promise<LoggingEnvironment> {
      return this.unwrapData(
        this.request<{ data: LoggingEnvironment }>("/logging/environments", {
          method: "POST",
          body: JSON.stringify(data),
        })
      );
    }

    async updateLoggingEnvironment(
      id: string,
      data: Partial<LoggingEnvironment>
    ): Promise<LoggingEnvironment> {
      return this.unwrapData(
        this.request<{ data: LoggingEnvironment }>(`/logging/environments/${id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        })
      );
    }

    async deleteLoggingEnvironment(id: string): Promise<void> {
      await this.request<void>(`/logging/environments/${id}`, { method: "DELETE" });
    }

    async listLoggingSchemas(params?: { search?: string }): Promise<LoggingSchema[]> {
      const query = new URLSearchParams();
      if (params?.search) query.set("search", params.search);
      const qs = query.toString();
      return this.unwrapData(
        this.request<{ data: LoggingSchema[] }>(`/logging/schemas${qs ? `?${qs}` : ""}`)
      );
    }

    async getLoggingSchema(id: string): Promise<LoggingSchema> {
      return this.unwrapData(this.request<{ data: LoggingSchema }>(`/logging/schemas/${id}`));
    }

    async createLoggingSchema(data: Partial<LoggingSchema>): Promise<LoggingSchema> {
      return this.unwrapData(
        this.request<{ data: LoggingSchema }>("/logging/schemas", {
          method: "POST",
          body: JSON.stringify(data),
        })
      );
    }

    async updateLoggingSchema(id: string, data: Partial<LoggingSchema>): Promise<LoggingSchema> {
      return this.unwrapData(
        this.request<{ data: LoggingSchema }>(`/logging/schemas/${id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        })
      );
    }

    async deleteLoggingSchema(id: string): Promise<void> {
      await this.request<void>(`/logging/schemas/${id}`, { method: "DELETE" });
    }

    async listLoggingTokens(environmentId: string): Promise<LoggingIngestToken[]> {
      return this.unwrapData(
        this.request<{ data: LoggingIngestToken[] }>(
          `/logging/environments/${environmentId}/tokens`
        )
      );
    }

    async createLoggingToken(
      environmentId: string,
      data: { name: string; expiresAt?: string | null }
    ): Promise<LoggingIngestToken> {
      return this.unwrapData(
        this.request<{ data: LoggingIngestToken }>(
          `/logging/environments/${environmentId}/tokens`,
          {
            method: "POST",
            body: JSON.stringify(data),
          }
        )
      );
    }

    async deleteLoggingToken(environmentId: string, tokenId: string): Promise<void> {
      await this.request<void>(`/logging/environments/${environmentId}/tokens/${tokenId}`, {
        method: "DELETE",
      });
    }

    async searchLogs(
      environmentId: string,
      data: LoggingSearchRequest
    ): Promise<{ data: LoggingSearchResult[]; nextCursor: string | null }> {
      return this.request(`/logging/environments/${environmentId}/search`, {
        method: "POST",
        body: JSON.stringify({ limit: 100, ...data }),
      });
    }

    async getLoggingFacets(
      environmentId: string,
      params?: { from?: string; to?: string }
    ): Promise<LoggingFacets> {
      const query = new URLSearchParams();
      if (params?.from) query.set("from", params.from);
      if (params?.to) query.set("to", params.to);
      const qs = query.toString();
      return this.unwrapData(
        this.request<{ data: LoggingFacets }>(
          `/logging/environments/${environmentId}/facets${qs ? `?${qs}` : ""}`
        )
      );
    }

    async getLoggingMetadata(environmentId: string): Promise<LoggingMetadata> {
      return this.unwrapData(
        this.request<{ data: LoggingMetadata }>(`/logging/environments/${environmentId}/metadata`)
      );
    }
  };
}
