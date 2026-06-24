import { AlertTriangle, Plus, Send, Webhook } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LiteModeBackButton } from "@/components/common/LiteModeBackButton";
import { ResponsiveHeaderActions } from "@/components/common/ResponsiveHeaderActions";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertsTab } from "@/pages/notifications/AlertsTab";
import { DELIVERY_PAGE_SIZE, DeliveryLogTab } from "@/pages/notifications/DeliveryLogTab";
import { WebhooksTab } from "@/pages/notifications/WebhooksTab";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";

const TABS = [
  { value: "alerts", label: "Alerts", icon: AlertTriangle },
  { value: "webhooks", label: "Webhooks", icon: Webhook },
  { value: "deliveries", label: "Delivery Log", icon: Send },
] as const;

export function Notifications() {
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const { hasAnyScope } = useAuthStore();
  const canReadAlerts = hasAnyScope(
    "notifications:alerts:view",
    "notifications:alerts:view",
    "notifications:view",
    "notifications:manage"
  );
  const canAccessAlerts = hasAnyScope(
    "notifications:alerts:view",
    "notifications:alerts:view",
    "notifications:alerts:create",
    "notifications:alerts:edit",
    "notifications:alerts:delete",
    "notifications:view",
    "notifications:manage"
  );
  const canReadWebhooks = hasAnyScope(
    "notifications:webhooks:view",
    "notifications:webhooks:view",
    "notifications:view",
    "notifications:manage"
  );
  const canManageAlerts = hasAnyScope(
    "notifications:alerts:create",
    "notifications:alerts:edit",
    "notifications:alerts:delete",
    "notifications:manage"
  );
  const canAccessWebhooks = hasAnyScope(
    "notifications:webhooks:view",
    "notifications:webhooks:view",
    "notifications:webhooks:create",
    "notifications:webhooks:edit",
    "notifications:webhooks:delete",
    "notifications:view",
    "notifications:manage"
  );
  const canManageWebhooks = hasAnyScope(
    "notifications:webhooks:create",
    "notifications:webhooks:edit",
    "notifications:webhooks:delete",
    "notifications:manage"
  );
  const canViewDeliveries = hasAnyScope(
    "notifications:deliveries:view",
    "notifications:deliveries:view",
    "notifications:view",
    "notifications:manage"
  );
  const visibleTabs = TABS.filter((tab) => {
    if (tab.value === "alerts") return canAccessAlerts;
    if (tab.value === "webhooks") return canAccessWebhooks;
    if (tab.value === "deliveries") return canViewDeliveries;
    return false;
  });
  const activeTab =
    tabParam && visibleTabs.some((t) => t.value === tabParam)
      ? tabParam
      : visibleTabs[0]?.value || "alerts";
  const [openCreateAlertToken, setOpenCreateAlertToken] = useState(0);
  const [openCreateWebhookToken, setOpenCreateWebhookToken] = useState(0);
  const [refreshDeliveriesToken, setRefreshDeliveriesToken] = useState(0);

  useEffect(() => {
    if (canReadAlerts) {
      api
        .listAlertRules({ limit: 100 })
        .then((result) => api.setCache("notifications:alerts", result.data ?? []))
        .catch(() => {});
    }
    if (canReadWebhooks) {
      api
        .listWebhooks({ limit: 100 })
        .then((result) => api.setCache("notifications:webhooks", result.data ?? []))
        .catch(() => {});
    }
    if (canViewDeliveries) {
      api
        .listDeliveries({ page: 1, limit: DELIVERY_PAGE_SIZE })
        .then((result) => {
          api.setCache("notifications:deliveries:all", result.data ?? []);
          api.setCache("notifications:deliveries:all:has-more", (result.totalPages ?? 1) > 1);
        })
        .catch(() => {});
    }
  }, [canReadAlerts, canReadWebhooks, canViewDeliveries]);

  const headerAction =
    activeTab === "alerts" && canManageAlerts ? (
      <Button onClick={() => setOpenCreateAlertToken((v) => v + 1)}>
        <Plus className="h-4 w-4" /> New Alert
      </Button>
    ) : activeTab === "webhooks" && canManageWebhooks ? (
      <Button onClick={() => setOpenCreateWebhookToken((v) => v + 1)}>
        <Plus className="h-4 w-4" /> New Webhook
      </Button>
    ) : activeTab === "deliveries" && canViewDeliveries ? (
      <Button variant="outline" onClick={() => setRefreshDeliveriesToken((v) => v + 1)}>
        Refresh
      </Button>
    ) : null;
  const headerActions =
    activeTab === "alerts" && canManageAlerts
      ? [
          {
            label: "New Alert",
            icon: <Plus className="h-4 w-4" />,
            onClick: () => setOpenCreateAlertToken((v) => v + 1),
          },
        ]
      : activeTab === "webhooks" && canManageWebhooks
        ? [
            {
              label: "New Webhook",
              icon: <Plus className="h-4 w-4" />,
              onClick: () => setOpenCreateWebhookToken((v) => v + 1),
            },
          ]
        : activeTab === "deliveries" && canViewDeliveries
          ? [
              {
                label: "Refresh",
                onClick: () => setRefreshDeliveriesToken((v) => v + 1),
              },
            ]
          : [];

  useEffect(() => {
    if (visibleTabs.length === 0) return;
    if (!tabParam || !visibleTabs.some((t) => t.value === tabParam)) {
      navigate(`/notifications/${activeTab}`, { replace: true });
    }
  }, [activeTab, navigate, tabParam, visibleTabs]);

  const usesFillLayout = activeTab === "deliveries";

  return (
    <div
      className={
        usesFillLayout
          ? "h-full flex flex-col overflow-hidden p-6 gap-6"
          : "h-full overflow-y-auto p-6 space-y-6"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <LiteModeBackButton />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">Notifications</h1>
            <p className="text-sm text-muted-foreground">
              Manage alert rules, webhooks, and delivery activity
            </p>
          </div>
        </div>
        <ResponsiveHeaderActions actions={headerActions}>{headerAction}</ResponsiveHeaderActions>
      </div>
      <Tabs
        value={activeTab}
        onValueChange={(v) => navigate(`/notifications/${v}`, { replace: true })}
        className={`flex flex-col ${usesFillLayout ? "flex-1 min-h-0" : ""}`}
      >
        <TabsList>
          {visibleTabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="flex items-center gap-2">
              <t.icon className="h-4 w-4" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {canAccessAlerts && (
          <TabsContent value="alerts" className="mt-4">
            <AlertsTab
              canManage={canManageAlerts}
              canRead={canReadAlerts}
              openCreateToken={openCreateAlertToken}
            />
          </TabsContent>
        )}
        {canAccessWebhooks && (
          <TabsContent value="webhooks" className="mt-4">
            <WebhooksTab
              canManage={canManageWebhooks}
              canRead={canReadWebhooks}
              openCreateToken={openCreateWebhookToken}
            />
          </TabsContent>
        )}
        {canViewDeliveries && (
          <TabsContent
            value="deliveries"
            className="mt-4 flex flex-col flex-1 min-h-0 overflow-hidden"
          >
            <DeliveryLogTab refreshToken={refreshDeliveriesToken} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
