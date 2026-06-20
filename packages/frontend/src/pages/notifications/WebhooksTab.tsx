import { MoreVertical, Pencil, Send, Trash2 } from "lucide-react";
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
import type { NotificationWebhook } from "@/types";
import { WebhookDialog } from "./WebhookDialog";

// ── Webhooks Tab ────────────────────────────────────────────────────

export function WebhooksTab({
  canRead,
  canManage,
  openCreateToken,
}: {
  canRead: boolean;
  canManage: boolean;
  openCreateToken: number;
}) {
  const [webhooks, setWebhooks] = useState<NotificationWebhook[]>(() =>
    canRead ? (api.getCached<NotificationWebhook[]>("notifications:webhooks") ?? []) : []
  );
  const [isLoading, setIsLoading] = useState(
    () => canRead && api.getCached<NotificationWebhook[]>("notifications:webhooks") === undefined
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWh, setEditingWh] = useState<NotificationWebhook | null>(null);
  const lastHandledCreateToken = useRef(0);

  const load = useCallback(
    async (options?: { showLoading?: boolean }) => {
      if (!canRead) {
        setWebhooks([]);
        setIsLoading(false);
        return;
      }
      if (options?.showLoading !== false) setIsLoading(true);
      try {
        const data = (await api.listWebhooks({ limit: 100 })).data;
        api.setCache("notifications:webhooks", data);
        setWebhooks(data);
      } catch {
        toast.error("Failed to load webhooks");
      } finally {
        setIsLoading(false);
      }
    },
    [canRead]
  );

  useEffect(() => {
    load();
  }, [load]);

  useRealtime("notification.webhook.changed", () => {
    load({ showLoading: false });
  });

  const toggle = async (wh: NotificationWebhook) => {
    const nextEnabled = !wh.enabled;
    setWebhooks((prev) =>
      prev.map((candidate) =>
        candidate.id === wh.id ? { ...candidate, enabled: nextEnabled } : candidate
      )
    );
    try {
      const updated = await api.updateWebhook(wh.id, { enabled: nextEnabled });
      setWebhooks((prev) => {
        const next = prev.map((candidate) => (candidate.id === updated.id ? updated : candidate));
        api.setCache("notifications:webhooks", next);
        return next;
      });
    } catch {
      setWebhooks((prev) =>
        prev.map((candidate) =>
          candidate.id === wh.id ? { ...candidate, enabled: wh.enabled } : candidate
        )
      );
      toast.error("Failed");
    }
  };

  const del = async (wh: NotificationWebhook) => {
    if (
      !(await confirm({
        title: "Delete Webhook",
        description: `Delete "${wh.name}"?`,
        confirmLabel: "Delete",
      }))
    )
      return;
    try {
      await api.deleteWebhook(wh.id);
      toast.success("Deleted");
      load();
    } catch {
      toast.error("Failed");
    }
  };

  const test = async (wh: NotificationWebhook) => {
    try {
      const r = await api.testWebhook(wh.id);
      r.success
        ? toast.success(`Test succeeded (HTTP ${r.statusCode})`)
        : toast.error(`Test failed: ${r.error ?? `HTTP ${r.statusCode}`}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    }
  };

  const openEdit = (wh: NotificationWebhook) => {
    setEditingWh(wh);
    setDialogOpen(true);
  };
  const openCreate = useCallback(() => {
    setEditingWh(null);
    setDialogOpen(true);
  }, []);

  useEffect(() => {
    if (openCreateToken > lastHandledCreateToken.current && canManage) {
      lastHandledCreateToken.current = openCreateToken;
      openCreate();
    }
  }, [canManage, openCreate, openCreateToken]);

  if (isLoading) return <LoadingSpinner />;

  const visibleWebhooks = canRead ? webhooks : [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Webhooks define where and how notifications are delivered.
      </p>
      {visibleWebhooks.length === 0 ? (
        <EmptyState message="No webhooks configured. Create a webhook to configure notification delivery." />
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
                {visibleWebhooks.map((wh) => (
                  <tr
                    key={wh.id}
                    className={
                      canManage ? "hover:bg-accent transition-colors cursor-pointer" : undefined
                    }
                    onClick={canManage ? () => openEdit(wh) : undefined}
                  >
                    <td className="p-3">
                      <span className="text-sm font-medium">{wh.name}</span>
                    </td>
                    <td className="p-3">
                      <span className="text-sm text-muted-foreground font-mono truncate block max-w-[300px]">
                        {wh.url}
                      </span>
                    </td>
                    <td className="p-3">
                      <Badge variant="secondary">{wh.method}</Badge>
                    </td>
                    <td className="p-3">
                      {wh.templatePreset ? (
                        <Badge variant="secondary">{wh.templatePreset}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">custom</span>
                      )}
                    </td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={wh.enabled}
                        onChange={() => {
                          if (canManage) toggle(wh);
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
                            <DropdownMenuItem onClick={() => test(wh)}>
                              <Send className="h-4 w-4" /> Test
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEdit(wh)}>
                              <Pencil className="h-4 w-4" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => del(wh)} className="text-destructive">
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
      <WebhookDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        webhook={editingWh}
        onSaved={load}
      />
    </div>
  );
}
