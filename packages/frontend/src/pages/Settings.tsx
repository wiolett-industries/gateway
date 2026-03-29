import { Check, Copy, Key, Loader2, Moon, Play, Plus, RefreshCw, Sun, Trash2, X } from "lucide-react";
import Markdown from "react-markdown";
import { useCallback, useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { PageTransition } from "@/components/common/PageTransition";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { formatDate, formatRelativeDate } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import { useUIStore } from "@/stores/ui";
import { useUpdateStore } from "@/stores/update";
import type { HousekeepingCategoryResult, HousekeepingConfig, HousekeepingRunResult, HousekeepingStats } from "@/types";
import { type ApiToken, TOKEN_SCOPES } from "@/types";

const SCOPE_GROUPS = [...new Set(TOKEN_SCOPES.map((s) => s.group))];

export function Settings() {
  const { user, hasRole } = useAuthStore();
  const { theme, setTheme } = useUIStore();
  const { cas } = useCAStore();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [caSpecificScopes, setCaSpecificScopes] = useState<Record<string, string>>({});
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Update state (global store)
  const { status: updateStatus, isChecking, isUpdating, checkForUpdates, triggerUpdate, fetchStatus } = useUpdateStore();
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const isAdmin = hasRole("admin");

  // Housekeeping state
  const [hkConfig, setHkConfig] = useState<HousekeepingConfig | null>(null);
  const [hkStats, setHkStats] = useState<HousekeepingStats | null>(null);
  const [hkRunning, setHkRunning] = useState(false);
  const [hkHistoryOpen, setHkHistoryOpen] = useState(false);
  const [hkHistory, setHkHistory] = useState<HousekeepingRunResult[]>([]);

  const loadHousekeeping = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [config, stats] = await Promise.all([
        api.getHousekeepingConfig(),
        api.getHousekeepingStats(),
      ]);
      setHkConfig(config);
      setHkStats(stats);
    } catch {
      // ignore
    }
  }, [isAdmin]);

  const updateHkConfig = async (partial: Partial<HousekeepingConfig>) => {
    try {
      const updated = await api.updateHousekeepingConfig(partial);
      setHkConfig(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update config");
    }
  };

  const handleRunHousekeeping = async () => {
    setHkRunning(true);
    try {
      const result = await api.runHousekeeping();
      if (result.overallSuccess) {
        toast.success(`Housekeeping completed in ${(result.totalDurationMs / 1000).toFixed(1)}s`);
      } else {
        toast.warning("Housekeeping completed with some errors");
      }
      await loadHousekeeping();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Housekeeping failed");
    } finally {
      setHkRunning(false);
    }
  };

  const handleViewHistory = async () => {
    try {
      const history = await api.getHousekeepingHistory();
      setHkHistory(history);
      setHkHistoryOpen(true);
    } catch {
      toast.error("Failed to load history");
    }
  };

  const loadTokens = async () => {
    try {
      const data = await api.listTokens();
      setTokens(data || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadTokens();
    fetchStatus();
    loadHousekeeping();
  }, [loadHousekeeping]);

  const handleCheckUpdate = async () => {
    await checkForUpdates();
    const s = useUpdateStore.getState().status;
    if (s?.updateAvailable) {
      toast.info(`Update available: ${s.latestVersion}`);
    } else {
      toast.success("Already up to date");
    }
  };

  const handleUpdate = async () => {
    if (!updateStatus?.latestVersion) return;
    const ok = await confirm({
      title: "Update Gateway",
      description: `Update from ${updateStatus.currentVersion} to ${updateStatus.latestVersion}? The application will restart automatically.`,
      confirmLabel: "Update",
    });
    if (!ok) return;
    triggerUpdate(updateStatus.latestVersion);
  };

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const handleCreateToken = async () => {
    if (!newTokenName.trim()) {
      toast.error("Token name is required");
      return;
    }

    // Build final scopes: base scopes + CA-specific scopes
    const finalScopes = [...selectedScopes];
    for (const [baseScope, caId] of Object.entries(caSpecificScopes)) {
      if (caId && selectedScopes.includes(baseScope)) {
        // Replace generic scope with CA-specific one
        const idx = finalScopes.indexOf(baseScope);
        if (idx !== -1) finalScopes[idx] = `${baseScope}:${caId}`;
      }
    }

    if (finalScopes.length === 0) {
      toast.error("Select at least one scope");
      return;
    }

    setIsCreating(true);
    try {
      const result = await api.createToken({ name: newTokenName, scopes: finalScopes });
      setCreatedSecret(result.token);
      loadTokens();
      toast.success("API token created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create token");
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeToken = async (token: ApiToken) => {
    const ok = await confirm({
      title: "Revoke Token",
      description: `Are you sure you want to revoke "${token.name}"? This action cannot be undone.`,
      confirmLabel: "Revoke",
    });
    if (!ok) return;
    try {
      await api.revokeToken(token.id);
      toast.success("Token revoked");
      loadTokens();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke token");
    }
  };

  const openCreateDialog = () => {
    setNewTokenName("");
    setSelectedScopes([]);
    setCaSpecificScopes({});
    setCreatedSecret(null);
    setCreateDialogOpen(true);
  };

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">Account and application settings</p>
        </div>

        {/* Profile */}
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Profile</h2>
          </div>
          <div className="p-4 space-y-3">
            {user && (
              <>
                <InfoRow label="Name" value={user.name || "Not set"} />
                <InfoRow label="Email" value={user.email} />
                <InfoRow label="Role" value={user.role} capitalize />
              </>
            )}
          </div>
        </div>

        {/* Theme */}
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Appearance</h2>
          </div>
          <div className="p-4">
            <div className="flex gap-0 border border-border w-fit">
              {(["light", "dark", "system"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm capitalize transition-colors ${
                    theme === t
                      ? "bg-primary text-primary-foreground"
                      : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  {t === "light" && <Sun className="h-3.5 w-3.5" />}
                  {t === "dark" && <Moon className="h-3.5 w-3.5" />}
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* API Tokens */}
        <div className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border p-4">
            <div>
              <h2 className="font-semibold">API Tokens</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Granular tokens for programmatic access
              </p>
            </div>
            <Button size="sm" onClick={openCreateDialog}>
              <Plus className="h-4 w-4" />
              Create Token
            </Button>
          </div>
          <div className="p-4">
            {tokens.length > 0 ? (
              <div className="divide-y divide-border">
                {tokens.map((token) => (
                  <div key={token.id} className="flex items-center justify-between py-3 gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{token.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {token.tokenPrefix}... &middot; {formatDate(token.createdAt)}
                          {token.lastUsedAt && ` · Used ${formatDate(token.lastUsedAt)}`}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(token.scopes || []).map((scope) => (
                            <Badge
                              key={scope}
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0 font-mono"
                            >
                              {scope}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive shrink-0"
                      onClick={() => handleRevokeToken(token)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No API tokens created yet
              </p>
            )}
          </div>
        </div>

        {/* Housekeeping */}
        {isAdmin && hkConfig && (
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
              />
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium">Schedule</span>
                <div className="flex items-center gap-2">
                  <Input
                    className="w-48 h-8 text-sm font-mono"
                    value={hkConfig.cronExpression}
                    onChange={(e) => setHkConfig({ ...hkConfig, cronExpression: e.target.value })}
                    onBlur={() => updateHkConfig({ cronExpression: hkConfig.cronExpression })}
                    disabled={!hkConfig.enabled}
                  />
                  <Button size="sm" onClick={handleRunHousekeeping} disabled={hkRunning || !hkConfig.enabled}>
                    {hkRunning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    Run Now
                  </Button>
                </div>
              </div>
              {hkStats?.lastRun && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">Last run</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {formatRelativeDate(hkStats.lastRun.startedAt)}
                    </span>
                    <span className="text-xs text-muted-foreground">&middot;</span>
                    <span className="text-sm text-muted-foreground capitalize">{hkStats.lastRun.trigger}</span>
                    <span className="text-xs text-muted-foreground">&middot;</span>
                    <span className="text-sm text-muted-foreground">{(hkStats.lastRun.totalDurationMs / 1000).toFixed(1)}s</span>
                    {hkStats.lastRun.overallSuccess ? (
                      <Badge variant="success" className="text-[10px] px-1.5 py-0">OK</Badge>
                    ) : (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Errors</Badge>
                    )}
                  </div>
                </div>
              )}
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
                onRetentionChange={(v) => updateHkConfig({ nginxLogs: { ...hkConfig.nginxLogs, retentionDays: v } })}
                lastResult={hkStats?.lastRun?.categories.find((c) => c.category === "Nginx Logs")}
              />
              <HousekeepingCard
                label="Audit Log"
                description="Delete old audit trail entries"
                stat={hkStats ? hkStats.auditLog.totalRows.toLocaleString() : "..."}
                statDetail="rows"
                enabled={hkConfig.auditLog.enabled}
                onToggle={(v) => updateHkConfig({ auditLog: { ...hkConfig.auditLog, enabled: v } })}
                retentionDays={hkConfig.auditLog.retentionDays}
                onRetentionChange={(v) => updateHkConfig({ auditLog: { ...hkConfig.auditLog, retentionDays: v } })}
                lastResult={hkStats?.lastRun?.categories.find((c) => c.category === "Audit Log")}
              />
              <HousekeepingCard
                label="Dismissed Alerts"
                description="Remove dismissed alerts"
                stat={hkStats ? String(hkStats.dismissedAlerts.count) : "..."}
                statDetail="entries"
                enabled={hkConfig.dismissedAlerts.enabled}
                onToggle={(v) => updateHkConfig({ dismissedAlerts: { ...hkConfig.dismissedAlerts, enabled: v } })}
                retentionDays={hkConfig.dismissedAlerts.retentionDays}
                onRetentionChange={(v) => updateHkConfig({ dismissedAlerts: { ...hkConfig.dismissedAlerts, retentionDays: v } })}
                lastResult={hkStats?.lastRun?.categories.find((c) => c.category === "Dismissed Alerts")}
              />
              <HousekeepingCard
                label="Orphaned Certs"
                description="Remove unreferenced cert files"
                stat={hkStats ? String(hkStats.orphanedCerts.count) : "..."}
                statDetail="found"
                enabled={hkConfig.orphanedCerts.enabled}
                onToggle={(v) => updateHkConfig({ orphanedCerts: { enabled: v } })}
                lastResult={hkStats?.lastRun?.categories.find((c) => c.category === "Orphaned Certs")}
              />
              <HousekeepingCard
                label="ACME Challenges"
                description="Clean up validation tokens"
                stat={hkStats ? String(hkStats.acmeChallenges.fileCount) : "..."}
                statDetail={hkStats ? `files (${formatBytes(hkStats.acmeChallenges.totalSizeBytes)})` : "files"}
                enabled={hkConfig.acmeCleanup.enabled}
                onToggle={(v) => updateHkConfig({ acmeCleanup: { enabled: v } })}
                lastResult={hkStats?.lastRun?.categories.find((c) => c.category === "ACME Challenges")}
              />
              <HousekeepingCard
                label="Docker Images"
                description="Prune old Gateway images"
                stat={hkStats ? String(hkStats.dockerImages.oldImageCount) : "..."}
                statDetail={hkStats ? `old (${formatBytes(hkStats.dockerImages.reclaimableBytes)})` : "old"}
                enabled={hkConfig.dockerPrune.enabled}
                onToggle={(v) => updateHkConfig({ dockerPrune: { enabled: v } })}
                lastResult={hkStats?.lastRun?.categories.find((c) => c.category === "Docker Images")}
              />
            </div>
            {hkStats?.lastRun && (
              <div className="border-t border-border px-4 py-2">
                <Button variant="link" size="sm" className="px-0 h-auto text-xs" onClick={handleViewHistory}>
                  View run history
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Update available */}
        {updateStatus?.updateAvailable && updateStatus.latestVersion && (
          <div className="border bg-card" style={{ borderColor: "rgb(234 179 8 / 0.6)" }}>
            <div className="flex items-center justify-between border-b border-border p-4">
              <div>
                <h2 className="font-semibold" style={{ color: "rgb(234 179 8)" }}>Update Available</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {updateStatus.latestVersion} is ready to install
                </p>
              </div>
              <div className="flex items-center gap-2">
                {updateStatus.releaseNotes && (
                  <Button size="sm" variant="outline" onClick={() => setReleaseNotesOpen(true)}>
                    Release notes
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    size="sm"
                    onClick={handleUpdate}
                    style={{ backgroundColor: "rgb(234 179 8)", color: "#111" }}
                    className="hover:opacity-90"
                  >
                    Update to {updateStatus.latestVersion}
                  </Button>
                )}
              </div>
            </div>
            <div className="p-4 space-y-3">
              <InfoRow label="Current version" value={updateStatus.currentVersion} />
              <InfoRow label="New version" value={updateStatus.latestVersion} />
            </div>
          </div>
        )}

        {/* About */}
        <div className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border p-4">
            <div>
              <h2 className="font-semibold">About</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Application info and updates
              </p>
            </div>
            {isAdmin && (
              <Button size="sm" onClick={handleCheckUpdate} disabled={isChecking}>
                {isChecking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Check for updates
              </Button>
            )}
          </div>
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-4">
              <img src="/android-chrome-192x192.png" alt="Gateway" className="h-10 w-10" />
              <div>
                <p className="text-sm font-semibold">Gateway</p>
                <p className="text-xs text-muted-foreground">
                  Self-hosted certificate manager and reverse proxy gateway
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <InfoRow
                label="Version"
                value={updateStatus?.currentVersion ?? "..."}
              />
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                {updateStatus?.updateAvailable ? (
                  <Badge variant="warning" className="text-xs">Update available</Badge>
                ) : (
                  <Badge variant="success" className="text-xs">Up to date</Badge>
                )}
              </div>
              {updateStatus?.lastCheckedAt && (
                <InfoRow
                  label="Last checked"
                  value={new Date(updateStatus.lastCheckedAt).toLocaleString()}
                />
              )}
            </div>
          </div>
        </div>

        {/* Updating overlay — rendered via portal to cover entire viewport */}
        {isUpdating && ReactDOM.createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-4 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
              <div>
                <h2 className="text-lg font-semibold">Updating Gateway</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Updating to {updateStatus?.latestVersion}. The application will restart automatically.
                </p>
                <p className="text-xs text-muted-foreground mt-3">
                  This may take a minute...
                </p>
              </div>
            </div>
          </div>,
          document.body
        )}

        <p className="text-center text-xs text-muted-foreground">
          Powered by{" "}
          <a href="https://wiolett.net" target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">
            Wiolett
          </a>
        </p>

        {/* Release Notes Dialog */}
        <Dialog open={releaseNotesOpen} onOpenChange={setReleaseNotesOpen}>
          <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Release Notes — {updateStatus?.latestVersion}</DialogTitle>
            </DialogHeader>
            <div className="overflow-y-auto prose prose-sm dark:prose-invert max-w-none">
              <Markdown>{updateStatus?.releaseNotes ?? ""}</Markdown>
            </div>
          </DialogContent>
        </Dialog>

        {/* Housekeeping History Dialog */}
        <Dialog open={hkHistoryOpen} onOpenChange={setHkHistoryOpen}>
          <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Housekeeping History</DialogTitle>
              <DialogDescription>Last {hkHistory.length} runs</DialogDescription>
            </DialogHeader>
            <div className="overflow-y-auto space-y-3">
              {hkHistory.map((run, i) => (
                <div key={i} className="border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{new Date(run.startedAt).toLocaleString()}</span>
                    <div className="flex items-center gap-2">
                      <span className="capitalize text-muted-foreground">{run.trigger}</span>
                      <span className="text-muted-foreground">{(run.totalDurationMs / 1000).toFixed(1)}s</span>
                      {run.overallSuccess ? (
                        <Badge variant="success" className="text-[10px] px-1.5 py-0">OK</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Errors</Badge>
                      )}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {run.categories.map((cat) => (
                      <div key={cat.category} className="flex items-center gap-2 text-xs text-muted-foreground">
                        {cat.success ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <X className="h-3 w-3 text-destructive" />
                        )}
                        <span>{cat.category}: {cat.itemsCleaned} cleaned</span>
                        {cat.spaceFreedBytes ? <span>({formatBytes(cat.spaceFreedBytes)})</span> : null}
                        {cat.error && <span className="text-destructive">— {cat.error}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {hkHistory.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">
                  No housekeeping runs yet
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Create Token Dialog */}
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create API Token</DialogTitle>
              <DialogDescription>Select granular permissions for this token</DialogDescription>
            </DialogHeader>

            {createdSecret ? (
              <div className="space-y-4">
                <div className="border border-yellow-600/30 bg-yellow-600/5 p-3">
                  <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                    Copy this token now. It will not be shown again.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-muted p-3 text-sm font-mono break-all">
                    {createdSecret}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard.writeText(createdSecret);
                      toast.success("Token copied to clipboard");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <DialogFooter>
                  <Button onClick={() => setCreateDialogOpen(false)}>Done</Button>
                </DialogFooter>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Name</label>
                    <Input
                      value={newTokenName}
                      onChange={(e) => setNewTokenName(e.target.value)}
                      placeholder="e.g., CI/CD Pipeline"
                      autoFocus
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Scopes</label>
                    <div className="border border-border max-h-64 overflow-y-auto">
                      {SCOPE_GROUPS.map((group, gi) => (
                        <div key={group}>
                          {gi > 0 && <Separator />}
                          <div className="px-3 py-1.5 bg-muted/50">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              {group}
                            </p>
                          </div>
                          {TOKEN_SCOPES.filter((s) => s.group === group).map((scope) => {
                            const isSelected = selectedScopes.includes(scope.value);
                            const canLimitToCA =
                              scope.value === "cert:issue" ||
                              scope.value === "ca:create:intermediate";
                            return (
                              <div key={scope.value}>
                                <label className="flex items-center gap-3 px-3 py-2 hover:bg-accent transition-colors cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleScope(scope.value)}
                                    className="form-checkbox"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm">{scope.label}</p>
                                    <p className="text-xs text-muted-foreground font-mono">
                                      {scope.value}
                                    </p>
                                  </div>
                                </label>
                                {/* CA-specific restriction for cert:issue and ca:create:intermediate */}
                                {canLimitToCA && isSelected && (cas || []).length > 0 && (
                                  <div className="px-3 pb-2 pl-10">
                                    <Select
                                      value={caSpecificScopes[scope.value] || "all"}
                                      onValueChange={(v) =>
                                        setCaSpecificScopes((prev) => ({
                                          ...prev,
                                          [scope.value]: v === "all" ? "" : v,
                                        }))
                                      }
                                    >
                                      <SelectTrigger className="h-8 text-xs">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="all">
                                          All CAs (no restriction)
                                        </SelectItem>
                                        {(cas || []).map((ca) => (
                                          <SelectItem key={ca.id} value={ca.id}>
                                            {ca.commonName}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedScopes.length} scope{selectedScopes.length !== 1 ? "s" : ""} selected
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateToken}
                    disabled={isCreating || selectedScopes.length === 0}
                  >
                    {isCreating ? "Creating..." : "Create Token"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </PageTransition>
  );
}

function InfoRow({
  label,
  value,
  capitalize = false,
  custom,
}: {
  label: string;
  value?: string;
  capitalize?: boolean;
  custom?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      {custom || (
        <span className={`text-sm font-medium ${capitalize ? "capitalize" : ""}`}>{value}</span>
      )}
    </div>
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
          {lastResult && (
            lastResult.success ? (
              <Check className="h-3 w-3 text-emerald-500 shrink-0" />
            ) : (
              <X className="h-3 w-3 text-destructive shrink-0" />
            )
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
          <span>{stat}{statDetail ? ` ${statDetail}` : ""}</span>
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
                disabled={!enabled}
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
      <Switch checked={enabled} onChange={onToggle} />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}
