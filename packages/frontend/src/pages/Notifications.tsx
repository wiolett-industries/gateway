import { json as cmJson } from "@codemirror/lang-json";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, Decoration, keymap, lineNumbers, placeholder as cmPlaceholder, drawSelection, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bell,
  CheckCircle2,
  Clock,
  HelpCircle,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  Send,
  Trash2,
  Webhook,
  XCircle,
} from "lucide-react";
import React, { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
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
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type {
  AlertCategoryDef,
  AlertRule,
  NotificationWebhook,
  WebhookDelivery,
  WebhookPreset,
} from "@/types";

const TABS = [
  { value: "alerts", label: "Alerts", icon: AlertTriangle },
  { value: "webhooks", label: "Webhooks", icon: Webhook },
  { value: "deliveries", label: "Delivery Log", icon: Send },
] as const;

const SEV_BADGE: Record<string, "warning" | "destructive" | "secondary"> = {
  info: "secondary",
  warning: "warning",
  critical: "destructive",
};

const STATUS_BADGE: Record<string, "success" | "destructive" | "warning" | "secondary"> = {
  success: "success",
  failed: "destructive",
  retrying: "warning",
  pending: "secondary",
};

const STEP_ANIMATION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const },
};

export function Notifications() {
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const { hasScope } = useAuthStore();
  const canManage = hasScope("notifications:manage");
  const activeTab = tabParam && TABS.some((t) => t.value === tabParam) ? tabParam : "alerts";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Bell className="h-6 w-6" />
        <h1 className="text-2xl font-semibold">Notifications</h1>
      </div>
      <Tabs value={activeTab} onValueChange={(v) => navigate(`/notifications/${v}`, { replace: true })}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="flex items-center gap-2">
              <t.icon className="h-4 w-4" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="alerts" className="mt-4"><AlertsTab canManage={canManage} /></TabsContent>
        <TabsContent value="webhooks" className="mt-4"><WebhooksTab canManage={canManage} /></TabsContent>
        <TabsContent value="deliveries" className="mt-4"><DeliveryLogTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Alerts Tab ──────────────────────────────────────────────────────

function AlertsTab({ canManage }: { canManage: boolean }) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try { setRules((await api.listAlertRules({ limit: 100 })).data); }
    catch { toast.error("Failed to load alerts"); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (rule: AlertRule) => {
    try { await api.updateAlertRule(rule.id, { enabled: !rule.enabled }); load(); }
    catch { toast.error("Failed to toggle"); }
  };

  const del = async (rule: AlertRule) => {
    if (!await confirm({ title: "Delete Alert", description: `Delete "${rule.name}"?`, confirmLabel: "Delete" })) return;
    try { await api.deleteAlertRule(rule.id); toast.success("Deleted"); load(); }
    catch { toast.error("Failed"); }
  };

  const openEdit = (rule: AlertRule) => { setEditingRule(rule); setDialogOpen(true); };
  const openCreate = () => { setEditingRule(null); setDialogOpen(true); };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Alerts define conditions that trigger notifications to webhooks.</p>
        {canManage && <Button onClick={openCreate}><Plus className="h-4 w-4" /> New Alert</Button>}
      </div>
      {rules.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="No alerts" description="Create an alert to start receiving notifications." />
      ) : (
        <div className="border border-border bg-card">
          <div className="overflow-x-auto -mb-px">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="p-3 text-xs font-medium text-muted-foreground">Name</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Category</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Condition</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Scope</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Severity</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Webhooks</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground w-16">Active</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rules.map((r) => (
                  <tr key={r.id} className="hover:bg-accent transition-colors cursor-pointer" onClick={() => openEdit(r)}>
                    <td className="p-3"><span className="text-sm font-medium">{r.name}</span></td>
                    <td className="p-3"><Badge variant="secondary">{r.category}</Badge></td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {r.type === "threshold"
                        ? `${r.metric} ${r.operator} ${r.thresholdValue}${r.durationSeconds ? ` for ${Math.round(r.durationSeconds / 60)}m` : ""}`
                        : r.eventPattern ?? "—"}
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">{r.resourceIds.length === 0 ? "All" : `${r.resourceIds.length} selected`}</td>
                    <td className="p-3"><Badge variant={SEV_BADGE[r.severity]}>{r.severity}</Badge></td>
                    <td className="p-3"><Badge variant="secondary">{r.webhookIds.length}</Badge></td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <Switch checked={r.enabled} onChange={() => { if (canManage) toggle(r); }} disabled={!canManage} />
                    </td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /> Edit</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => del(r)} className="text-destructive"><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen} rule={editingRule} onSaved={load} />
    </div>
  );
}

// ── Alert Dialog (3-step wizard) ────────────────────────────────────

const STEP_LABELS = ["Configuration", "Scope & Webhooks", "Message"];

function AlertDialog({ open, onOpenChange, rule, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; rule: AlertRule | null; onSaved: () => void;
}) {
  const isEdit = !!rule;
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<AlertCategoryDef[]>([]);
  const [webhooks, setWebhooks] = useState<NotificationWebhook[]>([]);
  const [availableResources, setAvailableResources] = useState<Array<{ id: string; label: string }>>([]);
  const [resourceSearch, setResourceSearch] = useState("");
  const [webhookSearch, setWebhookSearch] = useState("");
  const editorRef = useRef<TemplateEditorHandle>(null); // retained for cheatsheet click-to-insert (future)

  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("node");
  const [type, setType] = useState<string>("threshold");
  const [severity, setSeverity] = useState<string>("warning");
  const [metric, setMetric] = useState("");
  const [operator, setOperator] = useState(">");
  const [thresholdValue, setThresholdValue] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("0");
  const [resolveAfterMinutes, setResolveAfterMinutes] = useState("1");
  const [eventPattern, setEventPattern] = useState("");
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [scopeEnabled, setScopeEnabled] = useState(false);
  const [messageTemplate, setMessageTemplate] = useState("");
  const [selectedWebhookIds, setSelectedWebhookIds] = useState<string[]>([]);
  const [cooldownSeconds, setCooldownSeconds] = useState("900");

  useEffect(() => {
    if (!open) return;
    catInitRef.current = false;
    setStep(1);
    setName(rule?.name ?? "");
    setCategory(rule?.category ?? "node");
    setType(rule?.type ?? "threshold");
    setSeverity(rule?.severity ?? "warning");
    setMetric(rule?.metric ?? "");
    setOperator(rule?.operator ?? ">");
    setThresholdValue(String(rule?.thresholdValue ?? ""));
    setDurationMinutes(String(rule?.durationSeconds ? Math.round(rule.durationSeconds / 60) : 0));
    setResolveAfterMinutes(String(rule?.resolveAfterSeconds != null ? Math.round(rule.resolveAfterSeconds / 60) : 1));
    setEventPattern(rule?.eventPattern ?? "");
    setResourceIds(rule?.resourceIds ?? []);
    setScopeEnabled(!!rule && rule.resourceIds.length > 0);
    setMessageTemplate(rule?.messageTemplate ?? "");
    setSelectedWebhookIds(rule?.webhookIds ?? []);
    setCooldownSeconds(String(rule?.cooldownSeconds ?? 900));
    setResourceSearch("");
    setWebhookSearch("");
    api.getAlertCategories().then(setCategories).catch(() => {});
    api.listWebhooks({ limit: 100 }).then((r) => setWebhooks(r.data)).catch(() => {});
  }, [open, rule]);

  useEffect(() => {
    if (!open) return;
    setAvailableResources([]);
    if (category === "node") {
      api.listNodes({ limit: 100 }).then((r) =>
        setAvailableResources(r.data.map((n: any) => ({ id: n.id, label: n.displayName || n.hostname })))
      ).catch(() => {});
    } else if (category === "proxy") {
      api.listProxyHosts({ limit: 100 }).then((r) =>
        setAvailableResources((r.data ?? []).map((p: any) => ({ id: p.id, label: Array.isArray(p.domainNames) ? p.domainNames[0] : p.id })))
      ).catch(() => {});
    } else if (category === "certificate") {
      api.listSSLCertificates({ limit: 100 }).then((r) =>
        setAvailableResources((r.data ?? []).map((c: any) => ({ id: c.id, label: c.name || c.id })))
      ).catch(() => {});
    } else if (category === "container") {
      api.listNodes({ limit: 100, type: "docker" }).then(async (r) => {
        const all: Array<{ id: string; label: string }> = [];
        for (const node of r.data) {
          try {
            const containers = await api.listDockerContainers(node.id);
            for (const c of containers) all.push({ id: c.name || c.id, label: `${c.name} (${(node as any).displayName || (node as any).hostname})` });
          } catch { /* skip */ }
        }
        setAvailableResources(all);
      }).catch(() => {});
    }
  }, [open, category]);

  const cat = categories.find((c) => c.id === category);

  // Auto-fix type and set defaults when category changes (skip in edit mode on first load)
  const catInitRef = useRef(false);
  useEffect(() => {
    if (!cat) return;
    // Skip the first run in edit mode (categories just loaded, don't overwrite saved values)
    if (isEdit && !catInitRef.current) { catInitRef.current = true; return; }
    // If current type isn't available in new category, switch to available one
    const hasMetrics = cat.metrics.length > 0;
    const hasEvents = cat.events.length > 0;
    let effectiveType = type;
    if (type === "threshold" && !hasMetrics && hasEvents) {
      effectiveType = "event";
      setType("event");
    } else if (type === "event" && !hasEvents && hasMetrics) {
      effectiveType = "threshold";
      setType("threshold");
    }
    // Set defaults for the effective type
    if (effectiveType === "threshold" && hasMetrics) {
      const m = cat.metrics[0];
      setMetric(m.id); setOperator(m.defaultOperator); setThresholdValue(String(m.defaultValue));
    }
    if (effectiveType === "event" && hasEvents) {
      setEventPattern(cat.events[0].id);
    }
  }, [category, cat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset metric/event defaults when type changes within same category
  useEffect(() => {
    if (isEdit || !cat) return;
    if (type === "threshold" && cat.metrics.length > 0 && !cat.metrics.some((m) => m.id === metric)) {
      const m = cat.metrics[0];
      setMetric(m.id); setOperator(m.defaultOperator); setThresholdValue(String(m.defaultValue));
    }
    if (type === "event" && cat.events.length > 0 && !cat.events.some((e) => e.id === eventPattern)) {
      setEventPattern(cat.events[0].id);
    }
  }, [type, cat, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleResource = (id: string) => setResourceIds((prev) => prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]);
  const toggleWebhook = (id: string) => setSelectedWebhookIds((prev) => prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]);

  const filteredResources = resourceSearch
    ? availableResources.filter((r) => r.label.toLowerCase().includes(resourceSearch.toLowerCase()))
    : availableResources;

  const filteredWebhooks = webhookSearch
    ? webhooks.filter((w) => w.name.toLowerCase().includes(webhookSearch.toLowerCase()))
    : webhooks;

  const canProceedFromStep1 = () => {
    if (!name.trim()) return false;
    if (type === "threshold" && (!metric || !thresholdValue)) return false;
    if (type === "event" && !eventPattern) return false;
    return true;
  };

  const handleSave = async () => {
    if (selectedWebhookIds.length === 0) { toast.error("Select at least one webhook"); return; }
    const cooldownNum = Number(cooldownSeconds);
    if (Number.isNaN(cooldownNum) || cooldownNum < 0) { toast.error("Invalid cooldown value"); return; }
    if (type === "threshold") {
      const tv = Number(thresholdValue);
      if (Number.isNaN(tv)) { toast.error("Invalid threshold value"); return; }
      const dur = Number(durationMinutes);
      if (Number.isNaN(dur) || dur < 0) { toast.error("Invalid duration value"); return; }
      const res = Number(resolveAfterMinutes);
      if (Number.isNaN(res) || res < 0) { toast.error("Invalid resolve-after value"); return; }
    }
    setSaving(true);
    try {
      const data: any = {
        name: name.trim(), category, type, severity,
        cooldownSeconds: cooldownNum,
        messageTemplate: messageTemplate || undefined,
        webhookIds: selectedWebhookIds,
        resourceIds: scopeEnabled ? resourceIds : [],
        enabled: rule?.enabled ?? true,
      };
      if (type === "threshold") {
        data.metric = metric; data.operator = operator;
        data.thresholdValue = Number(thresholdValue);
        data.durationSeconds = Number(durationMinutes) * 60;
        data.resolveAfterSeconds = Number(resolveAfterMinutes) * 60;
      } else {
        data.eventPattern = eventPattern;
        data.durationSeconds = 0;
        data.resolveAfterSeconds = 0;
      }
      if (isEdit) { await api.updateAlertRule(rule!.id, data); toast.success("Alert updated"); }
      else { await api.createAlertRule(data); toast.success("Alert created"); }
      onOpenChange(false); onSaved();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to save"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Alert" : "New Alert"}</DialogTitle>
          <DialogDescription>
            Step {step} of 3 — {STEP_LABELS[step - 1]}
          </DialogDescription>
        </DialogHeader>

        <AnimatedHeight>
          <AnimatePresence mode="wait">
            {/* ── Step 1: Configuration ── */}
            {step === 1 && (
              <motion.div key="step-1" {...STEP_ANIMATION} className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CPU High Alert" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Severity</label>
                    <Select value={severity} onValueChange={setSeverity}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Category</label>
                    <Select value={category} onValueChange={(v) => { setCategory(v); setMetric(""); setEventPattern(""); }} disabled={categories.length === 0}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Alert Type</label>
                    <Select value={type} onValueChange={setType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {cat && cat.metrics.length > 0 && <SelectItem value="threshold">Threshold</SelectItem>}
                        {cat && cat.events.length > 0 && <SelectItem value="event">Event</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {type === "threshold" && cat && cat.metrics.length > 1 && (
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Metric</label>
                      <Select value={metric} onValueChange={setMetric}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{cat.metrics.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Operator</label>
                      <Select value={operator} onValueChange={setOperator}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value=">">&gt;</SelectItem><SelectItem value=">=">&gt;=</SelectItem>
                          <SelectItem value="<">&lt;</SelectItem><SelectItem value="<=">&lt;=</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Value</label>
                      <Input type="number" value={thresholdValue} onChange={(e) => setThresholdValue(e.target.value)} />
                    </div>
                  </div>
                )}
                {type === "threshold" && cat && cat.metrics.length === 1 && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Operator</label>
                      <Select value={operator} onValueChange={setOperator}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value=">">&gt;</SelectItem><SelectItem value=">=">&gt;=</SelectItem>
                          <SelectItem value="<">&lt;</SelectItem><SelectItem value="<=">&lt;=</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">{cat.metrics[0].label}</label>
                      <Input type="number" value={thresholdValue} onChange={(e) => setThresholdValue(e.target.value)} />
                    </div>
                  </div>
                )}
                {type === "threshold" && (
                  <div className="grid grid-cols-2 gap-4">
                    {category !== "certificate" && (
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Fire after (minutes)</label>
                        <Input type="number" min="0" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
                        <p className="text-xs text-muted-foreground">Must exceed threshold for this long. 0 = instant.</p>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Resolve after (minutes)</label>
                      <Input type="number" min="0" value={resolveAfterMinutes} onChange={(e) => setResolveAfterMinutes(e.target.value)} />
                      <p className="text-xs text-muted-foreground">Must stay below threshold before resolving.</p>
                    </div>
                    <div className={`space-y-1.5${category !== "certificate" ? " col-span-2" : ""}`}>
                      <label className="text-sm font-medium">Cooldown (seconds)</label>
                      <Input type="number" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(e.target.value)} />
                      <p className="text-xs text-muted-foreground">Won't re-fire within this period.</p>
                    </div>
                  </div>
                )}

                {type === "event" && cat && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Event</label>
                      <Select value={eventPattern} onValueChange={setEventPattern}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{cat.events.map((e) => <SelectItem key={e.id} value={e.id}>{e.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Cooldown (seconds)</label>
                      <Input type="number" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(e.target.value)} />
                      <p className="text-xs text-muted-foreground">Won't re-fire within this period.</p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Step 2: Scope & Webhooks ── */}
            {step === 2 && (
              <motion.div key="step-2" {...STEP_ANIMATION} className="space-y-5">
                {/* Scope */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Limit to specific {cat?.label?.toLowerCase() ?? category}s</p>
                      <p className="text-xs text-muted-foreground">
                        {scopeEnabled ? "Only selected resources will trigger this alert." : `Alert applies to all ${cat?.label?.toLowerCase() ?? category}s.`}
                      </p>
                    </div>
                    <Switch checked={scopeEnabled} onChange={(v) => { setScopeEnabled(v); if (!v) setResourceIds([]); }} />
                  </div>
                  <div className={`border border-border transition-opacity ${scopeEnabled ? "" : "opacity-40 pointer-events-none"}`}>
                    <Input
                      value={resourceSearch}
                      onChange={(e) => setResourceSearch(e.target.value)}
                      placeholder="Search resources..."
                      className="border-0 border-b border-border rounded-none h-9 text-sm focus-visible:ring-0"
                      disabled={!scopeEnabled}
                    />
                    <div className="max-h-[30vh] overflow-y-auto">
                      {filteredResources.length === 0 ? (
                        <p className="p-3 text-sm text-muted-foreground">No resources found.</p>
                      ) : filteredResources.map((res) => (
                        <label key={res.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-accent cursor-pointer text-sm">
                          <input type="checkbox" checked={resourceIds.includes(res.id)} onChange={() => toggleResource(res.id)} className="rounded" disabled={!scopeEnabled} />
                          {res.label}
                        </label>
                      ))}
                    </div>
                    <div className="border-t border-border px-3 py-1.5">
                      <p className="text-xs text-muted-foreground">{scopeEnabled ? `${resourceIds.length} selected` : "All resources"}</p>
                    </div>
                  </div>
                </div>

                {/* Webhooks */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Send to Webhooks</label>
                  {webhooks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No webhooks configured. Create a webhook first.</p>
                  ) : (
                    <div className="border border-border">
                      <Input
                        value={webhookSearch}
                        onChange={(e) => setWebhookSearch(e.target.value)}
                        placeholder="Search webhooks..."
                        className="border-0 border-b border-border rounded-none h-9 text-sm focus-visible:ring-0"
                      />
                      <div className="max-h-[25vh] overflow-y-auto">
                        {filteredWebhooks.map((wh) => (
                          <label key={wh.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-accent cursor-pointer text-sm">
                            <input type="checkbox" checked={selectedWebhookIds.includes(wh.id)} onChange={() => toggleWebhook(wh.id)} className="rounded" />
                            <span className="font-medium">{wh.name}</span>
                            <span className="text-muted-foreground text-xs ml-auto">{wh.templatePreset ?? "custom"}</span>
                          </label>
                        ))}
                      </div>
                      <div className="border-t border-border px-3 py-1.5">
                        <p className="text-xs text-muted-foreground">{selectedWebhookIds.length} selected</p>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ── Step 3: Message ── */}
            {step === 3 && (
              <motion.div key="step-3" {...STEP_ANIMATION} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Message Template</label>
                  <TemplateEditor ref={editorRef} value={messageTemplate} onChange={setMessageTemplate} minHeight={300} />
                  <TemplateCheatsheetLink variables={[...(cat?.variables ?? []), ...UNIVERSAL_VARIABLES.filter((u) => !(cat?.variables ?? []).some((v) => v.name === u.name))]} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </AnimatedHeight>

        <DialogFooter>
          {step === 1 && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => setStep(2)} disabled={!canProceedFromStep1()}>Next <ArrowRight className="h-4 w-4 ml-1" /></Button>
            </>
          )}
          {step === 2 && (
            <div className="flex w-full justify-between">
              <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
              <Button onClick={() => setStep(3)} disabled={selectedWebhookIds.length === 0}>Next <ArrowRight className="h-4 w-4 ml-1" /></Button>
            </div>
          )}
          {step === 3 && (
            <div className="flex w-full justify-between">
              <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : isEdit ? "Update" : "Create"}</Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Webhooks Tab ────────────────────────────────────────────────────

function WebhooksTab({ canManage }: { canManage: boolean }) {
  const [webhooks, setWebhooks] = useState<NotificationWebhook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWh, setEditingWh] = useState<NotificationWebhook | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try { setWebhooks((await api.listWebhooks({ limit: 100 })).data); }
    catch { toast.error("Failed to load webhooks"); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (wh: NotificationWebhook) => {
    try { await api.updateWebhook(wh.id, { enabled: !wh.enabled }); load(); }
    catch { toast.error("Failed"); }
  };

  const del = async (wh: NotificationWebhook) => {
    if (!await confirm({ title: "Delete Webhook", description: `Delete "${wh.name}"?`, confirmLabel: "Delete" })) return;
    try { await api.deleteWebhook(wh.id); toast.success("Deleted"); load(); }
    catch { toast.error("Failed"); }
  };

  const test = async (wh: NotificationWebhook) => {
    try {
      const r = await api.testWebhook(wh.id);
      r.success ? toast.success(`Test succeeded (HTTP ${r.statusCode})`) : toast.error(`Test failed: ${r.error ?? `HTTP ${r.statusCode}`}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Test failed"); }
  };

  const openEdit = (wh: NotificationWebhook) => { setEditingWh(wh); setDialogOpen(true); };
  const openCreate = () => { setEditingWh(null); setDialogOpen(true); };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Webhooks define where and how notifications are delivered.</p>
        {canManage && <Button onClick={openCreate}><Plus className="h-4 w-4" /> New Webhook</Button>}
      </div>
      {webhooks.length === 0 ? (
        <EmptyState icon={Webhook} title="No webhooks" description="Create a webhook to configure notification delivery." />
      ) : (
        <div className="border border-border bg-card">
          <div className="overflow-x-auto -mb-px">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="p-3 text-xs font-medium text-muted-foreground">Name</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">URL</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Method</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Preset</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground w-16">Active</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {webhooks.map((wh) => (
                  <tr key={wh.id} className="hover:bg-accent transition-colors cursor-pointer" onClick={() => openEdit(wh)}>
                    <td className="p-3"><span className="text-sm font-medium">{wh.name}</span></td>
                    <td className="p-3"><span className="text-sm text-muted-foreground font-mono truncate block max-w-[300px]">{wh.url}</span></td>
                    <td className="p-3"><Badge variant="secondary">{wh.method}</Badge></td>
                    <td className="p-3">{wh.templatePreset ? <Badge variant="secondary">{wh.templatePreset}</Badge> : <span className="text-xs text-muted-foreground">custom</span>}</td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <Switch checked={wh.enabled} onChange={() => { if (canManage) toggle(wh); }} disabled={!canManage} />
                    </td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => test(wh)}><Send className="h-4 w-4" /> Test</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEdit(wh)}><Pencil className="h-4 w-4" /> Edit</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => del(wh)} className="text-destructive"><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <WebhookDialog open={dialogOpen} onOpenChange={setDialogOpen} webhook={editingWh} onSaved={load} />
    </div>
  );
}

// ── Webhook Dialog ──────────────────────────────────────────────────

const UNIVERSAL_VARIABLES = [
  { name: '{{message}}', description: "Alert's rendered message" },
  { name: '{{title}}', description: 'Alert title' },
  { name: '{{alert_name}}', description: 'Alert rule name' },
  { name: '{{severity}}', description: 'Alert severity' },
  { name: '{{severity_emoji}}', description: 'Severity emoji' },
  { name: '{{severity_color}}', description: 'Severity color (int)' },
  { name: '{{resource.name}}', description: 'Resource display name' },
  { name: '{{resource.id}}', description: 'Resource ID' },
  { name: '{{resource.type}}', description: 'Resource type' },
  { name: '{{timestamp}}', description: 'ISO timestamp' },
  { name: '{{value}}', description: 'Current metric value' },
  { name: '{{threshold}}', description: 'Configured threshold' },
  { name: '{{operator}}', description: 'Comparison operator' },
  { name: '{{metric}}', description: 'Metric name' },
  { name: '{{duration}}', description: 'Fire-after duration (seconds)' },
  { name: '{{node_name}}', description: 'Node hostname' },
  { name: '{{fired_at}}', description: 'When alert started firing' },
  { name: '{{fired_duration}}', description: 'Seconds alert was firing' },
  { name: '{{event}}', description: 'Event type' },
  { name: '{{gateway_url}}', description: 'Gateway URL' },
];

function WebhookDialog({ open, onOpenChange, webhook, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; webhook: NotificationWebhook | null; onSaved: () => void;
}) {
  const isEdit = !!webhook;
  const [saving, setSaving] = useState(false);
  const [presets, setPresets] = useState<WebhookPreset[]>([]);
  const [step, setStep] = useState(1);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState("POST");
  const [preset, setPreset] = useState("json");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [signingHeader, setSigningHeader] = useState("X-Signature-256");
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>([{ key: "", value: "" }]);

  const bodyEditorRef = useRef<TemplateEditorHandle>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setName(webhook?.name ?? "");
    setUrl(webhook?.url ?? "");
    setMethod(webhook?.method ?? "POST");
    setPreset(webhook?.templatePreset ?? "json");
    setBodyTemplate(webhook?.bodyTemplate ?? "");
    setSigningSecret("");
    setSigningHeader(webhook?.signingHeader ?? "X-Signature-256");
    const wHeaders = webhook?.headers as Record<string, string> | null;
    if (wHeaders && Object.keys(wHeaders).length > 0) {
      setHeaders([...Object.entries(wHeaders).map(([key, value]) => ({ key, value })), { key: "", value: "" }]);
    } else {
      setHeaders([{ key: "", value: "" }]);
    }
    api.getWebhookPresets().then(setPresets).catch(() => {});
  }, [open, webhook]);

  const applyPreset = (id: string) => {
    setPreset(id);
    const p = presets.find((p) => p.id === id);
    if (p) {
      setBodyTemplate(p.bodyTemplate);
      if (p.defaultHeaders && Object.keys(p.defaultHeaders).length > 0) {
        setHeaders([...Object.entries(p.defaultHeaders).map(([key, value]) => ({ key, value })), { key: "", value: "" }]);
      }
    }
  };

  const updateHeader = (idx: number, field: "key" | "value", val: string) => {
    setHeaders((prev) => prev.map((h, i) => (i === idx ? { ...h, [field]: val } : h)));
  };
  const removeHeader = (idx: number) => {
    setHeaders((prev) => prev.filter((_, i) => i !== idx));
  };
  const addHeader = () => {
    setHeaders((prev) => [...prev, { key: "", value: "" }]);
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (!url.trim()) { toast.error("URL is required"); return; }
    if (!/^https?:\/\/.+/.test(url.trim())) { toast.error("URL must start with http:// or https://"); return; }
    setSaving(true);
    try {
      const headersObj: Record<string, string> = {};
      for (const h of headers) { if (h.key.trim()) headersObj[h.key.trim()] = h.value; }
      const data: any = {
        name: name.trim(), url: url.trim(), method,
        templatePreset: preset || null,
        bodyTemplate: bodyTemplate || undefined,
        signingHeader, headers: headersObj,
      };
      if (signingSecret) data.signingSecret = signingSecret;
      if (isEdit) { await api.updateWebhook(webhook!.id, data); toast.success("Webhook updated"); }
      else { data.enabled = true; await api.createWebhook(data); toast.success("Webhook created"); }
      onOpenChange(false); onSaved();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setSaving(false); }
  };

  const PRESET_LABELS: Record<string, string> = { discord: "Discord", slack: "Slack", telegram: "Telegram", json: "JSON", plain: "Plain Text" };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Webhook" : "New Webhook"}</DialogTitle>
          <DialogDescription>
            {step === 1 ? "Configure endpoint and authentication." : "Configure body template and variables."}
          </DialogDescription>
        </DialogHeader>
        <AnimatedHeight>
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="wh-step-1" {...STEP_ANIMATION} className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Discord Alerts" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Method</label>
                    <Select value={method} onValueChange={setMethod}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="POST">POST</SelectItem><SelectItem value="PUT">PUT</SelectItem>
                        <SelectItem value="PATCH">PATCH</SelectItem><SelectItem value="GET">GET</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">URL</label>
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={presets.find((p) => p.id === preset)?.urlHint ?? "https://..."} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">HMAC Header</label>
                    <Input value={signingHeader} onChange={(e) => setSigningHeader(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Signing Secret</label>
                    <Input type="password" value={signingSecret} onChange={(e) => setSigningSecret(e.target.value)} placeholder={isEdit ? "********" : "Optional"} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Custom Headers</label>
                  <div className="border border-input rounded-md overflow-hidden">
                    <div className="grid grid-cols-[1fr_1fr_36px] bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground">
                      <div className="px-3 py-1.5">Header</div>
                      <div className="px-3 py-1.5 border-l border-border">Value</div>
                      <div />
                    </div>
                    {headers.map((h, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_1fr_36px] border-b border-border last:border-b-0">
                        <Input
                          value={h.key} onChange={(e) => updateHeader(idx, "key", e.target.value)}
                          className="h-9 text-xs font-mono border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0"
                          placeholder="Content-Type"
                        />
                        <div className="flex items-center border-l border-border">
                          <Input
                            value={h.value} onChange={(e) => updateHeader(idx, "value", e.target.value)}
                            className="h-9 text-xs font-mono border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 flex-1 min-w-0"
                            placeholder="application/json"
                          />
                        </div>
                        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-none border-l border-border" onClick={() => removeHeader(idx)}>
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" className="mt-1.5" onClick={addHeader}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Header
                  </Button>
                </div>
              </motion.div>
            )}
            {step === 2 && (
              <motion.div key="wh-step-2" {...STEP_ANIMATION} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Preset</label>
                  <Tabs value={preset} onValueChange={applyPreset}>
                    <TabsList>
                      {presets.map((p) => (
                        <TabsTrigger key={p.id} value={p.id}>{PRESET_LABELS[p.id] ?? p.name}</TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Body Template</label>
                  <TemplateEditor ref={bodyEditorRef} value={bodyTemplate} onChange={setBodyTemplate} minHeight={300} />
                  <TemplateCheatsheetLink variables={UNIVERSAL_VARIABLES} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </AnimatedHeight>
        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => { if (!name.trim()) { toast.error("Name is required"); return; } if (!url.trim()) { toast.error("URL is required"); return; } if (!/^https?:\/\/.+/.test(url.trim())) { toast.error("URL must start with http:// or https://"); return; } setStep(2); }}>
                Next <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : isEdit ? "Update" : "Create"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Delivery Log Tab ────────────────────────────────────────────────

function DeliveryLogTab() {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [detail, setDetail] = useState<WebhookDelivery | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try { setDeliveries((await api.listDeliveries({ limit: 100, status: statusFilter !== "all" ? statusFilter : undefined })).data); }
    catch { toast.error("Failed to load deliveries"); }
    finally { setIsLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const sIcon = (s: string) => {
    if (s === "success") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    if (s === "failed") return <XCircle className="h-4 w-4 text-red-500" />;
    return <Clock className="h-4 w-4 text-amber-500" />;
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="retrying">Retrying</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load}>Refresh</Button>
      </div>
      {deliveries.length === 0 ? (
        <EmptyState icon={Send} title="No deliveries" description="Delivery attempts will appear here when alerts fire." />
      ) : (
        <div className="border border-border bg-card">
          <div className="overflow-x-auto -mb-px">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="p-3 text-xs font-medium text-muted-foreground w-10" />
                  <th className="p-3 text-xs font-medium text-muted-foreground">Webhook</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Event</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Severity</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">HTTP</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Time</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Attempt</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {deliveries.map((d) => (
                  <tr key={d.id} className="hover:bg-accent transition-colors cursor-pointer" onClick={() => setDetail(d)}>
                    <td className="p-3">{sIcon(d.status)}</td>
                    <td className="p-3"><span className="text-sm font-medium">{d.webhookName ?? d.webhookId.slice(0, 8)}</span></td>
                    <td className="p-3"><span className="text-sm font-mono text-muted-foreground">{d.eventType}</span></td>
                    <td className="p-3"><Badge variant={SEV_BADGE[d.severity] ?? "secondary"}>{d.severity}</Badge></td>
                    <td className="p-3">{d.responseStatus ? <span className={d.responseStatus < 300 ? "text-emerald-500 text-sm" : "text-red-500 text-sm"}>{d.responseStatus}</span> : <span className="text-sm text-muted-foreground">—</span>}</td>
                    <td className="p-3"><span className="text-sm text-muted-foreground">{d.responseTimeMs != null ? `${d.responseTimeMs}ms` : "—"}</span></td>
                    <td className="p-3"><span className="text-sm text-muted-foreground">{d.attempt}/{d.maxAttempts}</span></td>
                    <td className="p-3"><span className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleString()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {detail && (
        <Dialog open={!!detail} onOpenChange={() => setDetail(null)}>
          <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Delivery Details</DialogTitle></DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Status:</span> <Badge variant={STATUS_BADGE[detail.status]}>{detail.status}</Badge></div>
                <div><span className="text-muted-foreground">Event:</span> {detail.eventType}</div>
                <div><span className="text-muted-foreground">HTTP:</span> {detail.responseStatus ?? "N/A"}</div>
                <div><span className="text-muted-foreground">Time:</span> {detail.responseTimeMs != null ? `${detail.responseTimeMs}ms` : "N/A"}</div>
                <div><span className="text-muted-foreground">Attempt:</span> {detail.attempt}/{detail.maxAttempts}</div>
                <div><span className="text-muted-foreground">Created:</span> {new Date(detail.createdAt).toLocaleString()}</div>
              </div>
              {detail.error && <div><p className="text-sm font-medium mb-1">Error</p><pre className="bg-muted p-3 rounded text-xs whitespace-pre-wrap">{detail.error}</pre></div>}
              {detail.requestBody && <div><p className="text-sm font-medium mb-1">Request Body</p><pre className="bg-muted p-3 rounded text-xs whitespace-pre-wrap max-h-[200px] overflow-auto font-mono">{detail.requestBody}</pre></div>}
              {detail.responseBody && <div><p className="text-sm font-medium mb-1">Response Body</p><pre className="bg-muted p-3 rounded text-xs whitespace-pre-wrap max-h-[200px] overflow-auto font-mono">{detail.responseBody}</pre></div>}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ── Animated Height Container ───────────────────────────────────────

function AnimatedHeight({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  // Set initial height synchronously once measured
  useLayoutEffect(() => {
    if (containerRef.current) setHeight(containerRef.current.getBoundingClientRect().height);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      animate={{ height: height === "auto" ? "auto" : height + 16 }}
      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
      className="overflow-hidden -mx-2 px-2 -my-2 py-2"
    >
      <div ref={containerRef}>{children}</div>
    </motion.div>
  );
}

// ── CodeMirror Template Editor ──────────────────────────────────────

// Handlebars highlighter — variables purple, helpers blue, variable args inside helpers purple
const hbsVarMark = Decoration.mark({ class: "cm-hbs-var" });
const hbsHelperMark = Decoration.mark({ class: "cm-hbs-helper" });
const hbsArgVarMark = Decoration.mark({ class: "cm-hbs-var" }); // higher-priority purple for args
const hbsRegex = /\{\{[#/]?[a-zA-Z_][\w.]*(?:\s[^}]*)?\}\}/g;
const hbsArgVarRegex = /[a-zA-Z_][\w.]*/g;

function buildHbsDecos(view: EditorView) {
  const ranges: import("@codemirror/state").Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    let m: RegExpExecArray | null;
    hbsRegex.lastIndex = 0;
    while ((m = hbsRegex.exec(text))) {
      const start = from + m.index;
      const end = start + m[0].length;
      const inner = m[0].slice(2, -2).trim();
      const isHelper = inner.startsWith('#') || inner.startsWith('/') || inner.includes(' ');
      // Whole block
      ranges.push((isHelper ? hbsHelperMark : hbsVarMark).range(start, end));
      // For helpers, recolor variable-like arguments inside
      if (isHelper) {
        const nameMatch = inner.match(/^[#/]?[a-zA-Z_][\w.]*/);
        const argsStart = nameMatch ? nameMatch[0].length : 0;
        const argsStr = inner.slice(argsStart);
        hbsArgVarRegex.lastIndex = 0;
        let a: RegExpExecArray | null;
        while ((a = hbsArgVarRegex.exec(argsStr))) {
          const argAbsStart = start + 2 + argsStart + a.index;
          ranges.push(hbsArgVarMark.range(argAbsStart, argAbsStart + a[0].length));
        }
      }
    }
  }
  return Decoration.set(ranges.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide));
}

const hbsHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildHbsDecos(view); }
    update(update: any) { if (update.docChanged || update.viewportChanged) this.decorations = buildHbsDecos(update.view); }
  },
  { decorations: (v) => v.decorations }
);

const cmTheme = EditorView.theme({
  "&": { fontSize: "13px", backgroundColor: "transparent" },
  ".cm-content": { fontFamily: "Menlo, Monaco, 'Courier New', monospace", padding: "8px 0" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "hsl(var(--muted-foreground))" },
  ".cm-activeLine": { backgroundColor: "hsl(var(--accent) / 0.5)" },
  ".cm-selectionBackground": { backgroundColor: "hsl(var(--accent))" },
  "&.cm-focused .cm-selectionBackground": { backgroundColor: "hsl(var(--accent))" },
  "&.cm-focused": { outline: "2px solid hsl(var(--ring))", outlineOffset: "-1px" },
  ".cm-line": { padding: "0 12px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "hsl(var(--foreground))" },
  ".cm-hbs-var": { color: "#c084fc !important", fontWeight: "600" },
  ".cm-hbs-helper": { color: "#60a5fa !important", fontWeight: "600" },
});

export interface TemplateEditorHandle {
  insert: (text: string) => void;
}

// ── Template Cheatsheet ───────────────────────────────────────────

const HELPERS_CHEATSHEET = [
  { name: "round", usage: "{{round value 1}}", description: "Round to N decimals" },
  { name: "math", usage: '{{math value "+" 10}}', description: "Arithmetic (+, -, *, /, %)" },
  { name: "percent", usage: "{{percent used total}}", description: "Calculate percentage" },
  { name: "formatDuration", usage: "{{formatDuration seconds}}", description: 'Human format: "5m 30s"' },
  { name: "timeago", usage: "{{timeago timestamp}}", description: '"3 minutes ago"' },
  { name: "dateformat", usage: '{{dateformat timestamp "YYYY-MM-DD HH:mm"}}', description: "Custom date format" },
  { name: "pluralize", usage: '{{pluralize count "item" "items"}}', description: "Singular/plural" },
  { name: "uppercase", usage: "{{uppercase str}}", description: "UPPERCASE" },
  { name: "lowercase", usage: "{{lowercase str}}", description: "lowercase" },
  { name: "truncate", usage: "{{truncate str 50}}", description: "Truncate with ellipsis" },
  { name: "default", usage: '{{default value "N/A"}}', description: "Fallback for null" },
  { name: "json", usage: "{{json obj}}", description: "JSON.stringify" },
  { name: "join", usage: '{{join array ", "}}', description: "Join array elements" },
  { name: "eq / ne / gt / lt", usage: "{{#if (gt value 90)}}...{{/if}}", description: "Conditional logic" },
];

function TemplateCheatsheetLink({ variables }: { variables: Array<{ name: string; description: string }> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <HelpCircle className="h-3.5 w-3.5" /> Variables & helpers cheatsheet
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Template Cheatsheet</DialogTitle>
            <DialogDescription>Variables and Handlebars helpers available in templates.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Variables</h4>
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead><tr className="bg-muted/50 border-b border-border"><th className="text-left px-3 py-1.5 font-medium">Variable</th><th className="text-left px-3 py-1.5 font-medium">Description</th></tr></thead>
                  <tbody>
                    {variables.map((v) => (
                      <tr key={v.name} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-1.5 font-mono text-purple-400">{v.name}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{v.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Helpers</h4>
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead><tr className="bg-muted/50 border-b border-border"><th className="text-left px-3 py-1.5 font-medium">Usage</th><th className="text-left px-3 py-1.5 font-medium">Description</th></tr></thead>
                  <tbody>
                    {HELPERS_CHEATSHEET.map((h) => (
                      <tr key={h.name} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-1.5 font-mono text-purple-400">{h.usage}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{h.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── CodeMirror Template Editor ──────────────────────────────────────

const TemplateEditor = React.forwardRef<TemplateEditorHandle, { value: string; onChange: (v: string) => void; minHeight?: number }>(function TemplateEditor({ value, onChange, minHeight = 260 }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const isInternalChange = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        EditorView.editable.of(true),
        drawSelection(),
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        syntaxHighlighting(defaultHighlightStyle),
        cmJson(),
        hbsHighlighter,
        cmTheme,
        cmPlaceholder('CPU at {{value}}% on {{resource.name}} (threshold: {{operator}} {{threshold}}%)'),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            isInternalChange.current = true;
            onChangeRef.current(update.state.doc.toString());
            isInternalChange.current = false;
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes (e.g., preset switch)
  useEffect(() => {
    if (isInternalChange.current) return;
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        selection: { anchor: value.length },
      });
    }
  }, [value]);

  useImperativeHandle(ref, () => ({
    insert: (text: string) => {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      // Sync React state
      onChangeRef.current(view.state.doc.toString());
    },
  }));

  return (
    <div
      ref={containerRef}
      className="border border-input rounded-md overflow-hidden bg-background"
      style={{ minHeight }}
    />
  );
});
