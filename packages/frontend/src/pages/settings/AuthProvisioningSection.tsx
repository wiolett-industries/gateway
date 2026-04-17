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

export function AuthProvisioningSection() {
  const [settings, setSettings] = useState<AuthProvisioningSettings | null>(null);
  const [isSavingAutoCreate, setIsSavingAutoCreate] = useState(false);
  const [isSavingGroup, setIsSavingGroup] = useState(false);

  const load = useCallback(async () => {
    try {
      const settingsData = await api.getAuthProvisioningSettings();
      setSettings(settingsData);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load authentication settings");
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
    if (!settings) return;
    setIsSavingAutoCreate(true);
    const previous = settings;
    setSettings({ ...settings, oidcAutoCreateUsers: checked });
    try {
      const updated = await api.updateAuthProvisioningSettings({ oidcAutoCreateUsers: checked });
      setSettings(updated);
      toast.success("Authentication settings updated");
    } catch (err) {
      setSettings(previous);
      toast.error(err instanceof Error ? err.message : "Failed to update authentication settings");
    } finally {
      setIsSavingAutoCreate(false);
    }
  };

  const handleChangeGroup = async (groupId: string) => {
    if (!settings) return;
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

  if (!settings) return null;

  return (
    <div className="border border-border bg-card">
      <div className="border-b border-border p-4">
        <h2 className="font-semibold">Authentication</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Control how new OIDC sign-ins are provisioned
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
            disabled={isSavingAutoCreate}
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
              disabled={isSavingGroup}
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
      </div>
    </div>
  );
}
