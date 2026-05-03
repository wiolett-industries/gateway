import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { confirm } from "@/components/common/ConfirmDialog";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deriveAllowedResourceIdsByScope, scopeMatches } from "@/lib/scope-utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useUIStore } from "@/stores/ui";
import type { DatabaseConnection, LoggingSchema, Node, ProxyHost } from "@/types";
import { AIConfigSection } from "./settings/AIConfigSection";
import { ApiTokensSection } from "./settings/ApiTokensSection";
import { AuthProvisioningSection } from "./settings/AuthProvisioningSection";
import { DockerRegistriesSection } from "./settings/DockerRegistriesSection";
import { HousekeepingSection } from "./settings/HousekeepingSection";
import { LicenseSection } from "./settings/LicenseSection";
import { OAuthApplicationsSection } from "./settings/OAuthApplicationsSection";
import { StatusPageSection } from "./settings/StatusPageSection";
import { UpdateSection } from "./settings/UpdateSection";

const SETTINGS_TABS = ["preferences", "gateway", "features"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

function isSettingsTab(value: string | null | undefined): value is SettingsTab {
  return SETTINGS_TABS.includes(value as SettingsTab);
}

export function Settings() {
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const { user, hasScope } = useAuthStore();
  const {
    theme,
    setTheme,
    showUpdateNotifications,
    setShowUpdateNotifications,
    showSystemCertificates,
    setShowSystemCertificates,
    aiBypassCreateApprovals,
    setAIBypassCreateApprovals,
    aiBypassEditApprovals,
    setAIBypassEditApprovals,
    aiBypassDeleteApprovals,
    setAIBypassDeleteApprovals,
  } = useUIStore();
  const [nodesList, setNodesList] = useState<Node[]>([]);
  const [proxyHostsList, setProxyHostsList] = useState<ProxyHost[]>([]);
  const [databasesList, setDatabasesList] = useState<DatabaseConnection[]>([]);
  const [loggingSchemasList, setLoggingSchemasList] = useState<LoggingSchema[]>([]);
  const activeTab: SettingsTab = isSettingsTab(tabParam) ? tabParam : "preferences";

  const canUpdate = hasScope("admin:update");
  const canViewGatewaySettings = hasScope("settings:gateway:view");
  const canEditGatewaySettings = hasScope("settings:gateway:edit");
  const canUseAI = hasScope("feat:ai:use");
  const canViewHousekeeping = hasScope("housekeeping:view");
  const canRunHousekeeping = hasScope("housekeeping:run");
  const canConfigureHousekeeping = hasScope("housekeeping:configure");
  const canConfigAI = hasScope("feat:ai:configure");
  const canManageRegistries = hasScope("docker:registries:view");
  const canViewSystemCertificates = hasScope("admin:details:certificates");
  const canViewLicense = hasScope("license:view");
  const canManageLicense = hasScope("license:manage");
  const canViewStatusPage = hasScope("status-page:view");
  const userScopes = user?.scopes;

  useEffect(() => {
    api
      .listNodes({ limit: 100 })
      .then((r) => setNodesList(r.data ?? []))
      .catch(() => {});
    api
      .listProxyHosts({ limit: 100 })
      .then((r) => setProxyHostsList(r.data ?? []))
      .catch(() => {});
    api
      .listDatabases({ limit: 200 })
      .then((r) => setDatabasesList(r.data ?? []))
      .catch(() => {});
    if (
      scopeMatches(userScopes ?? [], "logs:schemas:view") ||
      scopeMatches(userScopes ?? [], "logs:manage") ||
      (deriveAllowedResourceIdsByScope(userScopes ?? [])["logs:schemas:view"]?.length ?? 0) > 0
    ) {
      api
        .listLoggingSchemas()
        .then(setLoggingSchemasList)
        .catch(() => {});
    }
  }, [userScopes]);

  useEffect(() => {
    api
      .listTokens()
      .then((data) => api.setCache("settings:api-tokens", data ?? []))
      .catch(() => {});
    api
      .listOAuthAuthorizations()
      .then((data) => api.setCache("settings:oauth-authorizations", data ?? []))
      .catch(() => {});

    if (canViewGatewaySettings) {
      api
        .getAuthProvisioningSettings()
        .then((data) => api.setCache("settings:auth-provisioning", data))
        .catch(() => {});
    }
    if (canManageRegistries) {
      api
        .listDockerRegistries()
        .then((data) => api.setCache("settings:docker-registries", data ?? []))
        .catch(() => {});
    }
    if (canViewLicense) {
      api
        .getLicenseStatus()
        .then((data) => api.setCache("settings:license-status", data))
        .catch(() => {});
    }
    if (canConfigAI) {
      api
        .getAIConfig()
        .then((data) => api.setCache("settings:ai-config", data))
        .catch(() => {});
    }
    if (canViewStatusPage) {
      api
        .getStatusPageSettings()
        .then((data) => api.setCache("settings:status-page-config", data))
        .catch(() => {});
      api
        .listStatusPageProxyTemplates()
        .then((data) => api.setCache("settings:status-page-proxy-templates", data ?? []))
        .catch(() => {});
      api
        .listSSLCertificates({ limit: 100 })
        .then((res) => api.setCache("settings:status-page-ssl-certs", res.data ?? []))
        .catch(() => {});
    }
    if (canViewHousekeeping) {
      api
        .getHousekeepingConfig()
        .then((data) => api.setCache("housekeeping:config", data))
        .catch(() => {});
      api
        .getHousekeepingStats()
        .then((data) => api.setCache("housekeeping:stats", data))
        .catch(() => {});
    }
  }, [
    canConfigAI,
    canManageRegistries,
    canViewGatewaySettings,
    canViewHousekeeping,
    canViewLicense,
    canViewStatusPage,
  ]);

  useEffect(() => {
    if (tabParam && !isSettingsTab(tabParam)) {
      navigate("/settings", { replace: true });
    }
  }, [navigate, tabParam]);

  const handleToggleSystemCertificates = (checked: boolean) => {
    setShowSystemCertificates(checked);
    api.invalidateCache("req:/api/cas");
    api.invalidateCache("req:/api/certificates");
    api.invalidateCache("req:/api/ssl-certificates");
    api.invalidateCache("req:/api/monitoring/dashboard");
    api.invalidateCache("cas:list:");
    api.invalidateCache("certificates:list:");
    api.invalidateCache("ssl:list:");
    api.invalidateCache("dashboard:stats:");
  };

  const handleTabChange = (value: string) => {
    navigate(value === "preferences" ? "/settings" : `/settings/${value}`);
  };

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">Account and application settings</p>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col">
          <TabsList className="shrink-0">
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
            <TabsTrigger value="gateway">Gateway settings</TabsTrigger>
            <TabsTrigger value="features">Features</TabsTrigger>
          </TabsList>

          <TabsContent value="preferences" className="pb-0">
            <div className="space-y-4">
              <div className="border border-border bg-card">
                <div className="border-b border-border p-4">
                  <h2 className="font-semibold">Profile</h2>
                </div>
                {user && (
                  <div className="flex items-center gap-4 p-4">
                    <div className="h-10 w-10 bg-muted flex items-center justify-center shrink-0">
                      <span className="text-sm font-medium text-muted-foreground">
                        {(user.name || user.email).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{user.name || "Not set"}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>
                    <Badge variant="secondary" className="text-xs capitalize">
                      {user.groupName}
                    </Badge>
                  </div>
                )}
              </div>

              <div className="border border-border bg-card">
                <div className="border-b border-border p-4">
                  <h2 className="font-semibold">Preferences</h2>
                </div>
                <div className="divide-y divide-border">
                  <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div>
                      <p className="text-sm font-medium">Theme</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Choose how the interface looks
                      </p>
                    </div>
                    <div className="flex w-fit shrink-0 gap-0 border border-border">
                      {(["light", "dark", "system"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTheme(t)}
                          className={`flex items-center gap-2 px-4 py-2 text-sm capitalize transition-colors ${
                            theme === t
                              ? "bg-primary text-primary-foreground"
                              : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent"
                          }`}
                        >
                          {t === "light" && <Sun className="h-3.5 w-3.5" />}
                          {t === "dark" && <Moon className="h-3.5 w-3.5" />}
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">Update notifications</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Show update banners in sidebar and dashboard
                      </p>
                    </div>
                    <Switch
                      checked={showUpdateNotifications}
                      onChange={setShowUpdateNotifications}
                    />
                  </div>
                  {canViewSystemCertificates && (
                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">Show system certificates</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Include internal PKI and SSL certificates in lists and dashboard counts
                        </p>
                      </div>
                      <Switch
                        checked={showSystemCertificates}
                        onChange={handleToggleSystemCertificates}
                      />
                    </div>
                  )}
                  {canUseAI && (
                    <>
                      <AIBypassRow
                        label="AI: bypass create approvals"
                        description="Allow AI to create resources without confirmation"
                        checked={aiBypassCreateApprovals}
                        onChange={setAIBypassCreateApprovals}
                      />
                      <AIBypassRow
                        label="AI: bypass edit approvals"
                        description="Allow AI to modify resources without confirmation"
                        checked={aiBypassEditApprovals}
                        onChange={setAIBypassEditApprovals}
                        dangerous
                      />
                      <AIBypassRow
                        label="AI: bypass delete approvals"
                        description="Allow AI to delete resources without confirmation"
                        checked={aiBypassDeleteApprovals}
                        onChange={setAIBypassDeleteApprovals}
                        dangerous
                      />
                    </>
                  )}
                </div>
              </div>

              <ApiTokensSection
                user={user}
                nodesList={nodesList}
                proxyHostsList={proxyHostsList}
                databasesList={databasesList}
                loggingSchemasList={loggingSchemasList}
              />

              <OAuthApplicationsSection
                nodesList={nodesList}
                proxyHostsList={proxyHostsList}
                databasesList={databasesList}
                loggingSchemasList={loggingSchemasList}
              />
            </div>
          </TabsContent>

          <TabsContent value="gateway" className="pb-0">
            <div className="space-y-4">
              {canViewGatewaySettings && (
                <AuthProvisioningSection canEdit={canEditGatewaySettings} />
              )}

              {canManageRegistries && <DockerRegistriesSection nodesList={nodesList} />}

              {canViewLicense ? (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <UpdateSection canUpdate={canUpdate} />
                  <LicenseSection canManage={canManageLicense} />
                </div>
              ) : (
                <UpdateSection canUpdate={canUpdate} />
              )}
            </div>
          </TabsContent>

          <TabsContent value="features" className="pb-0">
            <div className="space-y-4">
              {canConfigAI && <AIConfigSection />}

              {canViewStatusPage && <StatusPageSection nodesList={nodesList} />}

              {canViewHousekeeping && (
                <HousekeepingSection
                  canRun={canRunHousekeeping}
                  canConfigure={canConfigureHousekeeping}
                />
              )}

              {!canConfigAI && !canViewStatusPage && !canViewHousekeeping && (
                <div className="border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                  No feature settings available for your account.
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <p className="text-center text-xs text-muted-foreground">
          Powered by{" "}
          <a
            href="https://wiolett.net"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:underline"
          >
            Wiolett Industries
          </a>
        </p>
      </div>
    </PageTransition>
  );
}

function AIBypassRow({
  label,
  description,
  checked,
  onChange,
  dangerous,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  dangerous?: boolean;
}) {
  const handleChange = async (v: boolean) => {
    if (v && dangerous) {
      const ok = await confirm({
        title: `Enable ${label.toLowerCase().replace("ai: ", "")}?`,
        description:
          "This may be dangerous. The AI assistant will perform these actions without asking for your confirmation.",
        confirmLabel: "Enable",
        variant: "destructive",
      });
      if (!ok) return;
    }
    onChange(v);
  };

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Switch checked={checked} onChange={handleChange} />
    </div>
  );
}
