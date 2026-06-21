import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useRealtime } from "@/hooks/use-realtime";
import { api } from "@/services/api";
import type { AlertRule } from "@/types";
import { AlertDialog } from "./AlertDialog";

const SEV_BADGE: Record<string, "warning" | "destructive" | "secondary"> = {
  info: "secondary",
  warning: "warning",
  critical: "destructive",
};

const ROOT_DISK_TARGET = "/";
const CERTIFICATE_EXPIRY_METRIC = "days_until_expiry";

function isCertificateExpiryRule(rule: AlertRule) {
  return (
    rule.type === "threshold" &&
    rule.category === "certificate" &&
    rule.metric === CERTIFICATE_EXPIRY_METRIC
  );
}

function formatAlertCondition(rule: AlertRule) {
  if (isCertificateExpiryRule(rule)) {
    return `Days until expiry ${rule.operator} ${rule.thresholdValue}`;
  }

  if (rule.type === "threshold") {
    return `${rule.metric}${rule.metricTarget ? ` (${rule.metricTarget === ROOT_DISK_TARGET ? "Root Disk" : rule.metricTarget})` : ""} ${rule.operator} ${rule.thresholdValue} • fire ${rule.fireThresholdPercent}% in ${Math.round(rule.durationSeconds / 60)}m • resolve ${rule.resolveThresholdPercent}% in ${Math.round(rule.resolveAfterSeconds / 60)}m`;
  }

  return rule.durationSeconds > 0 || rule.resolveAfterSeconds > 0
    ? `${rule.eventPattern ?? "—"} • fire ${rule.fireThresholdPercent}% in ${Math.round(rule.durationSeconds / 60)}m • resolve ${rule.resolveThresholdPercent}% in ${Math.round(rule.resolveAfterSeconds / 60)}m`
    : (rule.eventPattern ?? "—");
}

// ── Alerts Tab ──────────────────────────────────────────────────────

export function AlertsTab({
  canRead,
  canManage,
  openCreateToken,
}: {
  canRead: boolean;
  canManage: boolean;
  openCreateToken: number;
}) {
  const [rules, setRules] = useState<AlertRule[]>(() =>
    canRead ? (api.getCached<AlertRule[]>("notifications:alerts") ?? []) : []
  );
  const [isLoading, setIsLoading] = useState(
    () => canRead && api.getCached<AlertRule[]>("notifications:alerts") === undefined
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const lastHandledCreateToken = useRef(0);

  const load = useCallback(
    async (options?: { showLoading?: boolean }) => {
      if (!canRead) {
        setRules([]);
        setIsLoading(false);
        return;
      }
      if (options?.showLoading !== false) setIsLoading(true);
      try {
        const data = (await api.listAlertRules({ limit: 100 })).data;
        api.setCache("notifications:alerts", data);
        setRules(data);
      } catch {
        toast.error("Failed to load alerts");
      } finally {
        setIsLoading(false);
      }
    },
    [canRead]
  );

  useEffect(() => {
    load();
  }, [load]);

  useRealtime("notification.alert-rule.changed", () => {
    load({ showLoading: false });
  });

  const toggle = async (rule: AlertRule) => {
    const nextEnabled = !rule.enabled;
    setRules((prev) =>
      prev.map((candidate) =>
        candidate.id === rule.id ? { ...candidate, enabled: nextEnabled } : candidate
      )
    );
    try {
      const updated = await api.updateAlertRule(rule.id, { enabled: nextEnabled });
      setRules((prev) => {
        const next = prev.map((candidate) => (candidate.id === updated.id ? updated : candidate));
        api.setCache("notifications:alerts", next);
        return next;
      });
    } catch {
      setRules((prev) =>
        prev.map((candidate) =>
          candidate.id === rule.id ? { ...candidate, enabled: rule.enabled } : candidate
        )
      );
      toast.error("Failed to toggle");
    }
  };

  const del = async (rule: AlertRule) => {
    if (
      !(await confirm({
        title: "Delete Alert",
        description: `Delete "${rule.name}"?`,
        confirmLabel: "Delete",
      }))
    )
      return;
    try {
      await api.deleteAlertRule(rule.id);
      toast.success("Deleted");
      load();
    } catch {
      toast.error("Failed");
    }
  };

  const openEdit = (rule: AlertRule) => {
    setEditingRule(rule);
    setDialogOpen(true);
  };
  const openCreate = useCallback(() => {
    setEditingRule(null);
    setDialogOpen(true);
  }, []);

  useEffect(() => {
    if (openCreateToken > lastHandledCreateToken.current && canManage) {
      lastHandledCreateToken.current = openCreateToken;
      openCreate();
    }
  }, [canManage, openCreate, openCreateToken]);

  if (isLoading) return <LoadingSpinner />;

  const visibleRules = canRead ? rules : [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Alerts define conditions that trigger notifications to webhooks.
      </p>
      {visibleRules.length === 0 ? (
        <EmptyState message="No alerts configured. Create an alert to start receiving notifications." />
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
                {visibleRules.map((r) => (
                  <tr
                    key={r.id}
                    className={
                      canManage ? "hover:bg-accent transition-colors cursor-pointer" : undefined
                    }
                    onClick={canManage ? () => openEdit(r) : undefined}
                  >
                    <td className="p-3">
                      <span className="text-sm font-medium">{r.name}</span>
                    </td>
                    <td className="p-3">
                      <Badge variant="secondary">{r.category}</Badge>
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">{formatAlertCondition(r)}</td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {r.resourceIds.length === 0 ? "All" : `${r.resourceIds.length} selected`}
                    </td>
                    <td className="p-3">
                      <Badge variant={SEV_BADGE[r.severity]}>{r.severity}</Badge>
                    </td>
                    <td className="p-3">
                      <Badge variant="secondary">{r.webhookIds.length}</Badge>
                    </td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={r.enabled}
                        onChange={() => {
                          if (canManage) toggle(r);
                        }}
                        disabled={!canManage}
                      />
                    </td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(r)}>
                              <Pencil className="h-4 w-4" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => del(r)} className="text-destructive">
                              <Trash2 className="h-4 w-4" /> Delete
                            </DropdownMenuItem>
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
      <AlertDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rule={editingRule}
        onSaved={load}
      />
    </div>
  );
}

// ── Alert Dialog (3-step wizard) ────────────────────────────────────
