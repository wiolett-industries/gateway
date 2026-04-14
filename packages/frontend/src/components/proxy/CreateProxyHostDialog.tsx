import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DomainAutocompleteInput } from "@/components/domains/DomainAutocompleteInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";
import { api } from "@/services/api";
import type {
  CreateProxyHostRequest,
  ForwardScheme,
  NginxTemplate,
  ProxyHost,
  ProxyHostFolder,
  ProxyHostType,
  SSLCertificate,
} from "@/types";
import { isNodeIncompatible } from "@/types";

interface CreateProxyHostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When editing, pre-fill with existing host data */
  existingHost?: ProxyHost | null;
  /** Called on successful create/update with the host ID */
  onSuccess?: (hostId: string) => void;
}

interface NodeOption {
  id: string;
  hostname: string;
  status: string;
  type: string;
}

const STEP_ANIMATION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const },
};

export function CreateProxyHostDialog({
  open,
  onOpenChange,
  existingHost,
  onSuccess,
}: CreateProxyHostDialogProps) {
  const isEditing = !!existingHost;

  // Step navigation
  const [step, setStep] = useState(1);

  // Step 1 — Basics
  const [type, setType] = useState<ProxyHostType>("proxy");
  const [nodeId, setNodeId] = useState<string>("");
  const [domainNames, setDomainNames] = useState<string[]>([""]);

  // Step 2 — Configuration: Proxy
  const [forwardHost, setForwardHost] = useState("");
  const [forwardPort, setForwardPort] = useState(80);
  const [forwardScheme, setForwardScheme] = useState<ForwardScheme>("http");
  const [websocketSupport, setWebsocketSupport] = useState(false);

  // Step 2 — Configuration: Redirect
  const [redirectUrl, setRedirectUrl] = useState("");
  const [redirectStatusCode, setRedirectStatusCode] = useState(301);

  // Step 2 — SSL
  const [sslEnabled, setSslEnabled] = useState(false);
  const [sslForced, setSslForced] = useState(false);
  const [http2Support, setHttp2Support] = useState(false);
  const [sslCertificateId, setSslCertificateId] = useState("");
  const [internalCertificateId, setInternalCertificateId] = useState("");

  // Step 2 — Template
  const [nginxTemplateId, setNginxTemplateId] = useState("");
  const [templateVariables, setTemplateVariables] = useState<
    Record<string, string | number | boolean>
  >({});

  // Step 2 — Folder
  const [folderId, setFolderId] = useState("");

  // Raw config mode (edit only)
  const [rawConfigEnabled, setRawConfigEnabled] = useState(false);

  // Step 2 — Health check
  const [healthCheckEnabled, setHealthCheckEnabled] = useState(true);
  const [healthCheckUrl, setHealthCheckUrl] = useState("/");
  const [healthCheckInterval, setHealthCheckInterval] = useState(30);
  const [healthCheckExpectedStatus, setHealthCheckExpectedStatus] = useState<number | null>(null);
  const [healthCheckExpectedBody, setHealthCheckExpectedBody] = useState("");

  // Saving state
  const [isSaving, setIsSaving] = useState(false);

  // Related data (fetched on open)
  const [nodes, setNodes] = useState<NodeOption[]>([]);
  const [sslCerts, setSslCerts] = useState<SSLCertificate[]>([]);
  const [nginxTemplateList, setNginxTemplateList] = useState<NginxTemplate[]>([]);
  const [folderList, setFolderList] = useState<ProxyHostFolder[]>([]);

  // Reset entire form to defaults
  const resetForm = useCallback(() => {
    setStep(1);

    setType("proxy");
    setNodeId("");
    setDomainNames([""]);
    setForwardHost("");
    setForwardPort(80);
    setForwardScheme("http");
    setWebsocketSupport(false);
    setRedirectUrl("");
    setRedirectStatusCode(301);
    setSslEnabled(false);
    setSslForced(false);
    setHttp2Support(false);
    setSslCertificateId("");
    setInternalCertificateId("");
    setNginxTemplateId("");
    setTemplateVariables({});
    setFolderId("");
    setRawConfigEnabled(false);
    setHealthCheckEnabled(true);
    setHealthCheckUrl("/");
    setHealthCheckInterval(30);
    setHealthCheckExpectedStatus(null);
    setHealthCheckExpectedBody("");
    setIsSaving(false);
  }, []);

  // Pre-fill from existingHost when it changes
  useEffect(() => {
    if (!existingHost) return;
    setType(existingHost.type);
    setNodeId((existingHost as any).nodeId || "");
    setDomainNames(existingHost.domainNames.length > 0 ? [...existingHost.domainNames] : [""]);
    setForwardHost(existingHost.forwardHost || "");
    setForwardPort(existingHost.forwardPort || 80);
    setForwardScheme(existingHost.forwardScheme || "http");
    setWebsocketSupport(existingHost.websocketSupport);
    setRedirectUrl(existingHost.redirectUrl || "");
    setRedirectStatusCode(existingHost.redirectStatusCode || 301);
    setSslEnabled(existingHost.sslEnabled);
    setSslForced(existingHost.sslForced);
    setHttp2Support(existingHost.http2Support);
    setSslCertificateId(existingHost.sslCertificateId || "");
    setInternalCertificateId(existingHost.internalCertificateId || "");
    setNginxTemplateId(existingHost.nginxTemplateId || "");
    setTemplateVariables(existingHost.templateVariables || {});
    setFolderId(existingHost.folderId || "");
    setRawConfigEnabled(existingHost.rawConfigEnabled ?? false);
    setHealthCheckEnabled(existingHost.healthCheckEnabled);
    setHealthCheckUrl(existingHost.healthCheckUrl || "/");
    setHealthCheckInterval(existingHost.healthCheckInterval || 30);
    setHealthCheckExpectedStatus(existingHost.healthCheckExpectedStatus ?? null);
    setHealthCheckExpectedBody(existingHost.healthCheckExpectedBody || "");
    setStep(1);
  }, [existingHost]);

  // Fetch related data when dialog opens
  useEffect(() => {
    if (!open) return;

    const load = async () => {
      try {
        const [nodeRes, sslRes, folderRes, templateRes] = await Promise.all([
          api.listNodes({ type: "nginx" }),
          api.listSSLCertificates({ limit: 100 }),
          api.listFolders(),
          api.listNginxTemplates(),
        ]);

        const compatible = (nodeRes.data ?? []).filter((n) => !isNodeIncompatible(n));
        setNodes(
          compatible.map((n) => ({
            id: n.id,
            hostname: n.displayName || n.hostname,
            status: n.status,
            type: n.type,
          }))
        );
        setSslCerts(sslRes.data || []);

        // Flatten folder tree
        const flat: ProxyHostFolder[] = [];
        const flatten = (items: typeof folderRes, depth = 0) => {
          for (const item of items) {
            flat.push({ ...item, depth });
            if ((item as any).children) flatten((item as any).children, depth + 1);
          }
        };
        flatten(folderRes);
        setFolderList(flat);

        setNginxTemplateList(templateRes || []);
      } catch {
        // non-critical
      }
    };

    load();
  }, [open]);

  // Auto-toggle health check when type changes
  useEffect(() => {
    if (type === "404") {
      setHealthCheckEnabled(false);
    } else {
      setHealthCheckEnabled(true);
    }
  }, [type]);

  // Derived: user templates matching current type
  const userTemplates = useMemo(
    () => nginxTemplateList.filter((t) => !t.isBuiltin && t.type === type),
    [nginxTemplateList, type]
  );

  // Derived: selected template for variable rendering
  const selectedTemplate = useMemo(
    () => nginxTemplateList.find((t) => t.id === nginxTemplateId),
    [nginxTemplateList, nginxTemplateId]
  );

  // Validation
  const isStep1Valid = nodeId !== "" && domainNames.some((d) => d.trim() !== "");

  const isStep2Valid = (() => {
    if (type === "proxy" && !forwardHost.trim()) return false;
    if (type === "redirect" && !redirectUrl.trim()) return false;
    if (sslEnabled && !sslCertificateId) return false;
    return true;
  })();

  // Navigation
  const goNext = () => setStep(2);
  const goBack = () => setStep(1);

  // Handle close
  const handleOpenChange = (value: boolean) => {
    if (!value) resetForm();
    onOpenChange(value);
  };

  // Build request payload
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
      folderId: folderId || undefined,
      rawConfigEnabled: isEditing ? rawConfigEnabled : undefined,
      nginxTemplateId: nginxTemplateId || undefined,
      templateVariables: Object.keys(templateVariables).length > 0 ? templateVariables : undefined,
      healthCheckEnabled,
      healthCheckUrl,
      healthCheckInterval,
      healthCheckExpectedStatus: healthCheckExpectedStatus ?? undefined,
      healthCheckExpectedBody: healthCheckExpectedBody || undefined,
      nodeId: nodeId || undefined,
    } as any;

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

  // Save handler
  const handleSave = async () => {
    if (!isEditing && !isStep2Valid) return;

    setIsSaving(true);
    try {
      const data = buildRequest();

      // When enabling raw mode: seed rawConfig, set type to raw, disable healthcheck
      if (isEditing && existingHost && rawConfigEnabled && !existingHost.rawConfigEnabled) {
        try {
          const rendered = await api.getRenderedProxyConfig(existingHost.id);
          data.rawConfig = rendered.rendered;
        } catch {
          // If we can't fetch rendered config, proceed without seeding
        }
        data.type = "raw";
        data.healthCheckEnabled = false;
      }

      // When disabling raw mode: restore original type
      if (isEditing && existingHost && !rawConfigEnabled && existingHost.rawConfigEnabled) {
        // Type stays as whatever user had before (stored in the data from step 1)
        // but if it's still "raw", reset to proxy
        if (data.type === "raw") data.type = "proxy";
      }

      if (isEditing && existingHost) {
        await api.updateProxyHost(existingHost.id, data);
        toast.success("Proxy host updated");
        onSuccess?.(existingHost.id);
      } else {
        const created = await api.createProxyHost(data);
        toast.success("Proxy host created");
        onSuccess?.(created.id);
      }
      resetForm();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save proxy host");
    } finally {
      setIsSaving(false);
    }
  };

  // Node status badge variant
  const nodeStatusVariant = (status: string) => {
    if (status === "online") return "success";
    if (status === "error") return "destructive";
    return "secondary";
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Proxy Host" : "Create Proxy Host"}</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Configure the basic settings for your proxy host."
              : "Set up forwarding, SSL, and advanced options."}
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step-1"
              initial={STEP_ANIMATION.initial}
              animate={STEP_ANIMATION.animate}
              transition={STEP_ANIMATION.transition}
              className="space-y-6"
            >
              {/* Type Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <Select
                  value={rawConfigEnabled ? "raw" : type}
                  onValueChange={(v) => setType(v as ProxyHostType)}
                  disabled={rawConfigEnabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {rawConfigEnabled && <SelectItem value="raw">Raw</SelectItem>}
                    <SelectItem value="proxy">Proxy</SelectItem>
                    <SelectItem value="redirect">Redirect</SelectItem>
                    <SelectItem value="404">404</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Node Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Node</label>
                <Select
                  value={nodeId || "__none__"}
                  onValueChange={(v) => setNodeId(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a node..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" disabled>
                      Select a node...
                    </SelectItem>
                    {nodes.map((node) => (
                      <SelectItem key={node.id} value={node.id}>
                        <div className="flex items-center justify-between w-full gap-3">
                          <span>{node.hostname}</span>
                          <Badge variant="secondary" className="text-xs capitalize">
                            {node.type}
                          </Badge>
                          <Badge variant={nodeStatusVariant(node.status)}>{node.status}</Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Domain Names */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Domain Names</label>
                <div className="space-y-2">
                  <AnimatePresence initial={false}>
                    {domainNames.map((domain, i) => (
                      <motion.div
                        key={`domain-${i}`}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                        className="flex gap-2"
                      >
                        <DomainAutocompleteInput
                          value={domain}
                          onChange={(v) => {
                            const next = [...domainNames];
                            next[i] = v;
                            setDomainNames(next);
                          }}
                          placeholder="example.com"
                        />
                        {domainNames.length > 1 && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 shrink-0"
                            onClick={() => setDomainNames(domainNames.filter((_, j) => j !== i))}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                        )}
                        {i === domainNames.length - 1 && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 shrink-0"
                            onClick={() => setDomainNames([...domainNames, ""])}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>

              {/* Raw mode toggle — only when editing */}
              {isEditing && (
                <div className="border border-border bg-card">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">Raw Config Mode</p>
                      <p className="text-xs text-muted-foreground">
                        Bypass template rendering and edit nginx config directly
                      </p>
                    </div>
                    <Switch checked={rawConfigEnabled} onChange={setRawConfigEnabled} />
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {step === 2 && !isEditing && (
            <motion.div
              key="step-2"
              initial={STEP_ANIMATION.initial}
              animate={STEP_ANIMATION.animate}
              transition={STEP_ANIMATION.transition}
              className="space-y-4"
            >
              {/* Forwarding / Redirect card */}
              {type === "proxy" && (
                <div className="border border-border bg-card">
                  <div className="border-b border-border p-4">
                    <h2 className="font-semibold text-sm">Forwarding</h2>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">
                          Forward Host
                        </label>
                        <Input
                          value={forwardHost}
                          onChange={(e) => setForwardHost(e.target.value)}
                          placeholder="192.168.1.100"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">
                          Forward Port
                        </label>
                        <NumericInput
                          value={forwardPort}
                          onChange={(v) => setForwardPort(v)}
                          min={1}
                          max={65535}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Scheme</label>
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
                    </div>
                    <div className="flex items-center justify-between px-1">
                      <div>
                        <p className="text-sm font-medium">Websocket Support</p>
                        <p className="text-xs text-muted-foreground">Enable WebSocket proxying</p>
                      </div>
                      <Switch checked={websocketSupport} onChange={setWebsocketSupport} />
                    </div>
                  </div>
                </div>
              )}

              {type === "redirect" && (
                <div className="border border-border bg-card">
                  <div className="border-b border-border p-4">
                    <h2 className="font-semibold text-sm">Redirect</h2>
                  </div>
                  <div className="p-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">
                          Redirect URL
                        </label>
                        <Input
                          value={redirectUrl}
                          onChange={(e) => setRedirectUrl(e.target.value)}
                          placeholder="https://example.com"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">
                          Status Code
                        </label>
                        <Select
                          value={String(redirectStatusCode)}
                          onValueChange={(v) => setRedirectStatusCode(Number(v))}
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
                  </div>
                </div>
              )}

              {/* SSL card — always visible, inner controls disabled when SSL off */}
              <div className="border border-border bg-card">
                <div className="divide-y divide-border">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">SSL Enabled</p>
                      <p className="text-xs text-muted-foreground">Serve this host over HTTPS</p>
                    </div>
                    <Switch checked={sslEnabled} onChange={setSslEnabled} />
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className={cn(!sslEnabled && "opacity-50")}>
                      <p className="text-sm font-medium">Force HTTPS</p>
                      <p className="text-xs text-muted-foreground">Redirect HTTP to HTTPS</p>
                    </div>
                    <Switch checked={sslForced} onChange={setSslForced} disabled={!sslEnabled} />
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className={cn(!sslEnabled && "opacity-50")}>
                      <p className="text-sm font-medium">HTTP/2</p>
                      <p className="text-xs text-muted-foreground">
                        Enable HTTP/2 protocol support
                      </p>
                    </div>
                    <Switch
                      checked={http2Support}
                      onChange={setHttp2Support}
                      disabled={!sslEnabled}
                    />
                  </div>
                  <div className={cn("px-4 py-3", !sslEnabled && "opacity-50 pointer-events-none")}>
                    <label className="text-xs font-medium text-muted-foreground">
                      SSL Certificate
                    </label>
                    <Select
                      value={sslCertificateId || "__none__"}
                      onValueChange={(v) => setSslCertificateId(v === "__none__" ? "" : v)}
                      disabled={!sslEnabled}
                    >
                      <SelectTrigger className="mt-1">
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
                </div>
              </div>

              {/* Config Template card */}
              {userTemplates.length > 0 && (
                <div className="border border-border bg-card">
                  <div className="border-b border-border p-4">
                    <h2 className="font-semibold text-sm">Config Template</h2>
                  </div>
                  <div className="p-4 space-y-4">
                    <Select
                      value={nginxTemplateId || "__none__"}
                      onValueChange={(v) => {
                        const newId = v === "__none__" ? "" : v;
                        setNginxTemplateId(newId);
                        if (newId) {
                          const tmpl = nginxTemplateList.find((t) => t.id === newId);
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
                      <SelectTrigger>
                        <SelectValue placeholder="Default template" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Default template</SelectItem>
                        {userTemplates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {selectedTemplate?.variables && selectedTemplate.variables.length > 0 && (
                      <div className="space-y-3 border border-border p-3">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Template Variables
                        </h4>
                        {selectedTemplate.variables.map((v) => (
                          <div key={v.name} className="space-y-1">
                            <label className="text-xs font-medium">{v.name}</label>
                            {v.description && (
                              <p className="text-xs text-muted-foreground">{v.description}</p>
                            )}
                            {v.type === "boolean" ? (
                              <Switch
                                checked={
                                  templateVariables[v.name] === true ||
                                  templateVariables[v.name] === "true"
                                }
                                onChange={(checked) =>
                                  setTemplateVariables({ ...templateVariables, [v.name]: checked })
                                }
                              />
                            ) : v.type === "number" ? (
                              <NumericInput
                                value={Number(templateVariables[v.name] ?? v.default ?? 0)}
                                onChange={(num) =>
                                  setTemplateVariables({ ...templateVariables, [v.name]: num })
                                }
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
                    )}
                  </div>
                </div>
              )}

              {/* Folder selector */}
              {folderList.length > 0 && (
                <div className="border border-border bg-card">
                  <div className="px-4 py-3">
                    <label className="text-xs font-medium text-muted-foreground">Folder</label>
                    <Select
                      value={folderId || "__none__"}
                      onValueChange={(v) => setFolderId(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="No folder" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No folder</SelectItem>
                        {folderList.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {"  ".repeat(f.depth) + f.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <DialogFooter>
          {isEditing ? (
            <Button onClick={handleSave} disabled={!isStep1Valid || isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          ) : step === 1 ? (
            <Button onClick={goNext} disabled={!isStep1Valid}>
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <div className="flex w-full items-center justify-between">
              <Button variant="outline" onClick={goBack}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button onClick={handleSave} disabled={!isStep2Valid || isSaving}>
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Create
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
