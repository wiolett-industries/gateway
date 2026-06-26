import type { AIApprovalMode } from "@/lib/ai-approval-mode";
import { useAuthStore } from "@/stores/auth";
import type { OAuthAuthorization, OAuthConsentPreview, User } from "@/types";
import type { ApiClientBaseConstructor } from "./api-mixins";

const AUTH_BASE = "/auth";

export function withAuthApi<TBase extends ApiClientBaseConstructor>(Base: TBase) {
  return class AuthApiClient extends Base {
    // ── Auth ──────────────────────────────────────────────────────────

    async getCurrentUser(): Promise<User> {
      return this.request<User>("/auth/me");
    }

    async getUserPreferences(): Promise<{ aiApprovalMode: AIApprovalMode }> {
      return this.cachedRequest("auth:me:preferences", () =>
        this.request<{ aiApprovalMode: AIApprovalMode }>("/auth/me/preferences")
      );
    }

    async updateUserPreferences(input: {
      aiApprovalMode: AIApprovalMode;
    }): Promise<{ aiApprovalMode: AIApprovalMode }> {
      const preferences = await this.request<{ aiApprovalMode: AIApprovalMode }>(
        "/auth/me/preferences",
        {
          method: "PATCH",
          body: JSON.stringify(input),
        }
      );
      this.setCache("auth:me:preferences", preferences);
      return preferences;
    }

    async logout(): Promise<void> {
      try {
        await this.request<void>("/auth/logout", { method: "POST" });
      } finally {
        this.clearCsrfToken();
        useAuthStore.getState().logout();
      }
    }

    getLoginUrl(): string {
      return `${AUTH_BASE}/login`;
    }

    async getOAuthConsent(requestId: string): Promise<OAuthConsentPreview> {
      return this.request<OAuthConsentPreview>(
        `/api/oauth/consent/${encodeURIComponent(requestId)}`
      );
    }

    async approveOAuthConsent(
      requestId: string,
      scopes: string[]
    ): Promise<{ redirectUrl: string }> {
      return this.request<{ redirectUrl: string }>(
        `/api/oauth/consent/${encodeURIComponent(requestId)}/approve`,
        {
          method: "POST",
          body: JSON.stringify({ scopes }),
        }
      );
    }

    async denyOAuthConsent(requestId: string): Promise<{ redirectUrl: string }> {
      return this.request<{ redirectUrl: string }>(
        `/api/oauth/consent/${encodeURIComponent(requestId)}/deny`,
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      );
    }

    async listOAuthAuthorizations(): Promise<OAuthAuthorization[]> {
      return this.unwrapData(
        this.request<{ data: OAuthAuthorization[] }>("/api/oauth/authorizations")
      );
    }

    async revokeOAuthAuthorization(clientId: string, resource: string): Promise<void> {
      await this.request<void>(
        `/api/oauth/authorizations/${encodeURIComponent(clientId)}?resource=${encodeURIComponent(resource)}`,
        {
          method: "DELETE",
        }
      );
    }

    async updateOAuthAuthorization(
      clientId: string,
      resource: string,
      scopes: string[]
    ): Promise<OAuthAuthorization> {
      return this.unwrapData(
        this.request<{ data: OAuthAuthorization }>(
          `/api/oauth/authorizations/${encodeURIComponent(clientId)}?resource=${encodeURIComponent(resource)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ scopes }),
          }
        )
      );
    }
  };
}
