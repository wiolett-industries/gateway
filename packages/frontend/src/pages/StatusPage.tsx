import {
  CheckCircle2,
  ExternalLink,
  Eye,
  MoreVertical,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRealtime } from "@/hooks/use-realtime";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type {
  DatabaseConnection,
  Node,
  ProxyHost,
  StatusPageConfig,
  StatusPageIncident,
  StatusPageIncidentSeverity,
  StatusPageIncidentUpdateStatus,
  StatusPageServiceItem,
} from "@/types";
import {
  Field,
  getStatusPreviewUrl,
  IncidentDialog,
  ServiceDialog,
  statusBadge,
} from "./settings/StatusPageSection";

const TABS = [
  { value: "services", label: "Exposed Services" },
  { value: "incidents", label: "Incidents" },
  { value: "settings", label: "Settings" },
] as const;

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

function incidentStatusLabel(status: StatusPageIncidentUpdateStatus) {
  return {
    update: "Info",
    investigating: "Investigating",
    identified: "Identified",
    monitoring: "Monitoring",
    resolved: "Resolved",
  }[status];
}

function displayIncidentUpdateStatus(
  incident: StatusPageIncident,
  update: StatusPageIncident["updates"][number],
  index: number
) {
  if (index === 0 && update.status === "investigating" && update.message === incident.message) {
    return "update";
  }
  return update.status;
}

function incidentSeverityBorderColor(severity: StatusPageIncidentSeverity) {
  if (severity === "critical") return "#f87171";
  if (severity === "warning") return "#eab308";
  return "#60a5fa";
}

function incidentUpdateMarkerClass(status: StatusPageIncidentUpdateStatus) {
  return {
    update: "bg-muted-foreground",
    investigating: "rotate-45 bg-amber-500",
    identified: "rotate-45 bg-blue-500",
    monitoring: "bg-emerald-500",
    resolved: "rounded-full bg-emerald-500",
  }[status];
}

function IncidentUpdateMarker({ status }: { status: StatusPageIncidentUpdateStatus }) {
  return (
    <span aria-hidden="true" className={`block h-2 w-2 ${incidentUpdateMarkerClass(status)}`} />
  );
}

function affectedServices(incident: StatusPageIncident, services: StatusPageServiceItem[]) {
  const byId = new Map(services.map((service) => [service.id, service]));
  return incident.affectedServiceIds
    .map((id) => byId.get(id))
    .filter((service): service is StatusPageServiceItem => Boolean(service));
}

export function StatusPage() {
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const canView = hasScope("status-page:view");
  const canManage = hasScope("status-page:manage");
  const canCreateIncidents = hasScope("status-page:incidents:create");
  const canUpdateIncidents = hasScope("status-page:incidents:update");
  const canResolveIncidents = hasScope("status-page:incidents:resolve");
  const canDeleteIncidents = hasScope("status-page:incidents:delete");
  const activeTab = tabParam && TABS.some((tab) => tab.value === tabParam) ? tabParam : "services";

  const [config, setConfig] = useState<StatusPageConfig>(DEFAULT_CONFIG);
  const [services, setServices] = useState<StatusPageServiceItem[]>([]);
  const [incidents, setIncidents] = useState<StatusPageIncident[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [proxies, setProxies] = useState<ProxyHost[]>([]);
  const [databases, setDatabases] = useState<DatabaseConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [editingService, setEditingService] = useState<StatusPageServiceItem | null>(null);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [editingIncident, setEditingIncident] = useState<StatusPageIncident | null>(null);
  const [updateIncident, setUpdateIncident] = useState<StatusPageIncident | null>(null);

  const loadStatusPage = useCallback(async () => {
    try {
      const [settings, serviceRows, incidentRows] = await Promise.all([
        api.getStatusPageSettings(),
        api.listStatusPageServices(),
        api.listStatusPageIncidents({ status: "all", limit: 50 }),
      ]);
      setConfig(settings);
      setServices(serviceRows);
      setIncidents(incidentRows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load status page");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatusPage();
    Promise.all([
      api.listNodes({ limit: 100 }).then((res) => setNodes(res.data ?? [])),
      api.listProxyHosts({ limit: 100 }).then((res) => setProxies(res.data ?? [])),
      api.listDatabases({ limit: 200 }).then((res) => setDatabases(res.data ?? [])),
    ]).catch(() => {});
  }, [loadStatusPage]);

  useRealtime("status-page.changed", () => {
    loadStatusPage();
  });

  useEffect(() => {
    if (!tabParam || !TABS.some((tab) => tab.value === tabParam)) {
      navigate(`/status-page/${activeTab}`, { replace: true });
    }
  }, [activeTab, navigate, tabParam]);

  const groupedServices = useMemo(() => {
    const map = new Map<string, StatusPageServiceItem[]>();
    for (const service of services) {
      const group = service.publicGroup || "Ungrouped";
      map.set(group, [...(map.get(group) ?? []), service]);
    }
    return Array.from(map.entries());
  }, [services]);

  if (!canView) return <Navigate to="/" replace />;

  const openCreateService = () => {
    if (!canManage) return;
    setEditingService(null);
    setServiceOpen(true);
  };

  const deleteService = async (service: StatusPageServiceItem) => {
    if (!canManage) return;
    const ok = await confirm({
      title: "Remove exposed service",
      description: `Remove "${service.publicName}" from the public status page?`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    try {
      await api.deleteStatusPageService(service.id);
      toast.success("Service removed");
      loadStatusPage();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove service");
    }
  };

  const openCreateIncident = () => {
    if (!canCreateIncidents) return;
    setEditingIncident(null);
    setIncidentOpen(true);
  };

  const updateConfig = async (patch: Partial<StatusPageConfig>) => {
    if (!canManage) return;
    setSavingConfig(true);
    try {
      const updated = await api.updateStatusPageSettings(patch);
      setConfig(updated);
      toast.success("Status page details updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update status page details");
      loadStatusPage();
    } finally {
      setSavingConfig(false);
    }
  };

  const resolveIncident = async (incident: StatusPageIncident) => {
    if (!canResolveIncidents) return;
    try {
      await api.resolveStatusPageIncident(incident.id);
      toast.success("Incident resolved");
      loadStatusPage();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resolve incident");
    }
  };

  const promoteIncident = async (incident: StatusPageIncident) => {
    if (!canCreateIncidents) return;
    try {
      await api.promoteStatusPageIncident(incident.id);
      toast.success("Incident is now manually managed");
      loadStatusPage();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update incident");
    }
  };

  const deleteIncident = async (incident: StatusPageIncident) => {
    if (!canDeleteIncidents) return;
    const ok = await confirm({
      title: "Delete past incident",
      description: `Delete "${incident.title}" and its timeline from the status page?`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.deleteStatusPageIncident(incident.id);
      toast.success("Incident deleted");
      loadStatusPage();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete incident");
    }
  };

  const headerAction =
    activeTab === "services" && canManage ? (
      <Button onClick={openCreateService}>
        <Plus className="h-4 w-4" />
        Expose Service
      </Button>
    ) : activeTab === "incidents" && canCreateIncidents ? (
      <Button onClick={openCreateIncident}>
        <Plus className="h-4 w-4" />
        Create Incident
      </Button>
    ) : activeTab === "settings" ? (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onClick={() => window.open(getStatusPreviewUrl(), "_blank", "noopener,noreferrer")}
        >
          <Eye className="h-4 w-4" />
          Preview
        </Button>
        {config.domain && (
          <Button
            variant="outline"
            onClick={() =>
              window.open(
                `${config.sslCertificateId ? "https" : "http"}://${config.domain}`,
                "_blank",
                "noopener,noreferrer"
              )
            }
          >
            <ExternalLink className="h-4 w-4" />
            Open
          </Button>
        )}
      </div>
    ) : null;

  return (
    <PageTransition>
      <div className="h-full space-y-4 overflow-y-auto p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Status Page</h1>
              <Badge variant={config.enabled ? "success" : "secondary"}>
                {config.enabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Manage public services and incident communication
            </p>
          </div>
          {headerAction}
        </div>

        {!config.enabled && !loading && (
          <div className="border border-border bg-card p-4">
            <p className="text-sm font-medium">Status page is disabled</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Enable it and configure the domain in Settings before publishing services or
              incidents.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => navigate("/settings")}
            >
              Open Settings
            </Button>
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(value) => navigate(`/status-page/${value}`, { replace: true })}
        >
          <TabsList className="shrink-0">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="services">
            <ServicesTab
              groupedServices={groupedServices}
              canManage={canManage}
              onEdit={(service) => {
                setEditingService(service);
                setServiceOpen(true);
              }}
              onDelete={deleteService}
            />
          </TabsContent>

          <TabsContent value="incidents">
            <IncidentsTab
              incidents={incidents}
              services={services}
              canCreate={canCreateIncidents}
              canUpdate={canUpdateIncidents}
              canResolve={canResolveIncidents}
              canDelete={canDeleteIncidents}
              onEdit={(incident) => {
                setEditingIncident(incident);
                setIncidentOpen(true);
              }}
              onUpdate={setUpdateIncident}
              onResolve={resolveIncident}
              onPromote={promoteIncident}
              onDelete={deleteIncident}
            />
          </TabsContent>

          <TabsContent value="settings">
            <SettingsTab
              config={config}
              canManage={canManage}
              saving={savingConfig}
              onConfigChange={setConfig}
              onSave={updateConfig}
            />
          </TabsContent>
        </Tabs>

        <ServiceDialog
          open={serviceOpen}
          onOpenChange={setServiceOpen}
          service={editingService}
          services={services}
          nodes={nodes}
          proxies={proxies}
          databases={databases}
          onSaved={loadStatusPage}
        />
        <IncidentDialog
          open={incidentOpen}
          onOpenChange={setIncidentOpen}
          incident={editingIncident}
          services={services}
          onSaved={loadStatusPage}
        />
        <IncidentUpdateDialog
          incident={updateIncident}
          onOpenChange={(open) => {
            if (!open) setUpdateIncident(null);
          }}
          onSaved={loadStatusPage}
        />
      </div>
    </PageTransition>
  );
}

function SettingsTab({
  config,
  canManage,
  saving,
  onConfigChange,
  onSave,
}: {
  config: StatusPageConfig;
  canManage: boolean;
  saving: boolean;
  onConfigChange: Dispatch<SetStateAction<StatusPageConfig>>;
  onSave: (patch: Partial<StatusPageConfig>) => void;
}) {
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
            <Button size="sm" onClick={saveSettings} disabled={saving}>
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
            <textarea
              value={config.description}
              disabled={disabled}
              onChange={(event) =>
                onConfigChange((prev) => ({ ...prev, description: event.target.value }))
              }
              className="min-h-20 w-full border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
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
        </div>
      </div>
    </div>
  );
}

function ServicesTab({
  groupedServices,
  canManage,
  onEdit,
  onDelete,
}: {
  groupedServices: Array<[string, StatusPageServiceItem[]]>;
  canManage: boolean;
  onEdit: (service: StatusPageServiceItem) => void;
  onDelete: (service: StatusPageServiceItem) => void;
}) {
  if (groupedServices.length === 0) {
    return (
      <div className="border border-border bg-card p-4 text-sm text-muted-foreground">
        No services exposed.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groupedServices.map(([group, services]) => (
        <div key={group} className="border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">{group}</h2>
          </div>
          <div className="divide-y divide-border">
            {services.map((service) => (
              <div key={service.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{service.publicName}</p>
                    <Badge variant={statusBadge(service.currentStatus) as never}>
                      {service.currentStatus}
                    </Badge>
                    {!service.enabled && <Badge variant="secondary">Hidden</Badge>}
                    {service.broken && <Badge variant="warning">Source missing</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {service.source?.label || "Missing source"} · create after{" "}
                    {service.createThresholdSeconds}s · resolve after{" "}
                    {service.resolveThresholdSeconds}s
                  </p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" onClick={() => onEdit(service)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => onDelete(service)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function IncidentsTab({
  incidents,
  services,
  canCreate,
  canUpdate,
  canResolve,
  canDelete,
  onEdit,
  onUpdate,
  onResolve,
  onPromote,
  onDelete,
}: {
  incidents: StatusPageIncident[];
  services: StatusPageServiceItem[];
  canCreate: boolean;
  canUpdate: boolean;
  canResolve: boolean;
  canDelete: boolean;
  onEdit: (incident: StatusPageIncident) => void;
  onUpdate: (incident: StatusPageIncident) => void;
  onResolve: (incident: StatusPageIncident) => void;
  onPromote: (incident: StatusPageIncident) => void;
  onDelete: (incident: StatusPageIncident) => void;
}) {
  if (incidents.length === 0) {
    return (
      <div className="border border-border bg-card p-4 text-sm text-muted-foreground">
        No incidents.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {incidents.map((incident) => {
        const affected = affectedServices(incident, services);
        const canPromoteIncident =
          canCreate && incident.type === "automatic" && incident.autoManaged;
        const canResolveIncident = canResolve && incident.status === "active";
        const canDeleteIncident = canDelete && incident.status === "resolved";
        const hasPrimaryActions = canPromoteIncident || canUpdate;
        const hasActions =
          canPromoteIncident || canUpdate || canResolveIncident || canDeleteIncident;
        const events = incident.updates?.length
          ? incident.updates
          : [
              {
                id: `${incident.id}:initial`,
                status: "update" as const,
                message: incident.message,
                createdAt: incident.startedAt,
              },
            ];
        return (
          <div
            key={incident.id}
            className="border border-l-4 border-border bg-card"
            style={
              incident.status === "active"
                ? { borderLeftColor: incidentSeverityBorderColor(incident.severity) }
                : undefined
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="flex min-h-7 flex-wrap items-center gap-2">
                  <Badge
                    variant={statusBadge(incident.severity) as never}
                    className="min-h-7 px-2.5 py-1.5 text-[12px]"
                  >
                    {incident.severity}
                  </Badge>
                  <Badge
                    variant={incident.status === "active" ? "warning" : "secondary"}
                    className="min-h-7 px-2.5 py-1.5 text-[12px]"
                  >
                    {incident.status}
                  </Badge>
                  {incident.type === "automatic" && (
                    <Badge variant="secondary" className="min-h-7 px-2.5 py-1.5 text-[12px]">
                      AUTO
                    </Badge>
                  )}
                  <h2 className="m-0 translate-y-px text-base font-medium leading-none">
                    {incident.title}
                  </h2>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-xs text-muted-foreground">
                  {new Date(incident.startedAt).toLocaleString()}
                </span>
                {hasActions && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" aria-label="Incident actions">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canPromoteIncident && (
                        <DropdownMenuItem onClick={() => onPromote(incident)}>
                          <ShieldCheck className="h-4 w-4" />
                          Promote
                        </DropdownMenuItem>
                      )}
                      {canUpdate && (
                        <>
                          <DropdownMenuItem onClick={() => onUpdate(incident)}>
                            <Plus className="h-4 w-4" />
                            Post Update
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onEdit(incident)}>
                            <Pencil className="h-4 w-4" />
                            Edit Details
                          </DropdownMenuItem>
                        </>
                      )}
                      {canResolveIncident && (
                        <>
                          {hasPrimaryActions && <DropdownMenuSeparator />}
                          <DropdownMenuItem onClick={() => onResolve(incident)}>
                            <CheckCircle2 className="h-4 w-4" />
                            Resolve
                          </DropdownMenuItem>
                        </>
                      )}
                      {canDeleteIncident && (
                        <>
                          {hasPrimaryActions && <DropdownMenuSeparator />}
                          <DropdownMenuItem
                            onClick={() => onDelete(incident)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            <div className="border-t border-border p-4">
              <p className="text-xs font-medium text-muted-foreground">Affected services</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {affected.length > 0 ? (
                  affected.map((service) => (
                    <span
                      key={service.id}
                      className="border border-border bg-muted px-2 py-1 text-xs text-muted-foreground"
                    >
                      {service.publicName}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">
                    No affected services selected
                  </span>
                )}
              </div>
            </div>

            <div className="border-t border-border p-4">
              <p className="text-xs font-medium text-muted-foreground">Timeline</p>
              <div className="mt-3 space-y-6">
                {events.map((update, index) => {
                  const displayStatus = displayIncidentUpdateStatus(incident, update, index);
                  const showConnector = index < events.length - 1 || incident.status === "active";
                  return (
                    <div
                      key={update.id}
                      className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-3"
                    >
                      {showConnector && (
                        <span
                          className={`absolute left-[10px] top-[19px] w-px bg-border ${
                            index === events.length - 1 ? "bottom-[3px]" : "-bottom-[21px]"
                          }`}
                        />
                      )}
                      <span className="relative top-[-3px] z-10 flex h-[22px] w-[22px] items-center justify-center">
                        <IncidentUpdateMarker status={displayStatus} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{new Date(update.createdAt).toLocaleString()}</span>
                          <span className="font-medium text-foreground">
                            {incidentStatusLabel(displayStatus)}
                          </span>
                        </div>
                        <p className="mt-1 text-[0.94rem] leading-6">{update.message}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IncidentUpdateDialog({
  incident,
  onOpenChange,
  onSaved,
}: {
  incident: StatusPageIncident | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<StatusPageIncidentUpdateStatus>("update");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!incident) return;
    setStatus("update");
    setMessage("");
  }, [incident]);

  const save = async () => {
    if (!incident) return;
    try {
      await api.createStatusPageIncidentUpdate(incident.id, {
        status,
        message: message.trim(),
      });
      toast.success("Incident update posted");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post incident update");
    }
  };

  return (
    <Dialog open={Boolean(incident)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Post Incident Update</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Event state">
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as StatusPageIncidentUpdateStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="update">Update</SelectItem>
                <SelectItem value="investigating">Investigating</SelectItem>
                <SelectItem value="identified">Identified</SelectItem>
                <SelectItem value="monitoring">Monitoring</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Message">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="min-h-28 w-full border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!message.trim()}>
            Post Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
