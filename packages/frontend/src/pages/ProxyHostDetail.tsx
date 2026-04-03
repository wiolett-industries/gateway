import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Minus, Pencil, Pin, Plus, RefreshCw, Save, Server, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { PageTransition } from "@/components/common/PageTransition";
import { CreateProxyHostDialog } from "@/components/proxy/CreateProxyHostDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HealthBars } from "@/components/ui/health-bars";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { usePinnedProxiesStore } from "@/stores/pinned-proxies";
import type { AccessList, CustomHeader, ProxyHost, RewriteRule } from "@/types";

// ── Health badge mapping ────────────────────────────────────────
const HEALTH_BADGE: Record<
  string,
  "success" | "destructive" | "secondary" | "default" | "warning"
> = {
  online: "success",
  recovering: "warning",
  offline: "destructive",
  degraded: "destructive",
  unknown: "secondary",
  disabled: "secondary",
};

const HEALTH_LABEL: Record<string, string> = {
  online: "Healthy",
  recovering: "Recovering",
  offline: "Offline",
  degraded: "Degraded",
  unknown: "Unknown",
  disabled: "Disabled",
};

/** Compute effective status: if currently online but had errors in last 5 min, show "recovering" */
function effectiveHealthStatus(host: {
  healthStatus: string;
  healthHistory?: Array<{ ts: string; status: string }>;
}): string {
  if (host.healthStatus !== "online" || !host.healthHistory?.length) return host.healthStatus;
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const recent = host.healthHistory.filter((h) => new Date(h.ts).getTime() >= fiveMinAgo);
  if (recent.some((h) => h.status === "offline" || h.status === "degraded")) return "recovering";
  return "online";
}

const TYPE_BADGE: Record<string, "default" | "secondary" | "destructive"> = {
  proxy: "default",
  redirect: "secondary",
  "404": "secondary",
  raw: "destructive",
};

// ── Main Component ──────────────────────────────────────────────
export function ProxyHostDetail() {
  const { id, tab: tabParam } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();

  const [host, setHost] = useState<ProxyHost | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const VALID_TABS = ["details", "settings", "advanced", "raw", "logs"];
  const activeTab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : "details";
  const setActiveTab = (tab: string) => navigate(`/proxy-hosts/${id}/${tab}`, { replace: true });

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);

  // Pin dialog
  const [pinOpen, setPinOpen] = useState(false);
  const { isPinnedDashboard, isPinnedSidebar, toggleDashboard, toggleSidebar } =
    usePinnedProxiesStore();

  // Custom config tab state
  const [customHeaders, setCustomHeaders] = useState<CustomHeader[]>([]);
  const [cacheEnabled, setCacheEnabled] = useState(false);
  const [cacheMaxAge, setCacheMaxAge] = useState(3600);
  const [rateLimitEnabled, setRateLimitEnabled] = useState(false);
  const [rateLimitRPS, setRateLimitRPS] = useState(100);
  const [rateLimitBurst, setRateLimitBurst] = useState(200);
  const [customRewrites, setCustomRewrites] = useState<RewriteRule[]>([]);
  const [isSavingCustom, setIsSavingCustom] = useState(false);
  const [editorErrorLines, setEditorErrorLines] = useState<number[]>([]);

  // Health check settings state
  const [healthCheckUrl, setHealthCheckUrl] = useState("/");
  const [healthCheckExpectedStatus, setHealthCheckExpectedStatus] = useState<number | null>(null);
  const [healthCheckExpectedBody, setHealthCheckExpectedBody] = useState("");
  // Access list tab state
  const [accessListId, setAccessListId] = useState<string>("");
  const [accessLists, setAccessLists] = useState<AccessList[]>([]);

  // Advanced tab state
  const [advancedConfig, setAdvancedConfig] = useState("");
  const [isSavingAdvanced, setIsSavingAdvanced] = useState(false);

  // Raw config tab state
  const [renderedConfig, setRenderedConfig] = useState("");
  const [rawConfig, setRawConfig] = useState("");
  const [isLoadingRaw, setIsLoadingRaw] = useState(false);
  const [isSavingRaw, setIsSavingRaw] = useState(false);

  // ── Load host ─────────────────────────────────────────────────
  const loadHost = useCallback(
    async (silent = false) => {
      if (!id) return;
      if (!silent) setIsLoading(true);
      try {
        const data = await api.getProxyHost(id);
        setHost(data);
        // Sync local state from host
        setCustomHeaders(data.customHeaders || []);
        setCacheEnabled(data.cacheEnabled);
        setCacheMaxAge(data.cacheOptions?.maxAge || 3600);
        setRateLimitEnabled(data.rateLimitEnabled);
        setRateLimitRPS(data.rateLimitOptions?.requestsPerSecond || 100);
        setRateLimitBurst(data.rateLimitOptions?.burst || 200);
        setCustomRewrites(data.customRewrites || []);
        setAccessListId(data.accessListId || "");
        setHealthCheckUrl(data.healthCheckUrl || "/");

        setHealthCheckExpectedStatus(data.healthCheckExpectedStatus ?? null);
        setHealthCheckExpectedBody(data.healthCheckExpectedBody || "");
        setAdvancedConfig(data.advancedConfig || "");
        setRawConfig(data.rawConfig || "");
      } catch {
        if (!silent) {
          toast.error("Failed to load proxy host");
          navigate("/proxy-hosts");
        }
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [id, navigate]
  );

  useEffect(() => {
    loadHost();
  }, [loadHost]);

  // ── Load access lists ─────────────────────────────────────────
  useEffect(() => {
    api
      .listAccessLists({ limit: 100 })
      .then((res) => setAccessLists(res.data || []))
      .catch(() => {});
  }, []);

  // ── Load rendered config ──────────────────────────────────────
  const loadRenderedConfig = useCallback(async () => {
    if (!id) return;
    setIsLoadingRaw(true);
    try {
      const result = await api.getRenderedProxyConfig(id);
      setRenderedConfig(result.rendered);
    } catch {
      setRenderedConfig("# Could not load rendered config.");
    } finally {
      setIsLoadingRaw(false);
    }
  }, [id]);

  // ── Toggle switch handler (immediate save) ────────────────────
  const handleToggle = useCallback(
    async (field: string, value: boolean) => {
      if (!id || !host) return;
      try {
        const updated = await api.updateProxyHost(id, { [field]: value } as any);
        setHost(updated);
        toast.success(
          `${field.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())} updated`
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update");
      }
    },
    [id, host]
  );

  // ── Save custom config ────────────────────────────────────────
  const handleSaveCustom = async () => {
    if (!id) return;
    setIsSavingCustom(true);
    try {
      const updated = await api.updateProxyHost(id, {
        customHeaders: customHeaders.filter((h) => h.name.trim() !== ""),
        cacheEnabled,
        cacheOptions: cacheEnabled ? { maxAge: cacheMaxAge } : undefined,
        rateLimitEnabled,
        rateLimitOptions: rateLimitEnabled
          ? { requestsPerSecond: rateLimitRPS, burst: rateLimitBurst }
          : undefined,
        customRewrites: customRewrites.filter((r) => r.source.trim() !== ""),
      });
      setHost(updated);
      toast.success("Custom config saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save custom config");
    } finally {
      setIsSavingCustom(false);
    }
  };

  // ── Save advanced config ──────────────────────────────────────
  const handleSaveAdvanced = async () => {
    if (!id) return;
    if (advancedConfig) {
      const valid = await handleValidate();
      if (!valid) return;
    }
    setIsSavingAdvanced(true);
    try {
      const updated = await api.updateProxyHost(id, {
        advancedConfig: advancedConfig || undefined,
      });
      setHost(updated);
      toast.success("Advanced config saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save advanced config");
    } finally {
      setIsSavingAdvanced(false);
    }
  };

  // ── Auto-save health check settings on change (debounced) ─────
  useEffect(() => {
    if (!id || !host || !hasHealthCheckChanged) return;
    const timer = setTimeout(() => {
      api
        .updateProxyHost(id, {
          healthCheckUrl,
          healthCheckExpectedStatus: healthCheckExpectedStatus ?? undefined,
          healthCheckExpectedBody: healthCheckExpectedBody || undefined,
        })
        .then((updated) => setHost(updated))
        .catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [healthCheckUrl, healthCheckExpectedStatus, healthCheckExpectedBody]);

  // ── Validate config — returns true if valid ──────────────────
  const handleValidate = async (): Promise<boolean> => {
    try {
      const configToValidate = isRawMode ? rawConfig : advancedConfig;
      const result = await api.validateProxyConfig(
        configToValidate,
        isRawMode ? "raw" : "advanced"
      );

      if (result.valid) {
        setEditorErrorLines([]);
        toast.success("Configuration is valid");
        return true;
      }

      // Parse line numbers from error messages and show individual toasts
      const lineNums: number[] = [];
      for (const err of result.errors ?? []) {
        toast.error(err);
        const match = err.match(/line (\d+)/i);
        if (match) lineNums.push(Number(match[1]));
      }
      setEditorErrorLines(lineNums);
      return false;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Validation failed");
      return false;
    }
  };

  // ── Save raw config ───────────────────────────────────────────
  const handleSaveRaw = async () => {
    if (!id) return;
    const valid = await handleValidate();
    if (!valid) return;
    setIsSavingRaw(true);
    try {
      const updated = await api.updateProxyHost(id, { rawConfig });
      setHost(updated);
      toast.success("Raw config saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save raw config");
    } finally {
      setIsSavingRaw(false);
    }
  };

  // ── Delete host ───────────────────────────────────────────────
  const handleDelete = async () => {
    if (!host) return;
    const ok = await confirm({
      title: "Delete Proxy Host",
      description: "Are you sure you want to delete this proxy host? This action cannot be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteProxyHost(host.id);
      api.invalidateCache();
      toast.success("Proxy host deleted");
      navigate("/proxy-hosts");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete proxy host");
    }
  };

  // ── Derived values ────────────────────────────────────────────
  const isRawMode = host?.rawConfigEnabled ?? false;
  const isSystemHost = host?.isSystem ?? false;

  // Track changes per section
  const hasHeadersChanged = useMemo(
    () => !!host && JSON.stringify(customHeaders) !== JSON.stringify(host.customHeaders || []),
    [host, customHeaders]
  );
  const hasRewritesChanged = useMemo(
    () => !!host && JSON.stringify(customRewrites) !== JSON.stringify(host.customRewrites || []),
    [host, customRewrites]
  );
  const hasHealthCheckChanged = useMemo(() => {
    if (!host) return false;
    return (
      healthCheckUrl !== (host.healthCheckUrl || "/") ||
      healthCheckExpectedStatus !== (host.healthCheckExpectedStatus ?? null) ||
      healthCheckExpectedBody !== (host.healthCheckExpectedBody || "")
    );
  }, [host, healthCheckUrl, healthCheckExpectedStatus, healthCheckExpectedBody]);

  const visibleTabs = ["details", "settings", "advanced", "raw", "logs"];

  // Navigate away from disabled tabs when raw mode changes
  useEffect(() => {
    if (isRawMode && (activeTab === "settings" || activeTab === "advanced")) {
      setActiveTab("details");
    }
  }, [isRawMode, activeTab]);

  // ── Loading state ─────────────────────────────────────────────
  if (isLoading || !host) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <PageTransition>
      <div
        className={cn(
          "h-full flex flex-col p-6 gap-4",
          activeTab === "raw" || activeTab === "advanced" || activeTab === "logs"
            ? "overflow-hidden"
            : "overflow-y-auto"
        )}
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/proxy-hosts")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{host.domainNames[0] || "Proxy Host"}</h1>
                <Badge variant={TYPE_BADGE[host.type] ?? "default"} className="capitalize">
                  {host.type}
                </Badge>
                {(() => {
                  const eff = effectiveHealthStatus(host);
                  return (
                    <Badge variant={HEALTH_BADGE[eff] ?? "secondary"}>
                      {HEALTH_LABEL[eff] ?? eff}
                    </Badge>
                  );
                })()}
              </div>
              <p className="text-sm text-muted-foreground">
                {host.domainNames.length > 1
                  ? `+${host.domainNames.length - 1} more domain${host.domainNames.length > 2 ? "s" : ""}`
                  : null}
                {host.type === "proxy" && host.forwardHost
                  ? ` \u2192 ${host.forwardScheme}://${host.forwardHost}:${host.forwardPort}`
                  : null}
                {host.type === "redirect" && host.redirectUrl
                  ? ` \u2192 ${host.redirectUrl}`
                  : null}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setPinOpen(true)}>
              <Pin className="h-4 w-4" />
            </Button>
            {hasScope("proxy:edit") && (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            )}
            {!isSystemHost && hasScope("proxy:delete") && (
              <Button variant="outline" onClick={handleDelete}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            )}
          </div>
        </div>

        {/* ── Health bars (only when healthCheckEnabled) ──────── */}
        {host.healthCheckEnabled && (
          <HealthBars history={host.healthHistory} currentStatus={host.healthStatus} />
        )}

        {/* ── Raw mode warning banner ────────────────────────── */}
        {isRawMode && (
          <div
            className="border bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-400"
            style={{ borderColor: "#eab308" }}
          >
            Raw mode active — template rendering is bypassed. Config is sent directly to the daemon.
          </div>
        )}

        {/* ── Tabs ───────────────────────────────────────────── */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            setActiveTab(v);
            if (v === "raw" && !isRawMode) loadRenderedConfig();
          }}
          className="flex flex-col flex-1 min-h-0"
        >
          <TabsList className="shrink-0">
            {visibleTabs.includes("details") && <TabsTrigger value="details">Details</TabsTrigger>}
            <TabsTrigger value="settings" disabled={isRawMode}>
              Settings
            </TabsTrigger>
            <TabsTrigger value="advanced" disabled={isRawMode}>
              Advanced
            </TabsTrigger>
            <TabsTrigger value="raw">Raw Config</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          {/* ── Details Tab ────────────────────────────────────── */}
          {visibleTabs.includes("details") && (
            <TabsContent value="details" className="pb-6">
              <DetailsTab host={host} />
            </TabsContent>
          )}

          {/* ── Settings Tab ────────────────────────────────────── */}
          {visibleTabs.includes("settings") && (
            <TabsContent value="settings" className="pb-6">
              <SettingsTab
                host={host}
                onToggle={handleToggle}
                customHeaders={customHeaders}
                setCustomHeaders={setCustomHeaders}
                cacheEnabled={cacheEnabled}
                setCacheEnabled={setCacheEnabled}
                cacheMaxAge={cacheMaxAge}
                setCacheMaxAge={setCacheMaxAge}
                rateLimitEnabled={rateLimitEnabled}
                setRateLimitEnabled={setRateLimitEnabled}
                rateLimitRPS={rateLimitRPS}
                setRateLimitRPS={setRateLimitRPS}
                rateLimitBurst={rateLimitBurst}
                setRateLimitBurst={setRateLimitBurst}
                customRewrites={customRewrites}
                setCustomRewrites={setCustomRewrites}
                onSaveCustom={handleSaveCustom}
                isSavingCustom={isSavingCustom}
                accessListId={accessListId}
                accessLists={accessLists}
                onAccessListChange={(v) => {
                  setAccessListId(v);
                  if (!id) return;
                  api
                    .updateProxyHost(id, { accessListId: v || undefined })
                    .then((updated) => {
                      setHost(updated);
                      toast.success("Access list updated");
                    })
                    .catch((err) =>
                      toast.error(err instanceof Error ? err.message : "Failed to update")
                    );
                }}
                canManage={hasScope("proxy:edit")}
                hasHeadersChanged={hasHeadersChanged}
                hasRewritesChanged={hasRewritesChanged}
                healthCheckUrl={healthCheckUrl}
                setHealthCheckUrl={setHealthCheckUrl}
                healthCheckExpectedStatus={healthCheckExpectedStatus}
                setHealthCheckExpectedStatus={setHealthCheckExpectedStatus}
                healthCheckExpectedBody={healthCheckExpectedBody}
                setHealthCheckExpectedBody={setHealthCheckExpectedBody}
              />
            </TabsContent>
          )}

          {/* ── Advanced Tab ───────────────────────────────────── */}
          {visibleTabs.includes("advanced") && (
            <TabsContent value="advanced" className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 min-h-0 flex flex-col relative">
                <CodeEditor
                  value={advancedConfig}
                  onChange={(val) => {
                    setAdvancedConfig(val);
                    setEditorErrorLines([]);
                  }}
                  errorLines={editorErrorLines}
                />
                {hasScope("proxy:advanced") && (
                  <div className="absolute right-2.5 bottom-2.5 z-10 flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleValidate}>
                      Validate
                    </Button>
                    <Button size="sm" onClick={handleSaveAdvanced} disabled={isSavingAdvanced}>
                      <Save className="h-4 w-4" />
                      Save
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
          )}

          {/* ── Raw Config Tab ─────────────────────────────────── */}
          <TabsContent value="raw" className="flex flex-col flex-1 min-h-0">
            {isRawMode ? (
              <div className="flex-1 min-h-0 flex flex-col relative">
                <CodeEditor
                  value={rawConfig}
                  onChange={(val) => {
                    setRawConfig(val);
                    setEditorErrorLines([]);
                  }}
                  errorLines={editorErrorLines}
                />
                {hasScope("proxy:advanced") && (
                  <div className="absolute right-2.5 bottom-2.5 z-10 flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleValidate}>
                      Validate
                    </Button>
                    <Button size="sm" onClick={handleSaveRaw} disabled={isSavingRaw}>
                      <Save className="h-4 w-4" />
                      Save
                    </Button>
                  </div>
                )}
              </div>
            ) : isLoadingRaw ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col relative">
                <CodeEditor value={renderedConfig} onChange={() => {}} readOnly />
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute right-2.5 bottom-2.5 z-10"
                  onClick={loadRenderedConfig}
                  disabled={isLoadingRaw}
                >
                  <RefreshCw className={cn("h-4 w-4", isLoadingRaw && "animate-spin")} />
                  Refresh
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ── Logs Tab ───────────────────────────────────────── */}
          <TabsContent value="logs" className="flex flex-col flex-1 min-h-0">
            <ProxyHostLogsTab hostId={id!} />
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Edit Dialog ──────────────────────────────────────── */}
      <CreateProxyHostDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        existingHost={host}
        onSuccess={() => {
          setEditOpen(false);
          loadHost();
        }}
      />

      {/* ── Pin Dialog ───────────────────────────────────────── */}
      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pin Proxy Host</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Add to dashboard</p>
                <p className="text-xs text-muted-foreground">Show overview card on the dashboard</p>
              </div>
              <Switch checked={isPinnedDashboard(id!)} onChange={() => toggleDashboard(id!)} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Add to sidebar</p>
                <p className="text-xs text-muted-foreground">Quick access link in the sidebar</p>
              </div>
              <Switch checked={isPinnedSidebar(id!)} onChange={() => toggleSidebar(id!)} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}

// ── Health Bars Component ───────────────────────────────────────

// ── Details Tab Component ───────────────────────────────────────
function DetailsTab({ host }: { host: ProxyHost }) {
  const navigate = useNavigate();
  const nodeId = (host as any).nodeId as string | null;
  const [nodeInfo, setNodeInfo] = useState<{
    id: string;
    name: string;
    status: string;
    type: string;
  } | null>(null);

  useEffect(() => {
    if (!nodeId) return;
    api
      .getNode(nodeId)
      .then((n) =>
        setNodeInfo({ id: n.id, name: n.displayName || n.hostname, status: n.status, type: n.type })
      )
      .catch(() => {});
  }, [nodeId]);

  return (
    <div className="space-y-4">
      {/* Node Card */}
      {nodeInfo && (
        <div
          className="border border-border bg-card cursor-pointer hover:bg-accent transition-colors"
          onClick={() => navigate(`/nodes/${nodeInfo.id}`)}
        >
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Server className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{nodeInfo.name}</p>
                <p className="text-xs text-muted-foreground">Deployed on this node</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs uppercase">
                {nodeInfo.type}
              </Badge>
              <Badge
                variant={
                  nodeInfo.status === "online"
                    ? "success"
                    : nodeInfo.status === "error"
                      ? "destructive"
                      : "warning"
                }
                className="text-xs uppercase"
              >
                {nodeInfo.status === "online" ? "healthy" : nodeInfo.status}
              </Badge>
            </div>
          </div>
        </div>
      )}

      {/* Host Info + Health Check in one row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Host Info Card */}
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Host Information</h2>
          </div>
          <div className="divide-y divide-border">
            <DetailRow
              label="Domains"
              value={
                <div className="flex flex-wrap gap-1 justify-end">
                  {host.domainNames.map((d) => (
                    <Badge key={d} variant="secondary" className="text-xs">
                      {d}
                    </Badge>
                  ))}
                </div>
              }
            />
            {host.type === "proxy" && host.forwardHost && (
              <DetailRow
                label="Forward Target"
                value={`${host.forwardScheme}://${host.forwardHost}:${host.forwardPort}`}
              />
            )}
            {host.type === "redirect" && host.redirectUrl && (
              <DetailRow
                label="Redirect URL"
                value={`${host.redirectUrl} (${host.redirectStatusCode})`}
              />
            )}
            <DetailRow label="Created" value={new Date(host.createdAt).toLocaleString()} />
            <DetailRow label="Updated" value={new Date(host.updatedAt).toLocaleString()} />
          </div>
        </div>

        {/* Health Check Status Card */}
        {host.healthCheckEnabled && (
          <div className="border border-border bg-card">
            <div className="border-b border-border p-4 flex items-center justify-between">
              <h2 className="font-semibold">Health Check</h2>
              {(() => {
                const eff = effectiveHealthStatus(host);
                return (
                  <Badge variant={HEALTH_BADGE[eff] ?? "secondary"} className="text-xs">
                    {HEALTH_LABEL[eff] ?? eff}
                  </Badge>
                );
              })()}
            </div>
            <div className="divide-y divide-border">
              <DetailRow label="URL Path" value={host.healthCheckUrl || "/"} />
              <DetailRow label="Interval" value={`${host.healthCheckInterval || 30}s`} />
              <DetailRow
                label="Expected Status"
                value={
                  host.healthCheckExpectedStatus
                    ? String(host.healthCheckExpectedStatus)
                    : "Any 2xx"
                }
              />
              {host.lastHealthCheckAt && (
                <DetailRow
                  label="Last Check"
                  value={new Date(host.lastHealthCheckAt).toLocaleString()}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* SSL Certificate Info (when SSL enabled) */}
      {host.sslEnabled && host.sslCertificate && (
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">SSL Certificate</h2>
          </div>
          <div className="divide-y divide-border">
            <DetailRow label="Name" value={host.sslCertificate.name} />
            <DetailRow
              label="Type"
              value={
                <Badge variant="secondary" className="text-xs">
                  {host.sslCertificate.type}
                </Badge>
              }
            />
            <DetailRow
              label="Status"
              value={
                <Badge
                  variant={host.sslCertificate.status === "active" ? "success" : "destructive"}
                  className="text-xs"
                >
                  {host.sslCertificate.status}
                </Badge>
              }
            />
            {host.sslCertificate.notAfter && (
              <DetailRow
                label="Expires"
                value={new Date(host.sslCertificate.notAfter).toLocaleString()}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Settings Tab Component ──────────────────────────────────────
function SettingsTab({
  host,
  onToggle,
  customHeaders,
  setCustomHeaders,
  cacheEnabled,
  setCacheEnabled,
  cacheMaxAge,
  setCacheMaxAge,
  rateLimitEnabled,
  setRateLimitEnabled,
  rateLimitRPS,
  setRateLimitRPS,
  rateLimitBurst,
  setRateLimitBurst,
  customRewrites,
  setCustomRewrites,
  onSaveCustom,
  isSavingCustom,
  accessListId,
  accessLists,
  onAccessListChange,
  canManage,
  hasHeadersChanged,
  hasRewritesChanged,
  healthCheckUrl,
  setHealthCheckUrl,
  healthCheckExpectedStatus,
  setHealthCheckExpectedStatus,
  healthCheckExpectedBody,
  setHealthCheckExpectedBody,
}: {
  host: ProxyHost;
  onToggle: (field: string, value: boolean) => void;
  customHeaders: CustomHeader[];
  setCustomHeaders: (v: CustomHeader[]) => void;
  cacheEnabled: boolean;
  setCacheEnabled: (v: boolean) => void;
  cacheMaxAge: number;
  setCacheMaxAge: (v: number) => void;
  rateLimitEnabled: boolean;
  setRateLimitEnabled: (v: boolean) => void;
  rateLimitRPS: number;
  setRateLimitRPS: (v: number) => void;
  rateLimitBurst: number;
  setRateLimitBurst: (v: number) => void;
  customRewrites: RewriteRule[];
  setCustomRewrites: (v: RewriteRule[]) => void;
  onSaveCustom: () => void;
  isSavingCustom: boolean;
  accessListId: string;
  accessLists: AccessList[];
  onAccessListChange: (v: string) => void;
  canManage: boolean;
  hasHeadersChanged: boolean;
  hasRewritesChanged: boolean;
  healthCheckUrl: string;
  setHealthCheckUrl: (v: string) => void;
  healthCheckExpectedStatus: number | null;
  setHealthCheckExpectedStatus: (v: number | null) => void;
  healthCheckExpectedBody: string;
  setHealthCheckExpectedBody: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* WebSocket + Access List — side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {host.type === "proxy" && (
          <div className="border border-border bg-card">
            <ToggleRow
              label="WebSocket Support"
              description="Enable WebSocket proxying"
              checked={host.websocketSupport}
              onChange={(v) => onToggle("websocketSupport", v)}
            />
          </div>
        )}
        <div
          className={cn("border border-border bg-card", host.type !== "proxy" && "md:col-span-2")}
        >
          <div className="flex items-center justify-between p-4">
            <div>
              <h2 className="font-semibold text-sm">Access List</h2>
              <p className="text-xs text-muted-foreground">
                Restrict access via IP rules or basic authentication
              </p>
            </div>
            <Select
              value={accessListId || "__none__"}
              onValueChange={(v) => onAccessListChange(v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="w-48 shrink-0">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {accessLists.map((al) => (
                  <SelectItem key={al.id} value={al.id}>
                    {al.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* SSL */}
      <div className="border border-border bg-card">
        <ToggleRow
          label="SSL Enabled"
          description="Serve this host over HTTPS"
          checked={host.sslEnabled}
          onChange={(v) => onToggle("sslEnabled", v)}
        />
        <div className="border-t border-border grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
          <ToggleRow
            label="Force HTTPS"
            description="Redirect HTTP to HTTPS"
            checked={host.sslForced}
            onChange={(v) => onToggle("sslForced", v)}
            disabled={!host.sslEnabled}
          />
          <ToggleRow
            label="HTTP/2"
            description="Enable HTTP/2 protocol support"
            checked={host.http2Support}
            onChange={(v) => onToggle("http2Support", v)}
            disabled={!host.sslEnabled}
          />
        </div>
      </div>

      {/* Cache & Rate Limit — side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-border bg-card">
          <div className="divide-y divide-border">
            <ToggleRow
              label="Cache"
              description="Enable response caching"
              checked={cacheEnabled}
              onChange={setCacheEnabled}
            />
            <div className="px-4 py-3">
              <label className="text-xs font-medium text-muted-foreground">Max Age (seconds)</label>
              <NumericInput
                value={cacheMaxAge}
                onChange={(v) => setCacheMaxAge(v)}
                min={1}
                className="mt-1"
                disabled={!cacheEnabled}
              />
            </div>
          </div>
        </div>
        <div className="border border-border bg-card">
          <div className="divide-y divide-border">
            <ToggleRow
              label="Rate Limit"
              description="Enable request rate limiting"
              checked={rateLimitEnabled}
              onChange={setRateLimitEnabled}
            />
            <div className="px-4 py-3 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Requests/sec</label>
                <NumericInput
                  value={rateLimitRPS}
                  onChange={setRateLimitRPS}
                  min={1}
                  disabled={!rateLimitEnabled}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Burst</label>
                <NumericInput
                  value={rateLimitBurst}
                  onChange={setRateLimitBurst}
                  min={1}
                  disabled={!rateLimitEnabled}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Health Check */}
      {host.type !== "404" && (
        <div className="border border-border bg-card">
          <ToggleRow
            label="Health Check"
            description="Enable periodic health monitoring"
            checked={host.healthCheckEnabled}
            onChange={(v) => onToggle("healthCheckEnabled", v)}
          />
          <div className="border-t border-border px-4 py-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">URL Path</label>
              <Input
                value={healthCheckUrl}
                onChange={(e) => setHealthCheckUrl(e.target.value)}
                placeholder="/"
                disabled={!host.healthCheckEnabled}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Expected Status</label>
              <Input
                type="number"
                value={healthCheckExpectedStatus ?? ""}
                onChange={(e) =>
                  setHealthCheckExpectedStatus(e.target.value ? Number(e.target.value) : null)
                }
                placeholder="Any 2xx"
                disabled={!host.healthCheckEnabled}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Expected Body</label>
              <Input
                value={healthCheckExpectedBody}
                onChange={(e) => setHealthCheckExpectedBody(e.target.value)}
                placeholder="Optional"
                disabled={!host.healthCheckEnabled}
              />
            </div>
          </div>
        </div>
      )}

      {/* Custom Headers */}
      <div className="border border-border bg-card">
        <div
          className={cn(
            "flex items-center justify-between p-4",
            customHeaders.length > 0 && "border-b border-border"
          )}
        >
          <div>
            <h2 className="font-semibold text-sm">Custom Headers</h2>
            <p className="text-xs text-muted-foreground">
              Add custom HTTP headers to proxied requests
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canManage && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={() => setCustomHeaders([...customHeaders, { name: "", value: "" }])}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={onSaveCustom}
                  disabled={!hasHeadersChanged || isSavingCustom}
                >
                  <Save className="h-3.5 w-3.5" />
                  Save
                </Button>
              </>
            )}
          </div>
        </div>
        <motion.div
          animate={{ height: customHeaders.length > 0 ? "auto" : 0 }}
          initial={false}
          transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          className="overflow-hidden"
        >
          <div className="p-4 space-y-3">
            <AnimatePresence initial={false}>
              {customHeaders.map((header, i) => (
                <motion.div
                  key={`header-${i}`}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                  className="flex gap-2"
                >
                  <Input
                    placeholder="Header name"
                    value={header.name}
                    onChange={(e) => {
                      const next = [...customHeaders];
                      next[i] = { ...next[i], name: e.target.value };
                      setCustomHeaders(next);
                    }}
                  />
                  <Input
                    placeholder="Value"
                    value={header.value}
                    onChange={(e) => {
                      const next = [...customHeaders];
                      next[i] = { ...next[i], value: e.target.value };
                      setCustomHeaders(next);
                    }}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCustomHeaders(customHeaders.filter((_, j) => j !== i))}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      {/* URL Rewrites */}
      <div className="border border-border bg-card">
        <div
          className={cn(
            "flex items-center justify-between p-4",
            customRewrites.length > 0 && "border-b border-border"
          )}
        >
          <div>
            <h2 className="font-semibold text-sm">URL Rewrites</h2>
            <p className="text-xs text-muted-foreground">Rewrite request paths before proxying</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canManage && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={() =>
                    setCustomRewrites([
                      ...customRewrites,
                      { source: "", destination: "", type: "permanent" },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={onSaveCustom}
                  disabled={!hasRewritesChanged || isSavingCustom}
                >
                  <Save className="h-3.5 w-3.5" />
                  Save
                </Button>
              </>
            )}
          </div>
        </div>
        <motion.div
          animate={{ height: customRewrites.length > 0 ? "auto" : 0 }}
          initial={false}
          transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          className="overflow-hidden"
        >
          <div className="p-4 space-y-3">
            <AnimatePresence initial={false}>
              {customRewrites.map((rule, i) => (
                <motion.div
                  key={`rewrite-${i}`}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                  className="flex gap-2"
                >
                  <Input
                    placeholder="Source path"
                    value={rule.source}
                    onChange={(e) => {
                      const next = [...customRewrites];
                      next[i] = { ...next[i], source: e.target.value };
                      setCustomRewrites(next);
                    }}
                  />
                  <Input
                    placeholder="Destination"
                    value={rule.destination}
                    onChange={(e) => {
                      const next = [...customRewrites];
                      next[i] = { ...next[i], destination: e.target.value };
                      setCustomRewrites(next);
                    }}
                  />
                  <Select
                    value={rule.type}
                    onValueChange={(v) => {
                      const next = [...customRewrites];
                      next[i] = { ...next[i], type: v as "permanent" | "temporary" };
                      setCustomRewrites(next);
                    }}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="permanent">Permanent</SelectItem>
                      <SelectItem value="temporary">Temporary</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCustomRewrites(customRewrites.filter((_, j) => j !== i))}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ── Shared Components ───────────────────────────────────────────
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className={cn(disabled && "opacity-50")}>
        <span className="text-sm font-medium">{label}</span>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

// ── Proxy Host Logs Tab ─────────────────────────────────────────

interface NginxLogEntry {
  hostId: string;
  timestamp: string;
  remoteAddr: string;
  method: string;
  path: string;
  status: number;
  bodyBytesSent: string;
  raw: string;
  logType: string;
  level: string;
}

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "success" | "warning"
> = {
  "2": "success",
  "3": "default",
  "4": "warning",
  "5": "destructive",
};

function ProxyHostLogsTab({ hostId }: { hostId: string }) {
  const [logs, setLogs] = useState<NginxLogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      userScrolled.current = !atBottom;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: auto-scroll on new logs
  useEffect(() => {
    const el = scrollRef.current;
    if (el && !userScrolled.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (esRef.current) esRef.current.close();

    const sessionId = useAuthStore.getState().sessionId;
    const params = new URLSearchParams();
    if (sessionId) params.set("token", sessionId);

    const es = new EventSource(`/api/monitoring/logs/${hostId}/stream?${params}`);
    esRef.current = es;

    es.addEventListener("connected", () => setLogs([]));
    es.addEventListener("log", (e) => {
      try {
        const entry = JSON.parse(e.data) as NginxLogEntry;
        // Client-side filtering
        if (statusFilter !== "all") {
          const prefix = statusFilter.replace("xx", "");
          if (entry.logType === "error") {
            if (statusFilter !== "error") return;
          } else if (!String(entry.status).startsWith(prefix)) {
            return;
          }
        }
        if (debouncedSearch) {
          const q = debouncedSearch.toLowerCase();
          if (
            !entry.path?.toLowerCase().includes(q) &&
            !entry.remoteAddr?.toLowerCase().includes(q) &&
            !entry.raw?.toLowerCase().includes(q)
          ) {
            return;
          }
        }
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > 300 ? next.slice(-300) : next;
        });
      } catch {}
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) es.close();
    };

    return () => es.close();
  }, [hostId, statusFilter, debouncedSearch]);

  const colgroup = (
    <colgroup>
      <col style={{ width: "160px" }} />
      <col style={{ width: "60px" }} />
      <col style={{ width: "120px" }} />
      <col style={{ width: "60px" }} />
      <col />
      <col style={{ width: "60px" }} />
      <col style={{ width: "70px" }} />
    </colgroup>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <div className="flex gap-3 shrink-0">
        <Input
          className="flex-1"
          placeholder="Search by path or IP..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="2xx">2xx Success</SelectItem>
            <SelectItem value="3xx">3xx Redirect</SelectItem>
            <SelectItem value="4xx">4xx Client Err</SelectItem>
            <SelectItem value="5xx">5xx Server Err</SelectItem>
            <SelectItem value="error">Error Log</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 min-h-0 flex flex-col border border-border bg-card">
        <table className="w-full shrink-0" style={{ tableLayout: "fixed" }}>
          {colgroup}
          <thead>
            <tr className="text-left border-b border-border">
              <th className="p-3 text-xs font-medium text-muted-foreground">Time</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Type</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Remote Addr</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Method</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Path / Message</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Status</th>
              <th className="p-3 text-xs font-medium text-muted-foreground">Size</th>
            </tr>
          </thead>
        </table>
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
          <table className="w-full" style={{ tableLayout: "fixed" }}>
            {colgroup}
            <tbody className="divide-y divide-border">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-sm text-muted-foreground">
                    Waiting for log events...
                  </td>
                </tr>
              ) : (
                logs.map((entry, i) => {
                  const isError = entry.logType === "error";
                  return (
                    <tr key={i}>
                      <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">
                        {entry.timestamp}
                      </td>
                      <td className="p-3 text-sm">
                        <Badge
                          variant={isError ? "destructive" : "secondary"}
                          className="text-[10px]"
                        >
                          {isError ? "err" : "acc"}
                        </Badge>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {isError ? "—" : entry.remoteAddr}
                      </td>
                      <td className="p-3 text-sm">{isError ? "—" : entry.method}</td>
                      <td className="p-3 text-sm truncate" title={isError ? entry.raw : entry.path}>
                        {isError ? entry.raw : entry.path}
                      </td>
                      <td className="p-3 text-sm">
                        {isError ? (
                          <Badge variant="destructive" className="text-[10px]">
                            {entry.level || "err"}
                          </Badge>
                        ) : (
                          <Badge
                            variant={STATUS_VARIANT[String(entry.status)[0]] ?? "secondary"}
                            className="text-xs"
                          >
                            {entry.status}
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {isError ? "—" : entry.bodyBytesSent}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
