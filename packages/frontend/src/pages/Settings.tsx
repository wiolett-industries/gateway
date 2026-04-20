import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { confirm } from "@/components/common/ConfirmDialog";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useUIStore } from "@/stores/ui";
import type { DatabaseConnection, Node, ProxyHost } from "@/types";
import { AIConfigSection } from "./settings/AIConfigSection";
import { ApiTokensSection } from "./settings/ApiTokensSection";
import { AuthProvisioningSection } from "./settings/AuthProvisioningSection";
import { DockerRegistriesSection } from "./settings/DockerRegistriesSection";
import { HousekeepingSection } from "./settings/HousekeepingSection";
import { UpdateSection } from "./settings/UpdateSection";

export function Settings() {
  const { user, hasScope } = useAuthStore();
  const {
    theme,
    setTheme,
    showUpdateNotifications,
    setShowUpdateNotifications,
    showSystemCertificates,
    setShowSystemCertificates,
  } = useUIStore();
  const [nodesList, setNodesList] = useState<Node[]>([]);
  const [proxyHostsList, setProxyHostsList] = useState<ProxyHost[]>([]);
  const [databasesList, setDatabasesList] = useState<DatabaseConnection[]>([]);

  const canUpdate = hasScope("admin:update");
  const canManageUsers = hasScope("admin:users");
  const canUseAI = hasScope("feat:ai:use");
  const canHousekeep = hasScope("admin:housekeeping");
  const canConfigAI = hasScope("feat:ai:configure");
  const canManageRegistries = hasScope("docker:registries:list");
  const canViewSystemCertificates = hasScope("admin:details:certificates");

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
  }, []);

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

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">Account and application settings</p>
        </div>

        {/* Profile */}
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

        {/* Preferences */}
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Preferences</h2>
          </div>
          <div className="divide-y divide-border">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Theme</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Choose how the interface looks
                </p>
              </div>
              <div className="flex gap-0 border border-border w-fit shrink-0">
                {(["light", "dark", "system"] as const).map((t) => (
                  <button
                    key={t}
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
              <Switch checked={showUpdateNotifications} onChange={setShowUpdateNotifications} />
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
                  checked={useUIStore.getState().aiBypassCreateApprovals}
                  onChange={(v) => useUIStore.getState().setAIBypassCreateApprovals(v)}
                />
                <AIBypassRow
                  label="AI: bypass edit approvals"
                  description="Allow AI to modify resources without confirmation"
                  checked={useUIStore.getState().aiBypassEditApprovals}
                  onChange={(v) => useUIStore.getState().setAIBypassEditApprovals(v)}
                  dangerous
                />
                <AIBypassRow
                  label="AI: bypass delete approvals"
                  description="Allow AI to delete resources without confirmation"
                  checked={useUIStore.getState().aiBypassDeleteApprovals}
                  onChange={(v) => useUIStore.getState().setAIBypassDeleteApprovals(v)}
                  dangerous
                />
              </>
            )}
          </div>
        </div>

        {/* API Tokens */}
        <ApiTokensSection
          user={user}
          nodesList={nodesList}
          proxyHostsList={proxyHostsList}
          databasesList={databasesList}
        />

        {/* Authentication */}
        {canManageUsers && <AuthProvisioningSection />}

        {/* AI Assistant */}
        {canConfigAI && <AIConfigSection />}

        {/* Docker Registries */}
        {canManageRegistries && <DockerRegistriesSection nodesList={nodesList} />}

        {/* Housekeeping */}
        {canHousekeep && <HousekeepingSection />}

        {/* Update + About */}
        <UpdateSection canUpdate={canUpdate} />

        <p className="text-center text-xs text-muted-foreground">
          Powered by{" "}
          <a
            href="https://wiolett.net"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:underline"
          >
            Wiolett
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
