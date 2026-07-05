import {
  Bot,
  Check,
  ChevronDown,
  Moon,
  Plug,
  ServerCog,
  SlidersHorizontal,
  Sparkles,
  Sun,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { LiteModeBackButton } from "@/components/common/LiteModeBackButton";
import { PageTransition } from "@/components/common/PageTransition";
import { PanelShell } from "@/components/common/PanelShell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AI_APPROVAL_MODE_META,
  AI_APPROVAL_MODES,
  type AIApprovalMode,
} from "@/lib/ai-approval-mode";
import {
  confirmBypassEverythingMode,
  updateAIApprovalModeOptimistically,
} from "@/lib/ai-user-preferences";
import { deriveAllowedResourceIdsByScope, scopeMatches } from "@/lib/scope-utils";
import { getInitials } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useUIStore } from "@/stores/ui";
import type { DatabaseConnection, LoggingSchema, Node, ProxyHost } from "@/types";
import { AIConfigSection } from "./settings/AIConfigSection";
import { ApiTokensSection } from "./settings/ApiTokensSection";
import { AuthProvisioningSection } from "./settings/AuthProvisioningSection";
import { DockerRegistriesSection } from "./settings/DockerRegistriesSection";
import { HousekeepingSection } from "./settings/HousekeepingSection";
import { IntegrationsSection } from "./settings/IntegrationsSection";
import { LicenseSection } from "./settings/LicenseSection";
import { OAuthApplicationsSection } from "./settings/OAuthApplicationsSection";
import { StatusPageSection } from "./settings/StatusPageSection";
import { UpdateSection } from "./settings/UpdateSection";

const SETTINGS_TABS = ["preferences", "gateway", "features", "integrations", "ai"] as const;
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
    showAILiteModeCTA,
    setShowAILiteModeCTA,
    aiApprovalMode,
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
  const canViewIntegrations =
    hasScope("integrations:gitlab:view") || hasScope("integrations:gitlab:manage");
  const userScopes = user?.scopes;
  const canAccessGatewayTab =
    canViewGatewaySettings || canManageRegistries || canUpdate || canViewLicense;
  const canAccessFeaturesTab = canViewStatusPage || canViewHousekeeping;
  const availableTabs = useMemo<SettingsTab[]>(() => {
    const tabs: SettingsTab[] = ["preferences"];
    if (canAccessGatewayTab) tabs.push("gateway");
    if (canAccessFeaturesTab) tabs.push("features");
    if (canViewIntegrations) tabs.push("integrations");
    if (canConfigAI) tabs.push("ai");
    return tabs;
  }, [canAccessFeaturesTab, canAccessGatewayTab, canConfigAI, canViewIntegrations]);
  const currentTab = availableTabs.includes(activeTab) ? activeTab : availableTabs[0];

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
    if (canViewIntegrations) {
      api
        .listGitLabConnectors()
        .then((data) => api.setCache("settings:gitlab-connectors", data ?? []))
        .catch(() => {});
    }
  }, [
    canConfigAI,
    canManageRegistries,
    canViewGatewaySettings,
    canViewHousekeeping,
    canViewIntegrations,
    canViewLicense,
    canViewStatusPage,
  ]);

  useEffect(() => {
    if (tabParam && !isSettingsTab(tabParam)) {
      navigate("/settings", { replace: true });
    }
  }, [navigate, tabParam]);

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      navigate(availableTabs[0] === "preferences" ? "/settings" : `/settings/${availableTabs[0]}`, {
        replace: true,
      });
    }
  }, [activeTab, availableTabs, navigate]);

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

  const handleAIApprovalModeChange = async (mode: AIApprovalMode) => {
    if (mode === aiApprovalMode) return;
    if (
      mode === "bypass-everything" &&
      aiApprovalMode !== "bypass-everything" &&
      !(await confirmBypassEverythingMode())
    ) {
      return;
    }

    try {
      await updateAIApprovalModeOptimistically(mode, aiApprovalMode);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update AI mode");
    }
  };

  const handleTabChange = (value: string) => {
    navigate(value === "preferences" ? "/settings" : `/settings/${value}`);
  };

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <div className="flex items-center gap-3">
          <LiteModeBackButton />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-sm text-muted-foreground">Account and application settings</p>
          </div>
        </div>

        <Tabs value={currentTab} onValueChange={handleTabChange} className="flex flex-col">
          <TabsList className="shrink-0">
            <TabsTrigger value="preferences" className="gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Preferences
            </TabsTrigger>
            {canAccessGatewayTab && (
              <TabsTrigger value="gateway" className="gap-1.5">
                <ServerCog className="h-3.5 w-3.5" />
                Gateway settings
              </TabsTrigger>
            )}
            {canAccessFeaturesTab && (
              <TabsTrigger value="features" className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                Features
              </TabsTrigger>
            )}
            {canViewIntegrations && (
              <TabsTrigger value="integrations" className="gap-1.5">
                <Plug className="h-3.5 w-3.5" />
                Integrations
              </TabsTrigger>
            )}
            {canConfigAI && (
              <TabsTrigger value="ai" className="gap-1.5">
                <Bot className="h-3.5 w-3.5" />
                AI Assistant
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="preferences" className="pb-0">
            <div className="space-y-4">
              <PanelShell title="Profile">
                {user && (
                  <div className="flex items-center gap-4 p-4">
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarImage src={user.avatarUrl ?? undefined} />
                      <AvatarFallback className="text-sm">
                        {getInitials(user.name || user.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{user.name || "Not set"}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>
                    <Badge variant="secondary">{user.groupName}</Badge>
                  </div>
                )}
              </PanelShell>

              <PanelShell title="Preferences">
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
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">Lite mode shortcuts</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Show sidebar shortcuts for switching between Gateway and AI lite mode
                      </p>
                    </div>
                    <Switch checked={showAILiteModeCTA} onChange={setShowAILiteModeCTA} />
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
                    <AIApprovalModeRow
                      value={aiApprovalMode}
                      onChange={handleAIApprovalModeChange}
                    />
                  )}
                </div>
              </PanelShell>

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

          {canAccessGatewayTab && (
            <TabsContent value="gateway" className="pb-0">
              <div className="space-y-4">
                {canViewGatewaySettings && (
                  <AuthProvisioningSection canEdit={canEditGatewaySettings} />
                )}

                {canManageRegistries && <DockerRegistriesSection nodesList={nodesList} />}

                {canViewLicense ? (
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {canUpdate && <UpdateSection canUpdate={canUpdate} />}
                    <LicenseSection canManage={canManageLicense} />
                  </div>
                ) : (
                  canUpdate && <UpdateSection canUpdate={canUpdate} />
                )}
              </div>
            </TabsContent>
          )}

          {canAccessFeaturesTab && (
            <TabsContent value="features" className="pb-0">
              <div className="space-y-4">
                {canViewStatusPage && <StatusPageSection nodesList={nodesList} />}

                {canViewHousekeeping && (
                  <HousekeepingSection
                    canRun={canRunHousekeeping}
                    canConfigure={canConfigureHousekeeping}
                  />
                )}
              </div>
            </TabsContent>
          )}

          {canViewIntegrations && (
            <TabsContent value="integrations" className="pb-0">
              <div className="space-y-4">
                <IntegrationsSection />
              </div>
            </TabsContent>
          )}

          {canConfigAI && (
            <TabsContent value="ai" className="pb-0">
              <div className="space-y-4">
                <AIConfigSection />
              </div>
            </TabsContent>
          )}
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

function AIApprovalModeRow({
  value,
  onChange,
}: {
  value: AIApprovalMode;
  onChange: (mode: AIApprovalMode) => void | Promise<void>;
}) {
  const current = AI_APPROVAL_MODE_META[value];
  const CurrentIcon = current.icon;

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">AI approval mode</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{current.description}</p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full justify-between sm:w-[250px]">
            <span className="flex min-w-0 items-center gap-2">
              <CurrentIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">{current.menuLabel}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))]">
          {AI_APPROVAL_MODES.map((mode) => {
            const item = AI_APPROVAL_MODE_META[mode];
            const Icon = item.icon;
            return (
              <DropdownMenuItem
                key={mode}
                className="items-start gap-3"
                onSelect={() => void onChange(mode)}
              >
                <Icon className="mt-0.5 h-4 w-4" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{item.menuLabel}</span>
                  <span className="block text-xs text-muted-foreground">{item.description}</span>
                </span>
                {value === mode && <Check className="mt-0.5 h-4 w-4" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
