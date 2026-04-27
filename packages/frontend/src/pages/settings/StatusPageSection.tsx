import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useRealtime } from "@/hooks/use-realtime";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type {
  DatabaseConnection,
  DockerContainer,
  Node,
  ProxyHost,
  SSLCertificate,
  StatusPageConfig,
  StatusPageIncident,
  StatusPageIncidentSeverity,
  StatusPageProxyTemplateOption,
  StatusPageServiceItem,
  StatusPageSourceType,
} from "@/types";

interface StatusPageSectionProps {
  nodesList: Node[];
}

type ServiceSourceType = StatusPageSourceType | "docker";

const DEFAULT_CONFIG: StatusPageConfig = {
  enabled: false,
  title: "System Status",
  description: "",
  domain: "",
  nodeId: null,
  sslCertificateId: null,
  proxyTemplateId: null,
  upstreamUrl: null,
  proxyHostId: null,
  publicIncidentLimit: 25,
  recentIncidentDays: 14,
  autoDegradedEnabled: true,
  autoOutageEnabled: true,
  autoDegradedSeverity: "warning",
  autoOutageSeverity: "critical",
};

export function statusBadge(status: string) {
  if (status === "operational" || status === "online") return "success";
  if (status === "info") return "info";
  if (status === "degraded" || status === "warning") return "warning";
  if (status === "outage" || status === "offline" || status === "critical") return "destructive";
  return "secondary";
}

export function getStatusPreviewUrl() {
  if (!import.meta.env.DEV) return "/_status-preview/";
  const url = new URL(window.location.href);
  url.port = "5174";
  url.pathname = "/_status-preview/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function StatusPageSection({ nodesList }: StatusPageSectionProps) {
  const { hasScope } = useAuthStore();
  const canManage = hasScope("status-page:manage");
  const [config, setConfig] = useState<StatusPageConfig>(DEFAULT_CONFIG);
  const [sslCerts, setSslCerts] = useState<SSLCertificate[]>([]);
  const [proxyTemplates, setProxyTemplates] = useState<StatusPageProxyTemplateOption[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);

  const onlineNginxNodes = useMemo(
    () => nodesList.filter((node) => node.type === "nginx" && node.status === "online"),
    [nodesList]
  );

  const loadStatusPage = useCallback(async () => {
    try {
      const settings = await api.getStatusPageSettings();
      setConfig(settings);
    } catch {
      /* optional feature; ignore until user opens it */
    }
  }, []);

  const loadProxyTemplates = useCallback(async () => {
    try {
      setProxyTemplates(await api.listStatusPageProxyTemplates());
    } catch {
      setProxyTemplates([]);
    }
  }, []);

  useEffect(() => {
    loadStatusPage();
    loadProxyTemplates();
    api
      .listSSLCertificates({ limit: 100 })
      .then((res) => setSslCerts(res.data ?? []))
      .catch(() => {});
  }, [loadProxyTemplates, loadStatusPage]);

  useRealtime("status-page.changed", () => {
    loadStatusPage();
  });
  useRealtime("nginx.template.changed", () => {
    loadProxyTemplates();
  });

  const updateConfig = async (patch: Partial<StatusPageConfig>) => {
    if (!canManage) return;
    setSavingSettings(true);
    try {
      const updated = await api.updateStatusPageSettings(patch);
      setConfig(updated);
      toast.success("Status page settings updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update status page");
      loadStatusPage();
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Status Page</h2>
            <Badge variant={config.enabled ? "success" : "secondary"}>
              {config.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Enable the public status page and configure its custom domain
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={config.enabled}
            disabled={!canManage || savingSettings}
            onChange={(enabled) => updateConfig({ enabled })}
          />
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Domain">
            <Input
              value={config.domain}
              disabled={!canManage}
              placeholder="status.example.com"
              onChange={(event) => setConfig((prev) => ({ ...prev, domain: event.target.value }))}
              onBlur={() => updateConfig({ domain: config.domain })}
            />
          </Field>
          <Field label="Gateway upstream URL">
            <Input
              value={config.upstreamUrl ?? ""}
              disabled={!canManage}
              placeholder="http://172.16.20.60:3000"
              onChange={(event) =>
                setConfig((prev) => ({ ...prev, upstreamUrl: event.target.value }))
              }
              onBlur={() =>
                updateConfig({
                  upstreamUrl: config.upstreamUrl?.trim() ? config.upstreamUrl.trim() : null,
                })
              }
            />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Nginx node">
            <Select
              value={config.nodeId ?? ""}
              disabled={!canManage || config.enabled || savingSettings}
              onValueChange={(nodeId) => updateConfig({ nodeId })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select an online nginx node" />
              </SelectTrigger>
              <SelectContent>
                {onlineNginxNodes.map((node) => (
                  <SelectItem key={node.id} value={node.id} disabled={node.serviceCreationLocked}>
                    {node.displayName || node.hostname}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="SSL certificate">
            <Select
              value={config.sslCertificateId ?? "__none__"}
              disabled={!canManage}
              onValueChange={(sslCertificateId) =>
                updateConfig({
                  sslCertificateId: sslCertificateId === "__none__" ? null : sslCertificateId,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No certificate</SelectItem>
                {sslCerts
                  .filter((cert) => cert.status === "active")
                  .map((cert) => (
                    <SelectItem key={cert.id} value={cert.id}>
                      {cert.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Proxy template" className="md:col-span-2 xl:col-span-1">
            <Select
              value={config.proxyTemplateId ?? "__default__"}
              disabled={!canManage}
              onValueChange={(proxyTemplateId) =>
                updateConfig({
                  proxyTemplateId: proxyTemplateId === "__default__" ? null : proxyTemplateId,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Default template</SelectItem>
                {proxyTemplates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function ServiceDialog({
  open,
  onOpenChange,
  service,
  services,
  nodes,
  proxies,
  databases,
  dockerTargets = [],
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: StatusPageServiceItem | null;
  services: StatusPageServiceItem[];
  nodes: Node[];
  proxies: ProxyHost[];
  databases: DatabaseConnection[];
  dockerTargets?: DockerContainer[];
  onSaved: () => void;
}) {
  const [sourceType, setSourceType] = useState<ServiceSourceType>("proxy_host");
  const [sourceId, setSourceId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [group, setGroup] = useState("");
  const [createThreshold, setCreateThreshold] = useState(600);
  const [resolveThreshold, setResolveThreshold] = useState(60);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    setSourceType(
      service?.sourceType?.startsWith("docker_") ? "docker" : (service?.sourceType ?? "proxy_host")
    );
    setSourceId(service?.sourceId ?? "");
    setName(service?.publicName ?? "");
    setDescription(service?.publicDescription ?? "");
    setGroup(service?.publicGroup ?? "");
    setCreateThreshold(service?.createThresholdSeconds ?? 600);
    setResolveThreshold(service?.resolveThresholdSeconds ?? 60);
    setEnabled(service?.enabled ?? true);
  }, [open, service]);

  const sourceOptions = useMemo(() => {
    const exposed = new Set(
      services.filter((item) => item.id !== service?.id).map((item) => item.sourceId)
    );
    if (sourceType === "node") {
      return nodes.map((node) => ({ id: node.id, label: node.displayName || node.hostname }));
    }
    if (sourceType === "database") {
      return databases.map((database) => ({ id: database.id, label: database.name }));
    }
    if (sourceType === "docker") {
      return dockerTargets.flatMap((item) => {
        if (item.kind === "deployment") {
          if (!item.deploymentId || !item.healthCheckEnabled || exposed.has(item.deploymentId)) {
            return [];
          }
          return [
            { id: `docker_deployment:${item.deploymentId}`, label: `Deployment: ${item.name}` },
          ];
        }
        if (!item.healthCheckId || !item.healthCheckEnabled || exposed.has(item.healthCheckId)) {
          return [];
        }
        return [{ id: `docker_container:${item.healthCheckId}`, label: `Container: ${item.name}` }];
      });
    }
    return proxies
      .filter((proxy) => proxy.healthCheckEnabled && !proxy.isSystem && !exposed.has(proxy.id))
      .map((proxy) => ({ id: proxy.id, label: proxy.domainNames[0] || proxy.id }));
  }, [databases, dockerTargets, nodes, proxies, service?.id, services, sourceType]);

  const save = async () => {
    try {
      const payload = {
        publicName: name.trim(),
        publicDescription: description.trim() || null,
        publicGroup: group.trim() || null,
        createThresholdSeconds: createThreshold,
        resolveThresholdSeconds: resolveThreshold,
        enabled,
      };
      if (service) {
        await api.updateStatusPageService(service.id, payload);
        toast.success("Exposed service updated");
      } else {
        const [resolvedSourceType, ...resolvedSourceIdParts] =
          sourceType === "docker" ? sourceId.split(":") : [sourceType, sourceId];
        await api.createStatusPageService({
          ...payload,
          sourceType: resolvedSourceType as StatusPageSourceType,
          sourceId: resolvedSourceIdParts.join(":"),
        });
        toast.success("Service exposed");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save service");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{service ? "Edit Exposed Service" : "Expose Service"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!service && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Source type">
                <Select
                  value={sourceType}
                  onValueChange={(value) => {
                    setSourceType(value as ServiceSourceType);
                    setSourceId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="node">Node</SelectItem>
                    <SelectItem value="proxy_host">Proxy Host</SelectItem>
                    <SelectItem value="database">Database</SelectItem>
                    <SelectItem value="docker">Docker</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Source">
                <Select value={sourceId} onValueChange={setSourceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {sourceOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}
          <Field label="Public name">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Public description">
            <Input value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label="Group">
            <Input value={group} onChange={(event) => setGroup(event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Create threshold seconds">
              <Input
                type="number"
                value={createThreshold}
                onChange={(event) => setCreateThreshold(Number(event.target.value))}
              />
            </Field>
            <Field label="Resolve threshold seconds">
              <Input
                type="number"
                value={resolveThreshold}
                onChange={(event) => setResolveThreshold(Number(event.target.value))}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between border border-border p-3">
            <span className="text-sm font-medium">Visible on public page</span>
            <Switch checked={enabled} onChange={setEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!name.trim() || (!service && !sourceId)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IncidentDialog({
  open,
  onOpenChange,
  incident,
  services,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incident: StatusPageIncident | null;
  services: StatusPageServiceItem[];
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<StatusPageIncidentSeverity>("warning");
  const [affectedServiceIds, setAffectedServiceIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setTitle(incident?.title ?? "");
    setMessage(incident?.message ?? "");
    setSeverity(incident?.severity ?? "warning");
    setAffectedServiceIds(incident?.affectedServiceIds ?? []);
  }, [incident, open]);

  const save = async () => {
    try {
      const payload = {
        title: title.trim(),
        message: message.trim(),
        severity,
        affectedServiceIds,
      };
      if (incident) {
        await api.updateStatusPageIncident(incident.id, payload);
        toast.success("Incident updated");
      } else {
        await api.createStatusPageIncident(payload);
        toast.success("Incident created");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save incident");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{incident ? "Edit Incident Details" : "Create Incident"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Title">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Message">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="min-h-28 w-full border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </Field>
          <Field label="Severity">
            <Select value={severity} onValueChange={(value) => setSeverity(value as never)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="max-h-48 space-y-2 overflow-y-auto border border-border p-3">
            {services.map((service) => (
              <label key={service.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={affectedServiceIds.includes(service.id)}
                  onChange={(event) =>
                    setAffectedServiceIds((prev) =>
                      event.target.checked
                        ? [...prev, service.id]
                        : prev.filter((id) => id !== service.id)
                    )
                  }
                />
                {service.publicName}
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!title.trim() || !message.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
