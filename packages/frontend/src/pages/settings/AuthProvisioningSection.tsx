import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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

  const load = useCallback(async () => {
    try {
      const settingsData = await api.getAuthProvisioningSettings();
      setSettings(settingsData);
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

  if (!settings) return null;

  return (
    <div className="border border-border bg-card">
      <div className="border-b border-border p-4">
        <h2 className="font-semibold">Gateway settings</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure sign-in provisioning and external control-plane access
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
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-sm font-medium">Default group for new OIDC users</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Applied to newly auto-created users after the first real administrator signs in
            </p>
          </div>
          <div className="w-64 shrink-0">
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
              Allow scoped Gateway API tokens with mcp:use to access the remote MCP endpoint
            </p>
          </div>
          <Switch
            checked={settings.mcpServerEnabled}
            disabled={!canEdit || isSavingMcp}
            onChange={handleToggleMcpServer}
          />
        </div>
      </div>
    </div>
  );
}
