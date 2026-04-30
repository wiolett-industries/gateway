import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/services/api";
import type { AuthProvisioningSettings } from "@/types";

interface AuthProvisioningSectionProps {
  canEdit: boolean;
}

export function AuthProvisioningSection({ canEdit }: AuthProvisioningSectionProps) {
  const [settings, setSettings] = useState<AuthProvisioningSettings | null>(null);
  const [isSavingAutoCreate, setIsSavingAutoCreate] = useState(false);
  const [isSavingGroup, setIsSavingGroup] = useState(false);
  const [isSavingMcp, setIsSavingMcp] = useState(false);
  const [isSavingNetwork, setIsSavingNetwork] = useState(false);
  const [trustedProxyCidrs, setTrustedProxyCidrs] = useState("");
  const skipNextCidrsBlur = useRef(false);

  const load = useCallback(async () => {
    try {
      const settingsData = await api.getAuthProvisioningSettings();
      setSettings(settingsData);
      setTrustedProxyCidrs(settingsData.networkSecurity.trustedProxyCidrs.join(", "));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load Gateway settings");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedGroup = useMemo(
    () =>
      settings?.availableGroups.find((group) => group.id === settings.oidcDefaultGroupId) ?? null,
    [settings]
  );

  const handleToggleAutoCreate = async (checked: boolean) => {
    if (!settings || !canEdit) return;
    setIsSavingAutoCreate(true);
    const previous = settings;
    setSettings({ ...settings, oidcAutoCreateUsers: checked });
    try {
      const updated = await api.updateAuthProvisioningSettings({ oidcAutoCreateUsers: checked });
      setSettings(updated);
      toast.success("Gateway settings updated");
    } catch (err) {
      setSettings(previous);
      toast.error(err instanceof Error ? err.message : "Failed to update Gateway settings");
    } finally {
      setIsSavingAutoCreate(false);
    }
  };

  const handleChangeGroup = async (groupId: string) => {
    if (!settings || !canEdit) return;
    setIsSavingGroup(true);
    const previous = settings;
    setSettings({ ...settings, oidcDefaultGroupId: groupId });
    try {
      const updated = await api.updateAuthProvisioningSettings({ oidcDefaultGroupId: groupId });
      setSettings(updated);
      toast.success("Default OIDC group updated");
    } catch (err) {
      setSettings(previous);
      toast.error(err instanceof Error ? err.message : "Failed to update default OIDC group");
    } finally {
      setIsSavingGroup(false);
    }
  };

  const handleToggleMcpServer = async (checked: boolean) => {
    if (!settings || !canEdit) return;
    setIsSavingMcp(true);
    const previous = settings;
    setSettings({ ...settings, mcpServerEnabled: checked });
    try {
      const updated = await api.updateAuthProvisioningSettings({ mcpServerEnabled: checked });
      setSettings(updated);
      toast.success("MCP server setting updated");
    } catch (err) {
      setSettings(previous);
      toast.error(err instanceof Error ? err.message : "Failed to update MCP server setting");
    } finally {
      setIsSavingMcp(false);
    }
  };

  const updateNetworkSecurity = async (
    patch: Partial<AuthProvisioningSettings["networkSecurity"]>
  ) => {
    if (!settings || !canEdit) return;
    setIsSavingNetwork(true);
    const previous = settings;
    const nextNetworkSecurity = { ...settings.networkSecurity, ...patch };
    setSettings({ ...settings, networkSecurity: nextNetworkSecurity });
    try {
      const updated = await api.updateAuthProvisioningSettings({
        networkSecurity: nextNetworkSecurity,
      });
      setSettings(updated);
      setTrustedProxyCidrs(updated.networkSecurity.trustedProxyCidrs.join(", "));
      toast.success("Network settings updated");
    } catch (err) {
      setSettings(previous);
      setTrustedProxyCidrs(previous.networkSecurity.trustedProxyCidrs.join(", "));
      toast.error(err instanceof Error ? err.message : "Failed to update network settings");
    } finally {
      setIsSavingNetwork(false);
    }
  };

  const saveTrustedProxyCidrs = () => {
    if (!settings) return;
    const cidrs = trustedProxyCidrs
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (cidrs.join(",") === settings.networkSecurity.trustedProxyCidrs.join(",")) return;
    updateNetworkSecurity({ trustedProxyCidrs: cidrs });
  };

  if (!settings) return null;

  return (
    <div className="border border-border bg-card">
      <div className="border-b border-border p-4">
        <h2 className="font-semibold">Gateway settings</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure sign-in provisioning, control-plane access, and network trust
        </p>
      </div>
      <div className="divide-y divide-border">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-sm font-medium">Auto-create users on OIDC sign-in</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              If disabled, only pre-created users can sign in through OIDC
            </p>
          </div>
          <Switch
            checked={settings.oidcAutoCreateUsers}
            disabled={!canEdit || isSavingAutoCreate}
            onChange={handleToggleAutoCreate}
          />
        </div>
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <p className="text-sm font-medium">Default group for new OIDC users</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Applied to newly auto-created users after the first real administrator signs in
            </p>
          </div>
          <div className="w-full shrink-0 sm:w-64">
            <Select
              value={settings.oidcDefaultGroupId}
              disabled={!canEdit || isSavingGroup}
              onValueChange={handleChangeGroup}
            >
              <SelectTrigger>
                <SelectValue placeholder={selectedGroup?.name ?? "Select group"} />
              </SelectTrigger>
              <SelectContent>
                {settings.availableGroups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-sm font-medium">Enable MCP server</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Allow MCP-enabled user accounts to access the remote MCP endpoint with OAuth
            </p>
          </div>
          <Switch
            checked={settings.mcpServerEnabled}
            disabled={!canEdit || isSavingMcp}
            onChange={handleToggleMcpServer}
          />
        </div>
        <div className="divide-y divide-border">
          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div>
              <p className="text-sm font-medium">Client IP source</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Controls which address Gateway uses for rate limits and audit records
              </p>
            </div>
            <div className="w-full shrink-0 sm:w-64">
              <Select
                value={settings.networkSecurity.clientIpSource}
                disabled={!canEdit || isSavingNetwork}
                onValueChange={(clientIpSource) =>
                  updateNetworkSecurity({
                    clientIpSource:
                      clientIpSource as AuthProvisioningSettings["networkSecurity"]["clientIpSource"],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="direct">Direct connection</SelectItem>
                  <SelectItem value="reverse_proxy">Reverse proxy</SelectItem>
                  <SelectItem value="cloudflare">Cloudflare</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Resolved IP
              </p>
              <p className="mt-1 font-mono text-sm">
                {settings.currentRequestIp.ipAddress ?? "unknown"}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Remote peer
              </p>
              <p className="mt-1 font-mono text-sm">
                {settings.currentRequestIp.remoteAddress ?? "unknown"}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Source</p>
              <p className="mt-1 font-mono text-sm">{settings.currentRequestIp.source}</p>
            </div>
          </div>

          {settings.currentRequestIp.warning && (
            <p className="bg-muted px-4 py-3 text-xs text-muted-foreground">
              {settings.currentRequestIp.warning}
            </p>
          )}

          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <p className="text-sm font-medium">Trusted proxy CIDRs</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Comma-separated proxy ranges allowed to provide forwarded client headers. Empty
                trusts all peers in reverse proxy mode.
              </p>
            </div>
            <Input
              className="w-full shrink-0 border-border bg-[#080808] text-foreground placeholder:text-muted-foreground sm:max-w-80"
              value={trustedProxyCidrs}
              disabled={!canEdit || isSavingNetwork}
              placeholder="10.0.0.0/8, 172.16.0.0/12"
              onChange={(event) => {
                skipNextCidrsBlur.current = false;
                setTrustedProxyCidrs(event.target.value);
              }}
              onBlur={() => {
                if (skipNextCidrsBlur.current) {
                  skipNextCidrsBlur.current = false;
                  return;
                }
                saveTrustedProxyCidrs();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  skipNextCidrsBlur.current = true;
                  saveTrustedProxyCidrs();
                }
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Trust Cloudflare headers without edge IP check</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Enable only when direct origin access is blocked outside Cloudflare
              </p>
            </div>
            <Switch
              checked={settings.networkSecurity.trustCloudflareHeaders}
              disabled={!canEdit || isSavingNetwork}
              onChange={(trustCloudflareHeaders) =>
                updateNetworkSecurity({ trustCloudflareHeaders })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
