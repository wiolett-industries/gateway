import { ArrowLeft, Pencil, Pin, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { PageTransition } from "@/components/common/PageTransition";
import { ResponsiveHeaderActions } from "@/components/common/ResponsiveHeaderActions";
import { CreateProxyHostDialog } from "@/components/proxy/CreateProxyHostDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HealthBars } from "@/components/ui/health-bars";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRealtime } from "@/hooks/use-realtime";
import { useUrlTab } from "@/hooks/use-url-tab";
import { cn } from "@/lib/utils";
import { api } from "@/services/api";
import { ApiRequestError } from "@/services/api-base";
import { useAuthStore } from "@/stores/auth";
import { usePinnedProxiesStore } from "@/stores/pinned-proxies";
import type {
  AccessList,
  CustomHeader,
  ForwardScheme,
  NginxTemplate,
  ProxyHost,
  RewriteRule,
  SSLCertificate,
} from "@/types";
import { AdvancedTab } from "./proxy-detail/AdvancedTab";
import { DetailsTab } from "./proxy-detail/DetailsTab";
import {
  effectiveHealthStatus,
  HEALTH_BADGE,
  HEALTH_LABEL,
  TYPE_BADGE,
} from "./proxy-detail/helpers";
import { LogsTab } from "./proxy-detail/LogsTab";
import { RawConfigTab } from "./proxy-detail/RawConfigTab";
import { SettingsTab } from "./proxy-detail/SettingsTab";

// ── Main Component ──────────────────────────────────────────────
export function ProxyHostDetail() {
  const { id } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const canViewAdvancedConfig = !!id && hasScope(`proxy:advanced:${id}`);
  const canViewRawConfig = !!id && hasScope(`proxy:raw:read:${id}`);
  const canWriteRawConfig = !!id && hasScope(`proxy:raw:write:${id}`);
  const visibleTabs = useMemo(
    () => [
      "details",
      "settings",
      ...(canViewAdvancedConfig ? ["advanced"] : []),
      ...(canViewRawConfig ? ["raw"] : []),
      "logs",
    ],
    [canViewAdvancedConfig, canViewRawConfig]
  );

  const [host, setHost] = useState<ProxyHost | null>(null);
  const [healthHistory, setHealthHistory] = useState<NonNullable<ProxyHost["healthHistory"]>>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [activeTab, setActiveTab] = useUrlTab(
    visibleTabs,
    "details",
    (tab) => `/proxy-hosts/${id}/${tab}`
  );

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
  const [healthCheckBodyMatchMode, setHealthCheckBodyMatchMode] = useState<
    "includes" | "exact" | "starts_with" | "ends_with"
  >("includes");
  const [healthCheckSlowThreshold, setHealthCheckSlowThreshold] = useState(3);
  // Access list tab state
  const [accessListId, setAccessListId] = useState<string>("");
  const [accessLists, setAccessLists] = useState<AccessList[]>([]);
  const [sslCerts, setSslCerts] = useState<SSLCertificate[]>([]);
  const [nginxTemplates, setNginxTemplates] = useState<NginxTemplate[]>([]);
  const [nginxTemplateId, setNginxTemplateId] = useState<string>("");
  const [templateVariables, setTemplateVariables] = useState<
    Record<string, string | number | boolean>
  >({});
  const [templateForwardScheme, setTemplateForwardScheme] = useState<ForwardScheme>("http");
  const [templateForwardHost, setTemplateForwardHost] = useState("");
  const [templateForwardPort, setTemplateForwardPort] = useState(80);
  const [templateRedirectUrl, setTemplateRedirectUrl] = useState("");
  const [templateRedirectStatusCode, setTemplateRedirectStatusCode] = useState(301);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

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
        const history = data.healthCheckEnabled ? await api.getProxyHostHealthHistory(id) : [];
        setHost(data);
        setHealthHistory(history);
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
        setHealthCheckBodyMatchMode(data.healthCheckBodyMatchMode || "includes");
        setHealthCheckSlowThreshold(data.healthCheckSlowThreshold ?? 3);
        setNginxTemplateId(data.nginxTemplateId || "");
        setTemplateVariables(data.templateVariables || {});
        setTemplateForwardScheme(data.forwardScheme || "http");
        setTemplateForwardHost(data.forwardHost || "");
        setTemplateForwardPort(data.forwardPort || 80);
        setTemplateRedirectUrl(data.redirectUrl || "");
        setTemplateRedirectStatusCode(data.redirectStatusCode || 301);
        setAdvancedConfig(data.advancedConfig || "");
        setRawConfig(data.rawConfig || "");
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 404) {
          usePinnedProxiesStore.getState().removePin(id);
        }
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

  useRealtime(id ? "proxy.host.changed" : null, (payload) => {
    const ev = payload as { id?: string; action?: string };
    if (!ev || ev.id !== id) return;
    if (ev.action === "deleted") {
      toast.info("Proxy host was deleted");
      navigate("/proxy-hosts");
      return;
    }
    loadHost(true);
  });

  useRealtime(id ? "ssl.cert.changed" : null, () => {
    loadHost(true);
  });

  useRealtime(id ? "cert.changed" : null, () => {
    loadHost(true);
  });

  // ── Load access lists ─────────────────────────────────────────
  const loadAccessLists = useCallback(async () => {
    try {
      const res = await api.listAccessLists({ limit: 100 });
      setAccessLists(res.data || []);
    } catch {}
  }, []);

  const loadSSLCerts = useCallback(async () => {
    try {
      const res = await api.listSSLCertificates({ limit: 100 });
      setSslCerts(res.data || []);
    } catch {}
  }, []);

  const loadNginxTemplates = useCallback(async () => {
    try {
      const data = await api.listNginxTemplates();
      setNginxTemplates(data || []);
    } catch {}
  }, []);

  useEffect(() => {
    void loadAccessLists();
  }, [loadAccessLists]);

  useEffect(() => {
    void loadSSLCerts();
  }, [loadSSLCerts]);

  useEffect(() => {
    void loadNginxTemplates();
  }, [loadNginxTemplates]);

  useRealtime("access-list.changed", () => {
    void loadAccessLists();
  });

  useRealtime("ssl.cert.changed", () => {
    void loadSSLCerts();
  });

  useRealtime("nginx.template.changed", () => {
    void loadNginxTemplates();
  });

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
      if (
        field === "sslEnabled" &&
        value &&
        !host.sslCertificateId &&
        !host.internalCertificateId
      ) {
        toast.error("Select an SSL certificate before enabling HTTPS");
        return;
      }
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

  const handleSslCertificateChange = useCallback(
    async (value: string) => {
      if (!id) return;
      try {
        const updated = await api.updateProxyHost(id, {
          sslCertificateId: value || null,
        });
        setHost(updated);
        toast.success("SSL certificate updated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update SSL certificate");
      }
    },
    [id]
  );

  const selectedTemplate = useMemo(
    () => nginxTemplates.find((t) => t.id === nginxTemplateId) ?? null,
    [nginxTemplates, nginxTemplateId]
  );

  const userTemplates = useMemo(
    () => nginxTemplates.filter((t) => !t.isBuiltin && t.type === host?.type),
    [nginxTemplates, host?.type]
  );

  const normalizeTemplateVariables = useCallback(
    (templateId: string, vars: Record<string, string | number | boolean>) => {
      const template = nginxTemplates.find((t) => t.id === templateId);
      if (!template?.variables?.length) return {};

      const next: Record<string, string | number | boolean> = {};
      for (const def of template.variables) {
        if (vars[def.name] !== undefined) {
          next[def.name] = vars[def.name];
        } else if (def.default !== undefined) {
          next[def.name] = def.default;
        } else if (def.type === "boolean") {
          next[def.name] = false;
        } else if (def.type === "number") {
          next[def.name] = 0;
        } else {
          next[def.name] = "";
        }
      }
      return next;
    },
    [nginxTemplates]
  );

  const hasTemplateSettingsChanged = useMemo(() => {
    if (!host) return false;
    const currentId = host.nginxTemplateId || "";
    const currentVars = currentId
      ? normalizeTemplateVariables(currentId, host.templateVariables || {})
      : {};
    const nextVars = nginxTemplateId
      ? normalizeTemplateVariables(nginxTemplateId, templateVariables)
      : {};
    const builtinsChanged =
      (host.type === "proxy" &&
        (host.forwardScheme !== templateForwardScheme ||
          (host.forwardHost || "") !== templateForwardHost ||
          (host.forwardPort || 80) !== templateForwardPort)) ||
      (host.type === "redirect" &&
        ((host.redirectUrl || "") !== templateRedirectUrl ||
          (host.redirectStatusCode || 301) !== templateRedirectStatusCode));

    return (
      builtinsChanged ||
      currentId !== nginxTemplateId ||
      JSON.stringify(currentVars) !== JSON.stringify(nextVars)
    );
  }, [
    host,
    nginxTemplateId,
    normalizeTemplateVariables,
    templateForwardHost,
    templateForwardPort,
    templateForwardScheme,
    templateRedirectStatusCode,
    templateRedirectUrl,
    templateVariables,
  ]);

  const handleTemplateSelectionChange = useCallback(
    (value: string) => {
      const nextId = value || "";
      setNginxTemplateId(nextId);
      if (!nextId) {
        setTemplateVariables({});
        return;
      }

      setTemplateVariables((prev) => normalizeTemplateVariables(nextId, prev));
    },
    [normalizeTemplateVariables]
  );

  const handleTemplateVariableChange = useCallback(
    (name: string, value: string | number | boolean) => {
      setTemplateVariables((prev) => ({ ...prev, [name]: value }));
    },
    []
  );

  const handleSaveTemplateSettings = useCallback(async () => {
    if (!id) return;
    setIsSavingTemplate(true);
    try {
      const vars = nginxTemplateId
        ? normalizeTemplateVariables(nginxTemplateId, templateVariables)
        : {};
      const updated = await api.updateProxyHost(id, {
        nginxTemplateId: nginxTemplateId || null,
        templateVariables: vars,
        ...(host?.type === "proxy"
          ? {
              forwardScheme: templateForwardScheme,
              forwardHost: templateForwardHost,
              forwardPort: templateForwardPort,
            }
          : {}),
        ...(host?.type === "redirect"
          ? {
              redirectUrl: templateRedirectUrl,
              redirectStatusCode: templateRedirectStatusCode,
            }
          : {}),
      });
      setHost(updated);
      setNginxTemplateId(updated.nginxTemplateId || "");
      setTemplateVariables(updated.templateVariables || {});
      setTemplateForwardScheme(updated.forwardScheme || "http");
      setTemplateForwardHost(updated.forwardHost || "");
      setTemplateForwardPort(updated.forwardPort || 80);
      setTemplateRedirectUrl(updated.redirectUrl || "");
      setTemplateRedirectStatusCode(updated.redirectStatusCode || 301);
      toast.success("Template settings updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update template settings");
    } finally {
      setIsSavingTemplate(false);
    }
  }, [
    host,
    id,
    nginxTemplateId,
    normalizeTemplateVariables,
    templateForwardHost,
    templateForwardPort,
    templateForwardScheme,
    templateRedirectStatusCode,
    templateRedirectUrl,
    templateVariables,
  ]);

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

  // ── Validate config — returns true if valid ──────────────────
  const handleValidate = async (): Promise<boolean> => {
    try {
      const configToValidate = isRawMode ? rawConfig : advancedConfig;
      const result = await api.validateProxyConfig(
        configToValidate,
        isRawMode ? "raw" : "advanced",
        id
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
      usePinnedProxiesStore.getState().removePin(host.id);
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
      healthCheckExpectedBody !== (host.healthCheckExpectedBody || "") ||
      healthCheckBodyMatchMode !== (host.healthCheckBodyMatchMode || "includes") ||
      healthCheckSlowThreshold !== (host.healthCheckSlowThreshold ?? 3)
    );
  }, [
    host,
    healthCheckUrl,
    healthCheckExpectedStatus,
    healthCheckExpectedBody,
    healthCheckBodyMatchMode,
    healthCheckSlowThreshold,
  ]);

  // ── Auto-save health check settings on change (debounced) ─────
  useEffect(() => {
    if (!id || !host || !hasHealthCheckChanged) return;
    const timer = setTimeout(() => {
      api
        .updateProxyHost(id, {
          healthCheckUrl,
          healthCheckExpectedStatus: healthCheckExpectedStatus ?? undefined,
          healthCheckExpectedBody:
            healthCheckExpectedBody.trim() === "" ? null : healthCheckExpectedBody,
          healthCheckBodyMatchMode:
            healthCheckExpectedBody.trim() === "" ? undefined : healthCheckBodyMatchMode,
          healthCheckSlowThreshold: healthCheckSlowThreshold || undefined,
        })
        .then((updated) => setHost(updated))
        .catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [
    hasHealthCheckChanged,
    host,
    id,
    healthCheckUrl,
    healthCheckExpectedStatus,
    healthCheckExpectedBody,
    healthCheckBodyMatchMode,
    healthCheckSlowThreshold,
  ]);

  // Navigate away from disabled tabs when raw mode changes
  useEffect(() => {
    if (isRawMode && (activeTab === "settings" || activeTab === "advanced")) {
      setActiveTab("details");
    }
  }, [activeTab, isRawMode, setActiveTab]);

  // ── Loading state ─────────────────────────────────────────────
  if (isLoading || !host) {
    return <LoadingSpinner />;
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

          <ResponsiveHeaderActions
            actions={[
              {
                label: "Pin",
                icon: <Pin className="h-4 w-4" />,
                onClick: () => setPinOpen(true),
              },
              ...(hasScope("proxy:edit")
                ? [
                    {
                      label: "Edit",
                      icon: <Pencil className="h-4 w-4" />,
                      onClick: () => setEditOpen(true),
                    },
                  ]
                : []),
              ...(!isSystemHost && hasScope("proxy:delete")
                ? [
                    {
                      label: "Delete",
                      icon: <Trash2 className="h-4 w-4" />,
                      onClick: handleDelete,
                      destructive: true,
                      separatorBefore: true,
                    },
                  ]
                : []),
            ]}
          >
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
          </ResponsiveHeaderActions>
        </div>

        {/* ── Health bars (only when healthCheckEnabled) ──────── */}
        {host.healthCheckEnabled && (
          <HealthBars history={healthHistory} currentStatus={host.healthStatus} />
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
            {visibleTabs.includes("settings") && (
              <TabsTrigger value="settings" disabled={isRawMode}>
                Settings
              </TabsTrigger>
            )}
            {visibleTabs.includes("advanced") && (
              <TabsTrigger value="advanced" disabled={isRawMode}>
                Advanced
              </TabsTrigger>
            )}
            {visibleTabs.includes("raw") && <TabsTrigger value="raw">Raw Config</TabsTrigger>}
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
                sslCerts={sslCerts}
                onSslCertificateChange={handleSslCertificateChange}
                nginxTemplates={userTemplates}
                nginxTemplateId={nginxTemplateId}
                onNginxTemplateChange={handleTemplateSelectionChange}
                selectedTemplate={selectedTemplate}
                templateVariables={templateVariables}
                onTemplateVariableChange={handleTemplateVariableChange}
                templateForwardScheme={templateForwardScheme}
                setTemplateForwardScheme={setTemplateForwardScheme}
                templateForwardHost={templateForwardHost}
                setTemplateForwardHost={setTemplateForwardHost}
                templateForwardPort={templateForwardPort}
                setTemplateForwardPort={setTemplateForwardPort}
                templateRedirectUrl={templateRedirectUrl}
                setTemplateRedirectUrl={setTemplateRedirectUrl}
                templateRedirectStatusCode={templateRedirectStatusCode}
                setTemplateRedirectStatusCode={setTemplateRedirectStatusCode}
                onSaveTemplateSettings={handleSaveTemplateSettings}
                isSavingTemplate={isSavingTemplate}
                hasTemplateSettingsChanged={hasTemplateSettingsChanged}
                canManage={hasScope("proxy:edit")}
                hasHeadersChanged={hasHeadersChanged}
                hasRewritesChanged={hasRewritesChanged}
                healthCheckUrl={healthCheckUrl}
                setHealthCheckUrl={setHealthCheckUrl}
                healthCheckExpectedStatus={healthCheckExpectedStatus}
                setHealthCheckExpectedStatus={setHealthCheckExpectedStatus}
                healthCheckExpectedBody={healthCheckExpectedBody}
                setHealthCheckExpectedBody={setHealthCheckExpectedBody}
                healthCheckBodyMatchMode={healthCheckBodyMatchMode}
                setHealthCheckBodyMatchMode={setHealthCheckBodyMatchMode}
                healthCheckSlowThreshold={healthCheckSlowThreshold}
                setHealthCheckSlowThreshold={setHealthCheckSlowThreshold}
              />
            </TabsContent>
          )}

          {/* ── Advanced Tab ───────────────────────────────────── */}
          {visibleTabs.includes("advanced") && (
            <TabsContent value="advanced" className="flex flex-col flex-1 min-h-0">
              <AdvancedTab
                advancedConfig={advancedConfig}
                setAdvancedConfig={setAdvancedConfig}
                editorErrorLines={editorErrorLines}
                setEditorErrorLines={setEditorErrorLines}
                onValidate={handleValidate}
                onSaveAdvanced={handleSaveAdvanced}
                isSavingAdvanced={isSavingAdvanced}
                canManage={!!id && hasScope(`proxy:advanced:${id}`)}
              />
            </TabsContent>
          )}

          {/* ── Raw Config Tab ─────────────────────────────────── */}
          {visibleTabs.includes("raw") && (
            <TabsContent value="raw" className="flex flex-col flex-1 min-h-0">
              <RawConfigTab
                isRawMode={isRawMode}
                rawConfig={rawConfig}
                setRawConfig={setRawConfig}
                renderedConfig={renderedConfig}
                isLoadingRaw={isLoadingRaw}
                isSavingRaw={isSavingRaw}
                editorErrorLines={editorErrorLines}
                setEditorErrorLines={setEditorErrorLines}
                onValidate={handleValidate}
                onSaveRaw={handleSaveRaw}
                onRefreshRendered={loadRenderedConfig}
                canManage={canWriteRawConfig}
              />
            </TabsContent>
          )}

          {/* ── Logs Tab ───────────────────────────────────────── */}
          <TabsContent value="logs" className="flex flex-col flex-1 min-h-0">
            <LogsTab hostId={id!} />
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
