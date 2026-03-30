import { motion } from "framer-motion";
import { ArrowLeft, Minus, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { PageTransition } from "@/components/common/PageTransition";
import { DomainAutocompleteInput } from "@/components/domains/DomainAutocompleteInput";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
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
import type {
  AccessList,
  CreateProxyHostRequest,
  CustomHeader,
  ForwardScheme,
  NginxTemplate,
  ProxyHostFolder,
  ProxyHostType,
  RewriteRule,
  SSLCertificate,
} from "@/types";

export function ProxyHostDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasRole } = useAuthStore();
  const isNew = !id;

  const [isLoading, setIsLoading] = useState(!isNew);
  const [isSaving, setIsSaving] = useState(false);
  const [isSystemHost, setIsSystemHost] = useState(false);

  // Form state
  const [type, setType] = useState<ProxyHostType>("proxy");
  const [domainNames, setDomainNames] = useState<string[]>([""]);
  const [forwardHost, setForwardHost] = useState("");
  const [forwardPort, setForwardPort] = useState(80);
  const [forwardScheme, setForwardScheme] = useState<ForwardScheme>("http");
  const [websocketSupport, setWebsocketSupport] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState("");
  const [redirectStatusCode, setRedirectStatusCode] = useState(301);

  // SSL
  const [sslEnabled, setSslEnabled] = useState(false);
  const [sslForced, setSslForced] = useState(false);
  const [http2Support, setHttp2Support] = useState(false);
  const [sslCertificateId, setSslCertificateId] = useState<string>("");
  const [internalCertificateId, setInternalCertificateId] = useState<string>("");

  // Custom config
  const [customHeaders, setCustomHeaders] = useState<CustomHeader[]>([]);
  const [cacheEnabled, setCacheEnabled] = useState(false);
  const [cacheMaxAge, setCacheMaxAge] = useState(3600);
  const [rateLimitEnabled, setRateLimitEnabled] = useState(false);
  const [rateLimitRPS, setRateLimitRPS] = useState(100);
  const [rateLimitBurst, setRateLimitBurst] = useState(200);
  const [customRewrites, setCustomRewrites] = useState<RewriteRule[]>([]);

  // Advanced
  const [advancedConfig, setAdvancedConfig] = useState("");
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    errors?: string[];
  } | null>(null);

  // Folder
  const [folderId, setFolderId] = useState<string>("");

  // Nginx config template
  const [nginxTemplateId, setNginxTemplateId] = useState<string>("");
  const [templateVariables, setTemplateVariables] = useState<
    Record<string, string | number | boolean>
  >({});

  // Access list
  const [accessListId, setAccessListId] = useState<string>("");

  // Health check
  const [healthCheckEnabled, setHealthCheckEnabled] = useState(false);
  const [healthCheckUrl, setHealthCheckUrl] = useState("/");
  const [healthCheckInterval, setHealthCheckInterval] = useState(30);
  const [healthCheckExpectedStatus, setHealthCheckExpectedStatus] = useState<number | null>(null);
  const [healthCheckExpectedBody, setHealthCheckExpectedBody] = useState("");

  // Raw config
  const [rawConfig, setRawConfig] = useState("");
  const [rawConfigLoaded, setRawConfigLoaded] = useState(false);
  const [isLoadingRaw, setIsLoadingRaw] = useState(false);

  // Log viewer
  const [logLines, setLogLines] = useState<string[]>([]);
  const logRef = useRef<HTMLPreElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Related data
  const [sslCerts, setSslCerts] = useState<SSLCertificate[]>([]);
  const [accessLists, setAccessLists] = useState<AccessList[]>([]);
  const [pkiCerts, setPkiCerts] = useState<{ id: string; commonName: string }[]>([]);
  const [folderList, setFolderList] = useState<ProxyHostFolder[]>([]);
  const [nginxTemplateList, setNginxTemplateList] = useState<NginxTemplate[]>([]);

  // Load existing proxy host
  useEffect(() => {
    if (isNew) return;
    if (!id) return;
    const load = async () => {
      setIsLoading(true);
      try {
        const host = await api.getProxyHost(id);
        setType(host.type);
        setDomainNames(host.domainNames.length > 0 ? host.domainNames : [""]);
        setForwardHost(host.forwardHost || "");
        setForwardPort(host.forwardPort || 80);
        setForwardScheme(host.forwardScheme || "http");
        setWebsocketSupport(host.websocketSupport);
        setRedirectUrl(host.redirectUrl || "");
        setRedirectStatusCode(host.redirectStatusCode || 301);
        setSslEnabled(host.sslEnabled);
        setSslForced(host.sslForced);
        setHttp2Support(host.http2Support);
        setSslCertificateId(host.sslCertificateId || "");
        setInternalCertificateId(host.internalCertificateId || "");
        setCustomHeaders(host.customHeaders || []);
        setCacheEnabled(host.cacheEnabled);
        setCacheMaxAge(host.cacheOptions?.maxAge || 3600);
        setRateLimitEnabled(host.rateLimitEnabled);
        setRateLimitRPS(host.rateLimitOptions?.requestsPerSecond || 100);
        setRateLimitBurst(host.rateLimitOptions?.burst || 200);
        setCustomRewrites(host.customRewrites || []);
        setAdvancedConfig(host.advancedConfig || "");
        setAccessListId(host.accessListId || "");
        setFolderId(host.folderId || "");
        setNginxTemplateId(host.nginxTemplateId || "");
        setTemplateVariables(host.templateVariables || {});
        setIsSystemHost(!!host.isSystem);
        setHealthCheckEnabled(host.healthCheckEnabled);
        setHealthCheckUrl(host.healthCheckUrl || "/");
        setHealthCheckInterval(host.healthCheckInterval || 30);
        setHealthCheckExpectedStatus(host.healthCheckExpectedStatus ?? null);
        setHealthCheckExpectedBody(host.healthCheckExpectedBody || "");
      } catch {
        toast.error("Failed to load proxy host");
        navigate("/proxy-hosts");
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [id, isNew, navigate]);

  // Load related data
  useEffect(() => {
    const loadRelated = async () => {
      try {
        const [sslRes, alRes, folderRes] = await Promise.all([
          api.listSSLCertificates({ limit: 100 }),
          api.listAccessLists({ limit: 100 }),
          api.listFolders(),
        ]);
        setSslCerts(sslRes.data || []);
        setAccessLists(alRes.data || []);
        // Flatten folder tree for select dropdown
        const flat: ProxyHostFolder[] = [];
        const flatten = (nodes: typeof folderRes, depth = 0) => {
          for (const node of nodes) {
            flat.push({ ...node, depth });
            if (node.children) flatten(node.children, depth + 1);
          }
        };
        flatten(folderRes);
        setFolderList(flat);
        // Load nginx templates
        api
          .listNginxTemplates()
          .then((t) => setNginxTemplateList(t || []))
          .catch(() => {});
      } catch {
        // non-critical
      }
      try {
        const certRes = await api.listCertificates({
          limit: 100,
          status: "active",
          type: "tls-server",
        });
        setPkiCerts((certRes.data || []).map((c) => ({ id: c.id, commonName: c.commonName })));
      } catch {
        // non-critical
      }
    };
    loadRelated();
  }, []);

  // Load raw rendered config for this host
  const loadRawConfig = useCallback(async () => {
    if (!id || isNew) return;
    setIsLoadingRaw(true);
    try {
      const result = await api.getRenderedProxyConfig(id);
      setRawConfig(result.rendered);
      setRawConfigLoaded(true);
    } catch {
      setRawConfig("# Could not load rendered config. Save the host first.");
      setRawConfigLoaded(true);
    } finally {
      setIsLoadingRaw(false);
    }
  }, [id, isNew]);

  // SSE log stream
  const startLogStream = useCallback(() => {
    if (!id || isNew) return;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    const es = api.createLogStream(id);
    es.onmessage = (event) => {
      setLogLines((prev) => {
        const next = [...prev, event.data];
        if (next.length > 500) return next.slice(-500);
        return next;
      });
      if (logRef.current) {
        logRef.current.scrollTop = logRef.current.scrollHeight;
      }
    };
    es.onerror = () => {
      // Will auto-reconnect
    };
    eventSourceRef.current = es;
  }, [id, isNew]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const buildRequest = (): CreateProxyHostRequest => {
    const domains = domainNames.filter((d) => d.trim() !== "");
    const req: CreateProxyHostRequest = {
      type,
      domainNames: domains,
      websocketSupport,
      sslEnabled,
      sslForced,
      http2Support,
      sslCertificateId: sslCertificateId || undefined,
      internalCertificateId: internalCertificateId || undefined,
      customHeaders: customHeaders.filter((h) => h.name.trim() !== ""),
      cacheEnabled,
      cacheOptions: cacheEnabled ? { maxAge: cacheMaxAge } : undefined,
      rateLimitEnabled,
      rateLimitOptions: rateLimitEnabled
        ? { requestsPerSecond: rateLimitRPS, burst: rateLimitBurst }
        : undefined,
      customRewrites: customRewrites.filter((r) => r.source.trim() !== ""),
      advancedConfig: advancedConfig || undefined,
      accessListId: accessListId || undefined,
      folderId: folderId || undefined,
      nginxTemplateId: nginxTemplateId || undefined,
      templateVariables: Object.keys(templateVariables).length > 0 ? templateVariables : undefined,
      healthCheckEnabled,
      healthCheckUrl,
      healthCheckInterval,
      healthCheckExpectedStatus: healthCheckExpectedStatus ?? undefined,
      healthCheckExpectedBody: healthCheckExpectedBody || undefined,
    };
    if (type === "proxy") {
      req.forwardHost = forwardHost;
      req.forwardPort = forwardPort;
      req.forwardScheme = forwardScheme;
    }
    if (type === "redirect") {
      req.redirectUrl = redirectUrl;
      req.redirectStatusCode = redirectStatusCode;
    }
    return req;
  };

  const isFormValid = (() => {
    if (type === "proxy" && (forwardPort < 1 || forwardPort > 65535)) return false;
    if (cacheEnabled && cacheMaxAge < 1) return false;
    if (rateLimitEnabled && (rateLimitRPS < 1 || rateLimitBurst < 1)) return false;
    if (healthCheckEnabled && (healthCheckInterval < 5 || healthCheckInterval > 3600)) return false;
    return true;
  })();

  const handleSave = async () => {
    const domains = domainNames.filter((d) => d.trim() !== "");
    if (domains.length === 0) {
      toast.error("At least one domain name is required");
      return;
    }
    if (type === "proxy" && !forwardHost.trim()) {
      toast.error("Upstream host is required for proxy type");
      return;
    }
    if (type === "redirect" && !redirectUrl.trim()) {
      toast.error("Redirect URL is required");
      return;
    }

    setIsSaving(true);
    try {
      const data = buildRequest();
      if (isNew) {
        await api.createProxyHost(data);
        toast.success("Proxy host created");
      } else {
        await api.updateProxyHost(id!, data);
        toast.success("Proxy host updated");
      }
      navigate("/proxy-hosts");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save proxy host");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete Proxy Host",
      description: "Are you sure you want to delete this proxy host? This action cannot be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteProxyHost(id!);
      toast.success("Proxy host deleted");
      navigate("/proxy-hosts");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete proxy host");
    }
  };

  const handleValidate = async () => {
    try {
      const result = await api.validateProxyConfig(advancedConfig);
      setValidationResult(result);
      if (result.valid) {
        toast.success("Configuration is valid");
      } else {
        toast.error("Configuration has errors");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Validation failed");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="h-full flex flex-col p-6 gap-6 overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/proxy-hosts")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">
                  {isNew ? "New Proxy Host" : domainNames[0] || "Proxy Host"}
                </h1>
              </div>
              <p className="text-sm text-muted-foreground">
                {isNew ? "Configure a new proxy host" : "Edit proxy host settings"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isNew && hasRole("admin", "operator") && !isSystemHost && (
              <Button variant="outline" onClick={handleDelete}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            )}
            {hasRole("admin", "operator") && (
              <Button onClick={handleSave} disabled={isSaving || !isFormValid}>
                <Save className="h-4 w-4" />
                {isSaving ? "Saving..." : "Save"}
              </Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="details" className="flex flex-col flex-1 min-h-0">
          <TabsList className="shrink-0">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="ssl">SSL</TabsTrigger>
            <TabsTrigger value="custom">Custom Config</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
            <TabsTrigger value="access">Access List</TabsTrigger>
            <TabsTrigger value="health">Health Check</TabsTrigger>
            {!isNew && (
              <TabsTrigger
                value="raw"
                onClick={() => {
                  if (!rawConfigLoaded) loadRawConfig();
                }}
              >
                Raw Config
              </TabsTrigger>
            )}
            {!isNew && (
              <TabsTrigger value="logs" onClick={() => startLogStream()}>
                Logs
              </TabsTrigger>
            )}
          </TabsList>

          {/* Details Tab */}
          <TabsContent value="details" className="overflow-y-auto flex-1 min-h-0">
            <div className="border border-border bg-card p-6 space-y-6">
              {/* Type */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <Select value={type} onValueChange={(v) => setType(v as ProxyHostType)}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="proxy">Proxy</SelectItem>
                    <SelectItem value="redirect">Redirect</SelectItem>
                    <SelectItem value="404">404 (Block)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Folder */}
              {folderList.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Folder</label>
                  <Select
                    value={folderId || "__none__"}
                    onValueChange={(v) => setFolderId(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger className="w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None (ungrouped)</SelectItem>
                      {folderList.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {"  ".repeat(f.depth)}
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Config Template */}
              {nginxTemplateList.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Config Template</label>
                  <Select
                    value={nginxTemplateId || "__none__"}
                    onValueChange={(v) => {
                      setNginxTemplateId(v === "__none__" ? "" : v);
                      // Pre-fill defaults from template variables
                      if (v !== "__none__") {
                        const tmpl = nginxTemplateList.find((t) => t.id === v);
                        if (tmpl?.variables?.length) {
                          const defaults: Record<string, string | number | boolean> = {};
                          for (const vd of tmpl.variables) {
                            if (vd.default !== undefined) defaults[vd.name] = vd.default;
                          }
                          setTemplateVariables((prev) => ({ ...defaults, ...prev }));
                        }
                      }
                    }}
                  >
                    <SelectTrigger className="w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Default</SelectItem>
                      {nginxTemplateList
                        .filter((t) => t.type === type)
                        .map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Template Variables (auto-generated from template schema) */}
              {(() => {
                const selectedTemplate = nginxTemplateList.find((t) => t.id === nginxTemplateId);
                const vars = selectedTemplate?.variables;
                if (!vars?.length) return null;
                return (
                  <div className="space-y-3 border border-border p-4">
                    <h3 className="text-sm font-semibold">Template Variables</h3>
                    {vars.map((v) => (
                      <div key={v.name} className="space-y-1">
                        <label className="text-xs font-medium">{v.name}</label>
                        {v.description && (
                          <p className="text-xs text-muted-foreground">{v.description}</p>
                        )}
                        {v.type === "boolean" ? (
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={
                                templateVariables[v.name] === true ||
                                templateVariables[v.name] === "true"
                              }
                              onChange={(checked) =>
                                setTemplateVariables({ ...templateVariables, [v.name]: checked })
                              }
                            />
                          </div>
                        ) : v.type === "number" ? (
                          <Input
                            type="number"
                            value={String(templateVariables[v.name] ?? v.default ?? "")}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const next = { ...templateVariables };
                              if (raw) {
                                next[v.name] = Number(raw);
                              } else {
                                delete next[v.name];
                              }
                              setTemplateVariables(next);
                            }}
                            className="w-48"
                          />
                        ) : (
                          <Input
                            value={String(templateVariables[v.name] ?? v.default ?? "")}
                            onChange={(e) =>
                              setTemplateVariables({
                                ...templateVariables,
                                [v.name]: e.target.value,
                              })
                            }
                          />
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Domain Names */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Domain Names</label>
                <div className="space-y-2">
                  {domainNames.map((domain, i) => (
                    <div key={i} className="flex gap-2">
                      <DomainAutocompleteInput
                        value={domain}
                        onChange={(val) => {
                          const next = [...domainNames];
                          next[i] = val;
                          setDomainNames(next);
                        }}
                        placeholder="example.com"
                      />
                      {domainNames.length > 1 && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setDomainNames(domainNames.filter((_, j) => j !== i))}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDomainNames([...domainNames, ""])}
                  >
                    <Plus className="h-4 w-4" />
                    Add Domain
                  </Button>
                </div>
              </div>

              {/* Proxy-specific fields */}
              {type === "proxy" && (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Scheme</label>
                      <Select
                        value={forwardScheme}
                        onValueChange={(v) => setForwardScheme(v as ForwardScheme)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="http">HTTP</SelectItem>
                          <SelectItem value="https">HTTPS</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Forward Host</label>
                      <Input
                        value={forwardHost}
                        onChange={(e) => setForwardHost(e.target.value)}
                        placeholder="192.168.1.100"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Forward Port</label>
                      <NumericInput
                        value={forwardPort}
                        onChange={(v) => setForwardPort(v)}
                        min={1}
                        max={65535}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={websocketSupport} onChange={setWebsocketSupport} />
                    <span className="text-sm">WebSocket Support</span>
                  </div>
                </>
              )}

              {/* Redirect-specific fields */}
              {type === "redirect" && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Redirect URL</label>
                    <Input
                      value={redirectUrl}
                      onChange={(e) => setRedirectUrl(e.target.value)}
                      placeholder="https://example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Status Code</label>
                    <Select
                      value={String(redirectStatusCode)}
                      onValueChange={(v) => setRedirectStatusCode(parseInt(v, 10))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="301">301 - Permanent</SelectItem>
                        <SelectItem value="302">302 - Temporary</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* SSL Tab */}
          <TabsContent value="ssl" className="overflow-y-auto flex-1 min-h-0">
            <div className="border border-border bg-card p-6 space-y-6">
              <div className="flex items-center gap-3">
                <Switch checked={sslEnabled} onChange={setSslEnabled} />
                <span className="text-sm font-medium">SSL Enabled</span>
              </div>

              {sslEnabled && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                  className="space-y-6"
                >
                  <div className="flex items-center gap-3">
                    <Switch checked={sslForced} onChange={setSslForced} />
                    <span className="text-sm">Force HTTPS</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={http2Support} onChange={setHttp2Support} />
                    <span className="text-sm">HTTP/2 Support</span>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">SSL Certificate</label>
                    <Select
                      value={sslCertificateId || "__none__"}
                      onValueChange={(v) => setSslCertificateId(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select certificate..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {sslCerts.map((cert) => (
                          <SelectItem key={cert.id} value={cert.id}>
                            {cert.name} ({cert.type})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Internal PKI Certificate (alternative)
                    </label>
                    <Select
                      value={internalCertificateId || "__none__"}
                      onValueChange={(v) => setInternalCertificateId(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select internal cert..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {pkiCerts.map((cert) => (
                          <SelectItem key={cert.id} value={cert.id}>
                            {cert.commonName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </motion.div>
              )}
            </div>
          </TabsContent>

          {/* Custom Config Tab */}
          <TabsContent value="custom" className="overflow-y-auto flex-1 min-h-0">
            <div className="border border-border bg-card p-6 space-y-6">
              {/* Custom Headers */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Custom Headers</h3>
                {customHeaders.map((header, i) => (
                  <div key={i} className="flex gap-2">
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
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCustomHeaders([...customHeaders, { name: "", value: "" }])}
                >
                  <Plus className="h-4 w-4" />
                  Add Header
                </Button>
              </div>

              {/* Cache */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Switch checked={cacheEnabled} onChange={setCacheEnabled} />
                  <span className="text-sm font-semibold">Cache</span>
                </div>
                {cacheEnabled && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                    className="space-y-2"
                  >
                    <label className="text-sm">Max Age (seconds)</label>
                    <NumericInput
                      value={cacheMaxAge}
                      onChange={(v) => setCacheMaxAge(v)}
                      min={1}
                      className="w-40"
                    />
                  </motion.div>
                )}
              </div>

              {/* Rate Limit */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Switch checked={rateLimitEnabled} onChange={setRateLimitEnabled} />
                  <span className="text-sm font-semibold">Rate Limiting</span>
                </div>
                {rateLimitEnabled && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                    className="grid grid-cols-2 gap-4"
                  >
                    <div className="space-y-2">
                      <label className="text-sm">Requests Per Second</label>
                      <NumericInput
                        value={rateLimitRPS}
                        onChange={(v) => setRateLimitRPS(v)}
                        min={1}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm">Burst</label>
                      <NumericInput
                        value={rateLimitBurst}
                        onChange={(v) => setRateLimitBurst(v)}
                        min={1}
                      />
                    </div>
                  </motion.div>
                )}
              </div>

              {/* URL Rewrites */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">URL Rewrites</h3>
                {customRewrites.map((rule, i) => (
                  <div key={i} className="flex gap-2">
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
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCustomRewrites([
                      ...customRewrites,
                      { source: "", destination: "", type: "permanent" },
                    ])
                  }
                >
                  <Plus className="h-4 w-4" />
                  Add Rewrite
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* Advanced Tab */}
          <TabsContent value="advanced" className="overflow-y-auto flex-1 min-h-0">
            <div className="border border-border bg-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Custom Nginx Configuration</h3>
                <Button variant="outline" size="sm" onClick={handleValidate}>
                  Validate
                </Button>
              </div>
              <textarea
                className="w-full h-64 bg-background border border-input p-3 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={advancedConfig}
                onChange={(e) => {
                  setAdvancedConfig(e.target.value);
                  setValidationResult(null);
                }}
                placeholder="# Custom Nginx directives..."
              />
              {validationResult && (
                <div
                  className={cn(
                    "p-3 text-sm border",
                    validationResult.valid
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                      : "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400"
                  )}
                >
                  {validationResult.valid ? (
                    "Configuration is valid"
                  ) : (
                    <div className="space-y-1">
                      <p className="font-medium">Validation errors:</p>
                      {validationResult.errors?.map((err, i) => (
                        <p key={i}>{err}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Access List Tab */}
          <TabsContent value="access" className="overflow-y-auto flex-1 min-h-0">
            <div className="border border-border bg-card p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Access List</label>
                <Select
                  value={accessListId || "__none__"}
                  onValueChange={(v) => setAccessListId(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger>
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
                <p className="text-xs text-muted-foreground">
                  Assign an access list to restrict access via IP rules or basic authentication.
                </p>
              </div>
            </div>
          </TabsContent>

          {/* Health Check Tab */}
          <TabsContent value="health" className="overflow-y-auto flex-1 min-h-0">
            <div className="border border-border bg-card p-6 space-y-6">
              <div className="flex items-center gap-3">
                <Switch checked={healthCheckEnabled} onChange={setHealthCheckEnabled} />
                <span className="text-sm font-medium">Enable Health Checks</span>
              </div>

              {healthCheckEnabled && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Check URL Path</label>
                    <Input
                      value={healthCheckUrl}
                      onChange={(e) => setHealthCheckUrl(e.target.value)}
                      placeholder="/"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Interval (seconds)</label>
                    <NumericInput
                      value={healthCheckInterval}
                      onChange={(v) => setHealthCheckInterval(v)}
                      min={5}
                      max={3600}
                      className="w-40"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Expected Status Code</label>
                    <Input
                      type="number"
                      value={healthCheckExpectedStatus ?? ""}
                      onChange={(e) =>
                        setHealthCheckExpectedStatus(e.target.value ? Number(e.target.value) : null)
                      }
                      placeholder="Any 2xx"
                      className="w-40"
                    />
                    <p className="text-xs text-muted-foreground">
                      Leave empty to accept any 2xx status code.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Expected Response Body</label>
                    <Input
                      value={healthCheckExpectedBody}
                      onChange={(e) => setHealthCheckExpectedBody(e.target.value)}
                      placeholder="String to match in response"
                      maxLength={500}
                    />
                    <p className="text-xs text-muted-foreground">
                      If set, the response body must contain this string to be considered healthy.
                    </p>
                  </div>
                </motion.div>
              )}
            </div>
          </TabsContent>

          {/* Raw Config Tab */}
          {!isNew && (
            <TabsContent value="raw" className="flex flex-col flex-1 min-h-0">
              <div className="border border-border bg-card p-4 flex flex-col flex-1 min-h-0 gap-3">
                <div className="flex items-center justify-between shrink-0">
                  <div>
                    <h3 className="text-sm font-semibold">Rendered Nginx Config</h3>
                    <p className="text-xs text-muted-foreground">
                      The actual nginx server block generated from the template and this host's
                      settings.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadRawConfig}
                    disabled={isLoadingRaw}
                  >
                    {isLoadingRaw ? "Loading..." : "Refresh"}
                  </Button>
                </div>
                {isLoadingRaw && !rawConfigLoaded ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col">
                    <CodeEditor value={rawConfig} onChange={setRawConfig} readOnly />
                  </div>
                )}
              </div>
            </TabsContent>
          )}

          {/* Logs Tab */}
          {!isNew && (
            <TabsContent value="logs" className="flex flex-col flex-1 min-h-0">
              <div className="border border-border bg-card p-4 flex flex-col flex-1 min-h-0 gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Live Logs</h3>
                  <Button variant="outline" size="sm" onClick={() => setLogLines([])}>
                    Clear
                  </Button>
                </div>
                <pre
                  ref={logRef}
                  className="h-96 overflow-auto bg-background border border-input p-3 font-mono text-xs leading-relaxed"
                >
                  {logLines.length === 0 ? (
                    <span className="text-muted-foreground">Waiting for log events...</span>
                  ) : (
                    logLines.map((line, i) => <div key={i}>{line}</div>)
                  )}
                </pre>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </PageTransition>
  );
}
