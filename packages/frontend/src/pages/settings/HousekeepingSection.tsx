import { Check, Loader2, Play, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatBytes, formatRelativeDate } from "@/lib/utils";
import { api } from "@/services/api";
import type {
  HousekeepingCategoryResult,
  HousekeepingConfig,
  HousekeepingRunResult,
  HousekeepingStats,
} from "@/types";

interface HousekeepingSectionProps {
  canRun: boolean;
  canConfigure: boolean;
}

export function HousekeepingSection({ canRun, canConfigure }: HousekeepingSectionProps) {
  const [hkConfig, setHkConfig] = useState<HousekeepingConfig>({
    enabled: true,
    cronExpression: "0 2 * * *",
    nginxLogs: { enabled: true, retentionDays: 30 },
    auditLog: { enabled: true, retentionDays: 90 },
    dismissedAlerts: { enabled: true, retentionDays: 30 },
    dockerPrune: { enabled: true },
    orphanedCerts: { enabled: false },
    acmeCleanup: { enabled: true },
  });
  const [hkStats, setHkStats] = useState<HousekeepingStats | null>(null);
  const [hkRunning, setHkRunning] = useState(false);
  const [hkHistoryOpen, setHkHistoryOpen] = useState(false);
  const [hkHistory, setHkHistory] = useState<HousekeepingRunResult[]>([]);

  const loadHousekeeping = useCallback(async () => {
    const cachedConfig = api.getCached<HousekeepingConfig>("housekeeping:config");
    if (cachedConfig) setHkConfig(cachedConfig);
    const cachedStats = api.getCached<HousekeepingStats>("housekeeping:stats");
    if (cachedStats) setHkStats(cachedStats);
    api
      .getHousekeepingConfig()
      .then((c) => {
        api.setCache("housekeeping:config", c);
        setHkConfig(c);
      })
      .catch(() => {});
    api
      .getHousekeepingStats()
      .then((s) => {
        api.setCache("housekeeping:stats", s);
        setHkStats(s);
        setHkRunning(s.isRunning);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadHousekeeping();
  }, [loadHousekeeping]);

  const updateHkConfig = async (partial: Partial<HousekeepingConfig>) => {
    if (!canConfigure) return;
    try {
      const updated = await api.updateHousekeepingConfig(partial);
      setHkConfig(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update config");
    }
  };

  const handleRunHousekeeping = async () => {
    if (!canRun) return;
    setHkRunning(true);
    try {
      const result = await api.runHousekeeping();
      if (result.overallSuccess) {
        toast.success(`Housekeeping completed in ${(result.totalDurationMs / 1000).toFixed(1)}s`);
      } else {
        toast.warning("Housekeeping completed with some errors");
      }
      api.invalidateCache("req:/api/housekeeping/stats");
      const freshStats = await api.getHousekeepingStats();
      api.setCache("housekeeping:stats", freshStats);
      setHkStats(freshStats);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Housekeeping failed");
    } finally {
      setHkRunning(false);
    }
  };

  const controlsDisabled = hkRunning || !canConfigure;

  const handleViewHistory = async () => {
    try {
      const history = await api.getHousekeepingHistory();
      setHkHistory(history);
      setHkHistoryOpen(true);
    } catch {
      toast.error("Failed to load history");
    }
  };

  return (
    <>
      <div className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="font-semibold">Housekeeping</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automated cleanup of logs, old data, and unused resources
            </p>
          </div>
          <Switch
            checked={hkConfig.enabled}
            onChange={(v) => updateHkConfig({ enabled: v })}
            disabled={controlsDisabled}
          />
        </div>
        <div
          className={`transition-opacity duration-200 ${!hkConfig.enabled ? "opacity-50 pointer-events-none" : ""}`}
        >
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium">Schedule</span>
              <div className="flex items-center gap-2">
                <Input
                  className="w-48 h-8 text-sm font-mono"
                  value={hkConfig.cronExpression}
                  onChange={(e) => setHkConfig({ ...hkConfig, cronExpression: e.target.value })}
                  onBlur={() => updateHkConfig({ cronExpression: hkConfig.cronExpression })}
                  disabled={!hkConfig.enabled || controlsDisabled}
                />
                <Button
                  size="sm"
                  onClick={handleRunHousekeeping}
                  disabled={hkRunning || !hkConfig.enabled || !canRun}
                >
                  {hkRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Run Now
                </Button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            <HousekeepingCard
              label="Nginx Logs"
              description="Rotate, compress, and delete old logs"
              stat={hkStats ? formatBytes(hkStats.nginxLogs.totalSizeBytes) : "..."}
              statDetail={hkStats ? `${hkStats.nginxLogs.fileCount} files` : undefined}
              enabled={hkConfig.nginxLogs.enabled}
              onToggle={(v) => updateHkConfig({ nginxLogs: { ...hkConfig.nginxLogs, enabled: v } })}
              retentionDays={hkConfig.nginxLogs.retentionDays}
              onRetentionChange={(v) =>
                updateHkConfig({ nginxLogs: { ...hkConfig.nginxLogs, retentionDays: v } })
              }
              lastResult={hkStats?.lastRun?.categories.find((c) => c.category === "Nginx Logs")}
              disabled={controlsDisabled}
            />
            <HousekeepingCard
              label="Audit Log"
              description="Delete old audit trail entries"
              stat={hkStats ? hkStats.auditLog.totalRows.toLocaleString() : "..."}
              statDetail="rows"
              enabled={hkConfig.auditLog.enabled}
              onToggle={(v) => updateHkConfig({ auditLog: { ...hkConfig.auditLog, enabled: v } })}
              retentionDays={hkConfig.auditLog.retentionDays}
              onRetentionChange={(v) =>
                updateHkConfig({ auditLog: { ...hkConfig.auditLog, retentionDays: v } })
              }
              lastResult={hkStats?.lastRun?.categories.find((c) => c.category === "Audit Log")}
              disabled={controlsDisabled}
            />
            <HousekeepingCard
              label="Dismissed Alerts"
              description="Remove dismissed alerts"
              stat={hkStats ? String(hkStats.dismissedAlerts.count) : "..."}
              statDetail="entries"
              enabled={hkConfig.dismissedAlerts.enabled}
              onToggle={(v) =>
                updateHkConfig({ dismissedAlerts: { ...hkConfig.dismissedAlerts, enabled: v } })
              }
              retentionDays={hkConfig.dismissedAlerts.retentionDays}
              onRetentionChange={(v) =>
                updateHkConfig({
                  dismissedAlerts: { ...hkConfig.dismissedAlerts, retentionDays: v },
                })
              }
              lastResult={hkStats?.lastRun?.categories.find(
                (c) => c.category === "Dismissed Alerts"
              )}
              disabled={controlsDisabled}
            />
            <HousekeepingCard
              label="Orphaned Certs"
              description="Remove unreferenced cert files"
              stat={hkStats ? String(hkStats.orphanedCerts.count) : "..."}
              statDetail="found"
              enabled={hkConfig.orphanedCerts.enabled}
              onToggle={(v) => updateHkConfig({ orphanedCerts: { enabled: v } })}
              lastResult={hkStats?.lastRun?.categories.find((c) => c.category === "Orphaned Certs")}
              disabled={controlsDisabled}
            />
            <HousekeepingCard
              label="ACME Challenges"
              description="Clean up validation tokens"
              stat={hkStats ? String(hkStats.acmeChallenges.fileCount) : "..."}
              statDetail={
                hkStats ? `files (${formatBytes(hkStats.acmeChallenges.totalSizeBytes)})` : "files"
              }
              enabled={hkConfig.acmeCleanup.enabled}
              onToggle={(v) => updateHkConfig({ acmeCleanup: { enabled: v } })}
              lastResult={hkStats?.lastRun?.categories.find(
                (c) => c.category === "ACME Challenges"
              )}
              disabled={controlsDisabled}
            />
            <HousekeepingCard
              label="Docker Images"
              description="Prune old Gateway images"
              stat={hkStats ? String(hkStats.dockerImages.oldImageCount) : "..."}
              statDetail={
                hkStats ? `old (${formatBytes(hkStats.dockerImages.reclaimableBytes)})` : "old"
              }
              enabled={hkConfig.dockerPrune.enabled}
              onToggle={(v) => updateHkConfig({ dockerPrune: { enabled: v } })}
              lastResult={hkStats?.lastRun?.categories.find((c) => c.category === "Docker Images")}
              disabled={controlsDisabled}
            />
          </div>
          <div className="border-t border-border px-4 py-3 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {hkStats?.lastRun ? (
                <span>
                  Last run {formatRelativeDate(hkStats.lastRun.startedAt)}
                  {" — "}
                  {hkStats.lastRun.overallSuccess
                    ? "completed successfully"
                    : "completed with errors"}
                  {` in ${(hkStats.lastRun.totalDurationMs / 1000).toFixed(1)}s`}
                </span>
              ) : (
                <span>No runs yet</span>
              )}
            </div>
            <button
              onClick={handleViewHistory}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View history
            </button>
          </div>
        </div>
      </div>

      {/* Housekeeping History Dialog */}
      <Dialog open={hkHistoryOpen} onOpenChange={setHkHistoryOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Run History</DialogTitle>
          </DialogHeader>
          {hkHistory.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="p-3 text-xs font-medium text-muted-foreground">Time</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Trigger</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Duration</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Cleaned</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {hkHistory.map((run, i) => (
                    <tr key={i}>
                      <td className="p-3 text-sm text-muted-foreground">
                        {formatRelativeDate(run.startedAt)}
                      </td>
                      <td className="p-3 text-sm">
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 capitalize">
                          {run.trigger}
                        </span>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {(run.totalDurationMs / 1000).toFixed(1)}s
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {run.categories.reduce((s, c) => s + c.itemsCleaned, 0)} items
                      </td>
                      <td className="p-3">
                        {run.overallSuccess ? (
                          <Badge variant="success" className="text-[10px] px-1.5 py-0">
                            OK
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                            Errors
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground py-8">No runs yet</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function HousekeepingCard({
  label,
  description,
  stat,
  statDetail,
  enabled,
  onToggle,
  retentionDays,
  onRetentionChange,
  lastResult,
  disabled,
}: {
  label: string;
  description: string;
  stat: string;
  statDetail?: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  retentionDays?: number;
  onRetentionChange?: (v: number) => void;
  lastResult?: HousekeepingCategoryResult;
  disabled?: boolean;
}) {
  const [localDays, setLocalDays] = useState(retentionDays ?? 30);

  useEffect(() => {
    if (retentionDays !== undefined) setLocalDays(retentionDays);
  }, [retentionDays]);

  return (
    <div className="border-t border-r border-border p-4 last:border-r-0 [&:nth-child(2n)]:border-r-0 sm:[&:nth-child(2n)]:border-r lg:[&:nth-child(2n)]:border-r lg:[&:nth-child(3n)]:border-r-0 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{label}</p>
          {lastResult &&
            (lastResult.success ? (
              <Check className="h-3 w-3 text-emerald-500 shrink-0" />
            ) : (
              <X className="h-3 w-3 text-destructive shrink-0" />
            ))}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
          <span>
            {stat}
            {statDetail ? ` ${statDetail}` : ""}
          </span>
          {retentionDays !== undefined && onRetentionChange && (
            <>
              <span>&middot;</span>
              <span>keep</span>
              <input
                type="number"
                className="w-10 bg-transparent border-b border-border text-center text-xs text-foreground tabular-nums outline-none focus:border-primary disabled:opacity-50"
                min={1}
                max={365}
                value={localDays}
                disabled={!enabled || disabled}
                onChange={(e) => setLocalDays(parseInt(e.target.value, 10) || 1)}
                onBlur={() => {
                  const v = Math.max(1, Math.min(365, localDays));
                  setLocalDays(v);
                  if (v !== retentionDays) onRetentionChange(v);
                }}
              />
              <span>days</span>
            </>
          )}
        </div>
      </div>
      <Switch checked={enabled} onChange={onToggle} disabled={disabled} />
    </div>
  );
}
