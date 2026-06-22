import { Save } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/pages/settings/StatusPageSection";
import type { StatusPageConfig, StatusPageIncidentSeverity } from "@/types";

interface StatusPageSettingsTabProps {
  config: StatusPageConfig;
  canManage: boolean;
  saving: boolean;
  onConfigChange: Dispatch<SetStateAction<StatusPageConfig>>;
  onSave: (patch: Partial<StatusPageConfig>) => void;
}

export function StatusPageSettingsTab({
  config,
  canManage,
  saving,
  onConfigChange,
  onSave,
}: StatusPageSettingsTabProps) {
  const disabled = !canManage || saving;
  const setSeverity = (key: "autoDegradedSeverity" | "autoOutageSeverity") => (value: string) => {
    const severity = value as StatusPageIncidentSeverity;
    onConfigChange((prev) => ({ ...prev, [key]: severity }));
  };

  const saveSettings = () => {
    onSave({
      title: config.title,
      description: config.description,
      recentIncidentDays: config.recentIncidentDays,
      publicIncidentLimit: config.publicIncidentLimit,
      autoDegradedEnabled: config.autoDegradedEnabled,
      autoOutageEnabled: config.autoOutageEnabled,
      autoDegradedSeverity: config.autoDegradedSeverity,
      autoOutageSeverity: config.autoOutageSeverity,
      autoCreateThresholdSeconds: config.autoCreateThresholdSeconds,
      autoResolveThresholdSeconds: config.autoResolveThresholdSeconds,
    });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-sm font-semibold">General Settings</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Configure public copy and recent incident visibility.
            </p>
          </div>
          {canManage && (
            <Button onClick={saveSettings} disabled={saving}>
              <Save className="h-4 w-4" />
              Save
            </Button>
          )}
        </div>
        <div className="grid gap-4 p-4">
          <Field label="Public title">
            <Input
              value={config.title}
              disabled={disabled}
              onChange={(event) =>
                onConfigChange((prev) => ({ ...prev, title: event.target.value }))
              }
            />
          </Field>
          <Field label="Public description">
            <Textarea
              value={config.description}
              disabled={disabled}
              onChange={(event) =>
                onConfigChange((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Recent resolved incident days">
              <Input
                type="number"
                min={1}
                max={365}
                value={config.recentIncidentDays}
                disabled={disabled}
                onChange={(event) =>
                  onConfigChange((prev) => ({
                    ...prev,
                    recentIncidentDays: Number(event.target.value),
                  }))
                }
              />
            </Field>
            <Field label="Public incident limit">
              <Input
                type="number"
                min={1}
                max={100}
                value={config.publicIncidentLimit}
                disabled={disabled}
                onChange={(event) =>
                  onConfigChange((prev) => ({
                    ...prev,
                    publicIncidentLimit: Number(event.target.value),
                  }))
                }
              />
            </Field>
          </div>
        </div>
      </div>

      <div className="border border-border bg-card">
        <div className="border-b border-border p-4">
          <h2 className="text-sm font-semibold">Auto-Incident Settings</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Configure automatic incident creation and severity defaults.
          </p>
        </div>
        <div className="divide-y divide-border">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Auto incidents for degraded services</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Create an automatic incident when an exposed service is degraded.
              </p>
            </div>
            <Switch
              checked={config.autoDegradedEnabled}
              disabled={disabled}
              onChange={(autoDegradedEnabled) =>
                onConfigChange((prev) => ({ ...prev, autoDegradedEnabled }))
              }
            />
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Degraded incident severity</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Severity used for automatic degraded-service incidents.
              </p>
            </div>
            <Select
              value={config.autoDegradedSeverity}
              disabled={disabled || !config.autoDegradedEnabled}
              onValueChange={setSeverity("autoDegradedSeverity")}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Auto incidents for outages</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Create an automatic incident when an exposed service is offline.
              </p>
            </div>
            <Switch
              checked={config.autoOutageEnabled}
              disabled={disabled}
              onChange={(autoOutageEnabled) =>
                onConfigChange((prev) => ({ ...prev, autoOutageEnabled }))
              }
            />
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3 xl:border-b xl:border-border">
            <div>
              <p className="text-sm font-medium">Outage incident severity</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Severity used for automatic outage incidents.
              </p>
            </div>
            <Select
              value={config.autoOutageSeverity}
              disabled={disabled || !config.autoOutageEnabled}
              onValueChange={setSeverity("autoOutageSeverity")}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 px-4 py-3 sm:grid-cols-2">
            <Field label="Create incident after seconds">
              <Input
                type="number"
                min={30}
                max={86400}
                value={config.autoCreateThresholdSeconds}
                disabled={disabled}
                onChange={(event) =>
                  onConfigChange((prev) => ({
                    ...prev,
                    autoCreateThresholdSeconds: Number(event.target.value),
                  }))
                }
              />
            </Field>
            <Field label="Resolve incident after seconds">
              <Input
                type="number"
                min={30}
                max={86400}
                value={config.autoResolveThresholdSeconds}
                disabled={disabled}
                onChange={(event) =>
                  onConfigChange((prev) => ({
                    ...prev,
                    autoResolveThresholdSeconds: Number(event.target.value),
                  }))
                }
              />
            </Field>
          </div>
        </div>
      </div>
    </div>
  );
}
