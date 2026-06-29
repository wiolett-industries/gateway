import type {
  AlertCategoryDef,
  AlertRule,
  NotificationWebhook,
  WebhookDelivery,
  WebhookPreset,
} from "@/types";
import type { ApiClientBaseConstructor } from "./api-mixins";

export function withNotificationApi<TBase extends ApiClientBaseConstructor>(Base: TBase) {
  return class NotificationApiClient extends Base {
    // ── Notification Alert Rules ──────────────────────────────────────

    async listAlertRules(params?: {
      page?: number;
      limit?: number;
      type?: string;
      enabled?: boolean;
      search?: string;
    }): Promise<{
      data: AlertRule[];
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

    async getAlertCategories(): Promise<AlertCategoryDef[]> {
      return this.unwrapData(this.request("/notifications/alert-rules/categories"));
    }

    async createAlertRule(
      data: Omit<AlertRule, "id" | "createdAt" | "updatedAt" | "isBuiltin">
    ): Promise<AlertRule> {
      return this.unwrapData(
        this.request("/notifications/alert-rules", {
          method: "POST",
          body: JSON.stringify(data),
        })
      );
    }

    async updateAlertRule(
      id: string,
      data: Partial<Omit<AlertRule, "id" | "createdAt" | "updatedAt" | "isBuiltin">>
    ): Promise<AlertRule> {
      return this.unwrapData(
        this.request(`/notifications/alert-rules/${id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        })
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
      data: NotificationWebhook[];
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

    async getWebhookPresets(): Promise<WebhookPreset[]> {
      return this.unwrapData(this.request("/notifications/webhooks/presets"));
    }

    async createWebhook(
      data: Omit<NotificationWebhook, "id" | "createdAt" | "updatedAt">
    ): Promise<NotificationWebhook> {
      return this.unwrapData(
        this.request("/notifications/webhooks", {
          method: "POST",
          body: JSON.stringify(data),
        })
      );
    }

    async updateWebhook(
      id: string,
      data: Partial<Omit<NotificationWebhook, "id" | "createdAt" | "updatedAt">>
    ): Promise<NotificationWebhook> {
      return this.unwrapData(
        this.request(`/notifications/webhooks/${id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        })
      );
    }

    async deleteWebhook(id: string): Promise<void> {
      await this.request(`/notifications/webhooks/${id}`, { method: "DELETE" });
    }

    async testWebhook(
      id: string
    ): Promise<{ success: boolean; statusCode?: number; error?: string; rendered?: string }> {
      return this.unwrapData(
        this.request(`/notifications/webhooks/${id}/test`, { method: "POST" })
      );
    }

    async previewWebhookTemplate(
      bodyTemplate: string
    ): Promise<{ rendered: string; context: Record<string, unknown> }> {
      return this.unwrapData(
        this.request("/notifications/webhooks/preview", {
          method: "POST",
          body: JSON.stringify({ bodyTemplate }),
        })
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
      data: WebhookDelivery[];
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

    async getDelivery(id: string): Promise<WebhookDelivery> {
      return this.unwrapData(
        this.request<{ data: WebhookDelivery }>(`/notifications/deliveries/${id}`)
      );
    }

    async getDeliveryStats(
      webhookId?: string
    ): Promise<{ total: number; success: number; failed: number; retrying: number }> {
      const qs = webhookId ? `?webhookId=${webhookId}` : "";
      return this.unwrapData(this.request(`/notifications/deliveries/stats${qs}`));
    }
  };
}
