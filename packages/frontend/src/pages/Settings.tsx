import {
  Check,
  Copy,
  Globe,
  Key,
  Loader2,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Server,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ReactDOM from "react-dom";
import Markdown from "react-markdown";
import { toast } from "sonner";
import { AIToolAccessModal } from "@/components/ai/AIToolAccessModal";
import { confirm } from "@/components/common/ConfirmDialog";
import { PageTransition } from "@/components/common/PageTransition";
import { ScopeList } from "@/components/common/ScopeList";
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
import { formatBytes, formatDate, formatRelativeDate } from "@/lib/utils";
import { api } from "@/services/api";
import { useAIStore } from "@/stores/ai";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import { useUIStore } from "@/stores/ui";
import { useUpdateStore } from "@/stores/update";
import type {
  DockerRegistry,
  HousekeepingCategoryResult,
  HousekeepingConfig,
  HousekeepingRunResult,
  HousekeepingStats,
  Node,
  ProxyHost,
} from "@/types";
import { type ApiToken, TOKEN_SCOPES } from "@/types";

export function Settings() {
  const { user, hasScope } = useAuthStore();
  const { theme, setTheme, showUpdateNotifications, setShowUpdateNotifications } = useUIStore();
  const { cas } = useCAStore();
  const [nodesList, setNodesList] = useState<Node[]>([]);
  const [proxyHostsList, setProxyHostsList] = useState<ProxyHost[]>([]);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [resourceScopes, setResourceScopes] = useState<Record<string, string[]>>({});
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [tokenScopeSearch, setTokenScopeSearch] = useState("");
  const [editingToken, setEditingToken] = useState<ApiToken | null>(null);

  // Update state (global store)
  const {
    status: updateStatus,
    isChecking,
    isUpdating,
    checkForUpdates,
    triggerUpdate,
    fetchStatus,
  } = useUpdateStore();
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [releaseNotesList, setReleaseNotesList] = useState<string[] | null>(null);
  const [releaseVersions, setReleaseVersions] = useState<string[] | null>(null);
  const canUpdate = hasScope("admin:update");
  const canUseAI = hasScope("feat:ai:use");
  const canHousekeep = hasScope("admin:housekeeping");
  const canConfigAI = hasScope("feat:ai:configure");
  const canManageRegistries = hasScope("docker:registries:list");

  // Docker Registries state
  const [registries, setRegistries] = useState<DockerRegistry[]>([]);
  const [regDialogOpen, setRegDialogOpen] = useState(false);
  const [regEditId, setRegEditId] = useState<string | null>(null);
  const [regName, setRegName] = useState("");
  const [regUrl, setRegUrl] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regScope, setRegScope] = useState<"global" | "node">("global");
  const [regNodeId, setRegNodeId] = useState("");
  const [regSaving, setRegSaving] = useState(false);
  const [regTesting, setRegTesting] = useState<string | null>(null);

  // Housekeeping state
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

  // AI Assistant state
  const [aiConfig, setAiConfig] = useState<{
    enabled: boolean;
    providerUrl: string;
    model: string;
    maxCompletionTokens: number;
    maxTokensField: string;
    reasoningEffort: string;
    customSystemPrompt: string;
    rateLimitMax: number;
    rateLimitWindowSeconds: number;
    maxToolRounds: number;
    maxContextTokens: number;
    disabledTools: string[];
    hasApiKey: boolean;
    apiKeyLast4: string;
    hasWebSearchKey: boolean;
    webSearchProvider: string;
    webSearchBaseUrl: string;
  } | null>(null);
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiWebSearchKey, setAiWebSearchKey] = useState("");
  const [aiToolsModalOpen, setAiToolsModalOpen] = useState(false);
  const [aiSavedConfig, setAiSavedConfig] = useState<typeof aiConfig>(null);

  const aiHasChanges = (() => {
    if (!aiConfig || !aiSavedConfig) return false;
    if (aiApiKey || aiWebSearchKey) return true;
    return (
      aiConfig.providerUrl !== aiSavedConfig.providerUrl ||
      aiConfig.model !== aiSavedConfig.model ||
      aiConfig.maxCompletionTokens !== aiSavedConfig.maxCompletionTokens ||
      aiConfig.maxTokensField !== aiSavedConfig.maxTokensField ||
      aiConfig.rateLimitMax !== aiSavedConfig.rateLimitMax ||
      aiConfig.rateLimitWindowSeconds !== aiSavedConfig.rateLimitWindowSeconds ||
      aiConfig.maxToolRounds !== aiSavedConfig.maxToolRounds ||
      aiConfig.maxContextTokens !== aiSavedConfig.maxContextTokens ||
      aiConfig.customSystemPrompt !== aiSavedConfig.customSystemPrompt ||
      aiConfig.webSearchProvider !== aiSavedConfig.webSearchProvider ||
      aiConfig.webSearchBaseUrl !== aiSavedConfig.webSearchBaseUrl ||
      JSON.stringify(aiConfig.disabledTools) !== JSON.stringify(aiSavedConfig.disabledTools)
    );
  })();

  const loadAIConfig = useCallback(async () => {
    if (!canConfigAI) return;
    try {
      const config = (await api.getAIConfig()) as any;
      setAiConfig(config);
      setAiSavedConfig(config);
    } catch {
      /* AI not configured yet */
    }
  }, [canConfigAI]);

  const updateAIConfig = async (partial: Record<string, unknown>) => {
    try {
      const updated = (await api.updateAIConfig(partial)) as any;
      setAiConfig((prev) => (prev ? { ...prev, ...updated } : null));
      // Sync AI enabled state so the button appears/disappears without reload
      api
        .getAIStatus()
        .then((s) => useAIStore.getState().setEnabled(s.enabled))
        .catch(() => {});
      toast.success("AI settings updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update AI settings");
    }
  };

  const loadHousekeeping = useCallback(async () => {
    if (!canHousekeep) return;
    // Use cached data for instant render
    const cachedConfig = api.getCached<HousekeepingConfig>("housekeeping:config");
    if (cachedConfig) setHkConfig(cachedConfig);
    const cachedStats = api.getCached<HousekeepingStats>("housekeeping:stats");
    if (cachedStats) setHkStats(cachedStats);
    // Refresh in background
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
  }, [canHousekeep]);

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
      // Force-refresh stats bypassing cache
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

  const handleViewHistory = async () => {
    try {
      const history = await api.getHousekeepingHistory();
      setHkHistory(history);
      setHkHistoryOpen(true);
    } catch {
      toast.error("Failed to load history");
    }
  };

  const loadTokens = useCallback(async () => {
    try {
      const data = await api.listTokens();
      setTokens(data || []);
    } catch {
      // ignore
    }
  }, []);

  const loadRegistries = useCallback(async () => {
    if (!canManageRegistries) return;
    try {
      const data = await api.listDockerRegistries();
      setRegistries(data ?? []);
    } catch {
      /* ignore */
    }
  }, [canManageRegistries]);

  useEffect(() => {
    loadTokens();
    fetchStatus();
    loadHousekeeping();
    loadAIConfig();
    loadRegistries();
    api
      .listNodes({ limit: 100 })
      .then((r) => setNodesList(r.data ?? []))
      .catch(() => {});
    api
      .listProxyHosts({ limit: 100 })
      .then((r) => setProxyHostsList(r.data ?? []))
      .catch(() => {});
    // biome-ignore lint/correctness/useExhaustiveDependencies: load-once pattern
  }, [loadHousekeeping, loadAIConfig, fetchStatus, loadTokens, loadRegistries]);

  const openRegCreate = () => {
    setRegEditId(null);
    setRegName("");
    setRegUrl("");
    setRegUsername("");
    setRegPassword("");
    setRegScope("global");
    setRegNodeId("");
    setRegDialogOpen(true);
  };

  const openRegEdit = (r: DockerRegistry) => {
    setRegEditId(r.id);
    setRegName(r.name);
    setRegUrl(r.url);
    setRegUsername(r.username ?? "");
    setRegPassword("");
    setRegScope(r.scope);
    setRegNodeId(r.nodeId ?? "");
    setRegDialogOpen(true);
  };

  const closeRegDialog = () => {
    setRegDialogOpen(false);
    setTimeout(() => setRegEditId(null), 200);
  };

  const handleRegSave = async () => {
    if (!regName.trim() || !regUrl.trim()) return;
    setRegSaving(true);
    try {
      const payload = {
        name: regName.trim(),
        url: regUrl.trim(),
        username: regUsername.trim() || undefined,
        password: regPassword || undefined,
        scope: regScope,
        nodeId: regScope === "node" ? regNodeId || undefined : undefined,
      };
      if (regEditId) {
        await api.updateRegistry(regEditId, payload);
        toast.success("Registry updated");
      } else {
        // Test connection before creating
        const testResult = await api.testRegistryDirect({
          url: regUrl.trim(),
          username: regUsername.trim() || undefined,
          password: regPassword || undefined,
        });
        if (!testResult.ok) {
          toast.error(
            `Connection test failed: ${testResult.error || "could not connect to registry"}`
          );
          setRegSaving(false);
          return;
        }
        await api.createRegistry(payload);
        toast.success("Registry added");
      }
      closeRegDialog();
      loadRegistries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save registry");
    } finally {
      setRegSaving(false);
    }
  };

  const handleRegDelete = async (r: DockerRegistry) => {
    const ok = await confirm({
      title: "Delete Registry",
      description: `Delete registry "${r.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteRegistry(r.id);
      toast.success("Registry deleted");
      loadRegistries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete registry");
    }
  };

  const handleRegTest = async (r: DockerRegistry) => {
    setRegTesting(r.id);
    try {
      const result = await api.testRegistry(r.id);
      if (result.ok) {
        toast.success(`Connection to "${r.name}" successful`);
      } else {
        toast.error(`Connection failed: ${result.error ?? "unknown error"}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setRegTesting(null);
    }
  };

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

  const openTokenEdit = (token: ApiToken) => {
    setEditingToken(token);
    setNewTokenName(token.name);
    // Parse scopes: extract base scopes and resource scopes
    const base: string[] = [];
    const res: Record<string, string[]> = {};
    for (const s of token.scopes || []) {
      const restrictable = [
        "pki:cert:issue",
        "pki:cert:revoke",
        "pki:cert:export",
        "pki:ca:create:intermediate",
        "proxy:view",
        "proxy:edit",
        "proxy:delete",
        "proxy:advanced",
        "proxy:raw:read",
        "proxy:raw:write",
        "proxy:raw:toggle",
        "nodes:details",
        "nodes:config:view",
        "nodes:config:edit",
        "nodes:logs",
        "nodes:rename",
        "nodes:delete",
      ];
      let matched = false;
      for (const b of restrictable) {
        if (s.startsWith(b + ":")) {
          if (!base.includes(b)) base.push(b);
          if (!res[b]) res[b] = [];
          res[b].push(s.slice(b.length + 1));
          matched = true;
          break;
        }
      }
      if (!matched) base.push(s);
    }
    setSelectedScopes(base);
    setResourceScopes(res);
    setCreatedSecret(null);
    setTokenScopeSearch("");
    setCreateDialogOpen(true);
  };

  const handleTokenRename = async () => {
    if (!editingToken || !newTokenName.trim()) return;
    try {
      await api.renameToken(editingToken.id, newTokenName.trim());
      toast.success("Token renamed");
      setCreateDialogOpen(false);
      loadTokens();
      // Delay state reset until close animation finishes
      setTimeout(() => setEditingToken(null), 200);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename token");
    }
  };

  const openTokenCreate = () => {
    setEditingToken(null);
    setNewTokenName("");
    setSelectedScopes([]);
    setResourceScopes({});
    setCreatedSecret(null);
    setTokenScopeSearch("");
    setCreateDialogOpen(true);
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

    // Build final scopes: base scopes + resource-specific scopes
    const finalScopes: string[] = [];
    for (const scope of selectedScopes) {
      const resources = resourceScopes[scope];
      if (resources && resources.length > 0) {
        // Replace generic scope with resource-specific ones
        for (const resId of resources) {
          finalScopes.push(`${scope}:${resId}`);
        }
      } else {
        finalScopes.push(scope);
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

  const openCreateDialog = openTokenCreate;

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">Account and application settings</p>
        </div>

        {/* Profile */}
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Profile</h2>
          </div>
          {user && (
            <div className="flex items-center gap-4 p-4">
              <div className="h-10 w-10 bg-muted flex items-center justify-center shrink-0">
                <span className="text-sm font-medium text-muted-foreground">
                  {(user.name || user.email).charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{user.name || "Not set"}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
              <Badge variant="secondary" className="text-xs capitalize">
                {user.groupName}
              </Badge>
            </div>
          )}
        </div>

        {/* Preferences */}
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Preferences</h2>
          </div>
          <div className="divide-y divide-border">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Theme</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Choose how the interface looks
                </p>
              </div>
              <div className="flex gap-0 border border-border w-fit shrink-0">
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
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Update notifications</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Show update banners in sidebar and dashboard
                </p>
              </div>
              <Switch checked={showUpdateNotifications} onChange={setShowUpdateNotifications} />
            </div>
            {canUseAI && (
              <>
                <AIBypassRow
                  label="AI: bypass create approvals"
                  description="Allow AI to create resources without confirmation"
                  checked={useUIStore.getState().aiBypassCreateApprovals}
                  onChange={(v) => useUIStore.getState().setAIBypassCreateApprovals(v)}
                />
                <AIBypassRow
                  label="AI: bypass edit approvals"
                  description="Allow AI to modify resources without confirmation"
                  checked={useUIStore.getState().aiBypassEditApprovals}
                  onChange={(v) => useUIStore.getState().setAIBypassEditApprovals(v)}
                  dangerous
                />
                <AIBypassRow
                  label="AI: bypass delete approvals"
                  description="Allow AI to delete resources without confirmation"
                  checked={useUIStore.getState().aiBypassDeleteApprovals}
                  onChange={(v) => useUIStore.getState().setAIBypassDeleteApprovals(v)}
                  dangerous
                />
              </>
            )}
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
          <div>
            {tokens.length > 0 ? (
              <div className="divide-y divide-border">
                {tokens.map((token) => (
                  <div
                    key={token.id}
                    className="flex items-center justify-between p-4 gap-4 cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => openTokenEdit(token)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{token.name}</p>
                          <Badge variant="secondary" className="text-[10px] py-0.5">
                            {(token.scopes || []).length}{" "}
                            {(token.scopes || []).length === 1 ? "SCOPE" : "SCOPES"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {token.tokenPrefix}... &middot; Created {formatDate(token.createdAt)}
                          {token.lastUsedAt
                            ? ` · Last used ${formatRelativeDate(token.lastUsedAt)}`
                            : " · Never used"}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRevokeToken(token);
                      }}
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

        {/* AI Assistant */}
        {canConfigAI && aiConfig && (
          <div className="border border-border bg-card">
            <div className="flex items-center justify-between p-4">
              <div>
                <h2 className="font-semibold">AI Assistant</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Configure the AI assistant for operators and admins
                </p>
              </div>
              <Switch
                checked={aiConfig.enabled}
                onChange={(v) => {
                  setAiConfig({ ...aiConfig, enabled: v });
                  updateAIConfig({ enabled: v });
                }}
              />
            </div>
            <div
              className={`transition-opacity duration-200 ${!aiConfig.enabled ? "opacity-50 pointer-events-none" : ""}`}
            >
              {/* Reasoning Effort */}
              <div className="border-t border-border px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Reasoning effort</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Controls thinking depth for reasoning models (o1, o3, o4-mini). Ignored by
                    non-reasoning models.
                  </p>
                </div>
                <div className="flex gap-0 border border-border w-fit shrink-0">
                  {(["none", "low", "medium", "high"] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => {
                        setAiConfig({ ...aiConfig, reasoningEffort: level });
                        setAiSavedConfig((prev) =>
                          prev ? { ...prev, reasoningEffort: level } : prev
                        );
                        updateAIConfig({ reasoningEffort: level });
                      }}
                      className={`px-3 py-1.5 text-xs capitalize transition-colors ${
                        aiConfig.reasoningEffort === level
                          ? "bg-primary text-primary-foreground"
                          : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                    >
                      {level === "none" ? "Default" : level}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2">
                {/* Provider */}
                <div className="border-t border-r border-border p-4 space-y-3 max-sm:border-r-0">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Provider
                  </p>
                  <div>
                    <label className="text-xs text-muted-foreground">Base URL</label>
                    <Input
                      className="h-8 text-sm mt-1"
                      placeholder="https://api.openai.com/v1"
                      value={aiConfig.providerUrl}
                      onChange={(e) => setAiConfig({ ...aiConfig, providerUrl: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Model</label>
                    <Input
                      className="h-8 text-sm mt-1"
                      placeholder="gpt-4o"
                      value={aiConfig.model}
                      onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">API Key</label>
                    <Input
                      className="h-8 text-sm mt-1"
                      type="password"
                      placeholder={aiConfig.hasApiKey ? `****${aiConfig.apiKeyLast4}` : "sk-..."}
                      value={aiApiKey}
                      onChange={(e) => setAiApiKey(e.target.value)}
                    />
                  </div>
                </div>

                {/* Limits */}
                <div className="border-t border-border p-4 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Limits
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Requests</label>
                      <Input
                        className="h-8 text-sm mt-1"
                        type="number"
                        value={aiConfig.rateLimitMax}
                        onChange={(e) =>
                          setAiConfig({ ...aiConfig, rateLimitMax: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Window (sec)</label>
                      <Input
                        className="h-8 text-sm mt-1"
                        type="number"
                        value={aiConfig.rateLimitWindowSeconds}
                        onChange={(e) =>
                          setAiConfig({
                            ...aiConfig,
                            rateLimitWindowSeconds: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Max tool rounds</label>
                      <Input
                        className="h-8 text-sm mt-1"
                        type="number"
                        value={aiConfig.maxToolRounds}
                        onChange={(e) =>
                          setAiConfig({ ...aiConfig, maxToolRounds: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Context tokens</label>
                      <Input
                        className="h-8 text-sm mt-1"
                        type="number"
                        value={aiConfig.maxContextTokens}
                        onChange={(e) =>
                          setAiConfig({ ...aiConfig, maxContextTokens: Number(e.target.value) })
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Max tokens</label>
                      <Input
                        className="h-8 text-sm mt-1"
                        type="number"
                        value={aiConfig.maxCompletionTokens}
                        onChange={(e) =>
                          setAiConfig({ ...aiConfig, maxCompletionTokens: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Token field</label>
                      <Select
                        value={aiConfig.maxTokensField || "max_completion_tokens"}
                        onValueChange={(v) => setAiConfig({ ...aiConfig, maxTokensField: v })}
                      >
                        <SelectTrigger className="h-8 text-sm mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="max_completion_tokens">
                            max_completion_tokens
                          </SelectItem>
                          <SelectItem value="max_tokens">max_tokens</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* System Prompt */}
                <div className="border-t border-r border-border p-4 flex flex-col gap-3 max-sm:border-r-0">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    System Prompt
                  </p>
                  <textarea
                    className="w-full flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none min-h-[120px]"
                    placeholder="Add custom instructions for the AI assistant.&#10;&#10;Examples:&#10;- Company PKI policies and naming conventions&#10;- Preferred certificate settings&#10;- Security guidelines"
                    value={aiConfig.customSystemPrompt}
                    onChange={(e) =>
                      setAiConfig({ ...aiConfig, customSystemPrompt: e.target.value })
                    }
                  />
                </div>

                {/* Tools & Web Search */}
                <div className="border-t border-border p-4 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Tools
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Tool Access</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {aiConfig.disabledTools.length > 0
                          ? `${aiConfig.disabledTools.length} tool${aiConfig.disabledTools.length !== 1 ? "s" : ""} disabled`
                          : "All tools enabled"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs shrink-0"
                      onClick={() => setAiToolsModalOpen(true)}
                    >
                      Manage
                    </Button>
                  </div>
                  <Separator />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">Web Search</p>
                      {aiConfig.disabledTools.includes("web_search") && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          Disabled
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                      Allow the AI to search the web for information
                    </p>
                    <div className="space-y-2">
                      <div>
                        <label className="text-xs text-muted-foreground">Provider</label>
                        <Select
                          value={aiConfig.webSearchProvider || "tavily"}
                          onValueChange={(v) => setAiConfig({ ...aiConfig, webSearchProvider: v })}
                        >
                          <SelectTrigger className="h-8 text-sm mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="tavily">Tavily — AI-optimized search</SelectItem>
                            <SelectItem value="brave">Brave Search — privacy-first</SelectItem>
                            <SelectItem value="serper">Serper — Google results</SelectItem>
                            <SelectItem value="exa">Exa — semantic search</SelectItem>
                            <SelectItem value="searxng">SearXNG — self-hosted</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {aiConfig.webSearchProvider === "searxng" ? (
                        <div>
                          <label className="text-xs text-muted-foreground">Instance URL</label>
                          <Input
                            className="h-8 text-sm mt-1"
                            placeholder="https://searxng.example.com"
                            value={aiConfig.webSearchBaseUrl}
                            onChange={(e) =>
                              setAiConfig({ ...aiConfig, webSearchBaseUrl: e.target.value })
                            }
                          />
                        </div>
                      ) : (
                        <div>
                          <label className="text-xs text-muted-foreground">API Key</label>
                          <Input
                            className="h-8 text-sm mt-1"
                            type="password"
                            placeholder={
                              aiConfig.hasWebSearchKey
                                ? "Configured — enter new to replace"
                                : "Enter API key"
                            }
                            value={aiWebSearchKey}
                            onChange={(e) => setAiWebSearchKey(e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {/* Save bar */}
              <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    loadAIConfig();
                    setAiApiKey("");
                    setAiWebSearchKey("");
                  }}
                >
                  Reset
                </Button>
                <Button
                  size="sm"
                  disabled={!aiHasChanges}
                  onClick={async () => {
                    const updates: Record<string, unknown> = {
                      providerUrl: aiConfig.providerUrl,
                      model: aiConfig.model,
                      maxCompletionTokens: aiConfig.maxCompletionTokens,
                      maxTokensField: aiConfig.maxTokensField,
                      reasoningEffort: aiConfig.reasoningEffort,
                      rateLimitMax: aiConfig.rateLimitMax,
                      rateLimitWindowSeconds: aiConfig.rateLimitWindowSeconds,
                      maxToolRounds: aiConfig.maxToolRounds,
                      maxContextTokens: aiConfig.maxContextTokens,
                      customSystemPrompt: aiConfig.customSystemPrompt,
                      webSearchProvider: aiConfig.webSearchProvider,
                      webSearchBaseUrl: aiConfig.webSearchBaseUrl,
                    };
                    if (aiApiKey) updates.apiKey = aiApiKey;
                    if (aiWebSearchKey) updates.webSearchApiKey = aiWebSearchKey;
                    await updateAIConfig(updates);
                    setAiApiKey("");
                    setAiWebSearchKey("");
                    loadAIConfig();
                  }}
                >
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        )}

        <AIToolAccessModal
          open={aiToolsModalOpen}
          onOpenChange={setAiToolsModalOpen}
          disabledTools={aiConfig?.disabledTools || []}
          onSave={(disabledTools) => updateAIConfig({ disabledTools })}
        />

        {/* Docker Registries */}
        {canManageRegistries && (
          <div className="border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border p-4">
              <div>
                <h2 className="font-semibold">Docker Registries</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Configure private container registries for pulling images
                </p>
              </div>
              <Button size="sm" onClick={openRegCreate}>
                <Plus className="h-4 w-4" />
                Add Registry
              </Button>
            </div>
            <div>
              {registries.length > 0 ? (
                <div className="divide-y divide-border">
                  {registries.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between p-4 gap-4 cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => openRegEdit(r)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {r.scope === "global" ? (
                          <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{r.name}</p>
                            <Badge
                              variant={r.scope === "global" ? "default" : "secondary"}
                              className="text-[10px] py-0.5"
                            >
                              {r.scope === "global"
                                ? "Global"
                                : nodesList.find((n) => n.id === r.nodeId)?.displayName ||
                                  nodesList.find((n) => n.id === r.nodeId)?.hostname ||
                                  "Node"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {r.url}
                            {r.username && ` (${r.username})`}
                          </p>
                        </div>
                      </div>
                      <div
                        className="flex items-center gap-2 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="outline"
                          size="default"
                          disabled={regTesting === r.id}
                          onClick={() => handleRegTest(r)}
                        >
                          {regTesting === r.id ? (
                            <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                          ) : (
                            <Play className="h-3.5 w-3.5 mr-1" />
                          )}
                          Test
                        </Button>
                        <Button variant="outline" size="icon" onClick={() => handleRegDelete(r)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No registries configured. Add a registry to pull images from private sources.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Registry Add/Edit Dialog */}
        <Dialog open={regDialogOpen} onOpenChange={closeRegDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{regEditId ? "Edit Registry" : "Add Registry"}</DialogTitle>
              <DialogDescription>
                {regEditId
                  ? "Update the registry configuration."
                  : "Add a private container registry for image pulls."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">
                  Name <span className="text-destructive">*</span>
                </label>
                <Input
                  className="mt-1"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="My Registry"
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  URL <span className="text-destructive">*</span>
                </label>
                <Input
                  className="mt-1"
                  value={regUrl}
                  onChange={(e) => setRegUrl(e.target.value)}
                  placeholder="ghcr.io"
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  Username <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <Input
                  className="mt-1"
                  value={regUsername}
                  onChange={(e) => setRegUsername(e.target.value)}
                  placeholder="username"
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  Password <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <Input
                  className="mt-1"
                  type="password"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder={regEditId ? "(unchanged)" : "password or token"}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Scope</label>
                <Select
                  value={regScope === "node" && regNodeId ? `node:${regNodeId}` : "global"}
                  onValueChange={(v) => {
                    if (v === "global") {
                      setRegScope("global");
                      setRegNodeId("");
                    } else if (v.startsWith("node:")) {
                      setRegScope("node");
                      setRegNodeId(v.slice(5));
                    }
                  }}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Global (all nodes)</SelectItem>
                    {nodesList
                      .filter((n) => n.type === "docker")
                      .map((n) => (
                        <SelectItem key={n.id} value={`node:${n.id}`}>
                          {n.displayName || n.hostname}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeRegDialog}>
                Cancel
              </Button>
              <Button
                onClick={handleRegSave}
                disabled={regSaving || !regName.trim() || !regUrl.trim()}
              >
                {regSaving ? "Saving..." : regEditId ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Housekeeping */}
        {canHousekeep && (
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
                disabled={hkRunning}
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
                      disabled={!hkConfig.enabled || hkRunning}
                    />
                    <Button
                      size="sm"
                      onClick={handleRunHousekeeping}
                      disabled={hkRunning || !hkConfig.enabled}
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
                  onToggle={(v) =>
                    updateHkConfig({ nginxLogs: { ...hkConfig.nginxLogs, enabled: v } })
                  }
                  retentionDays={hkConfig.nginxLogs.retentionDays}
                  onRetentionChange={(v) =>
                    updateHkConfig({ nginxLogs: { ...hkConfig.nginxLogs, retentionDays: v } })
                  }
                  lastResult={hkStats?.lastRun?.categories.find((c) => c.category === "Nginx Logs")}
                  disabled={hkRunning}
                />
                <HousekeepingCard
                  label="Audit Log"
                  description="Delete old audit trail entries"
                  stat={hkStats ? hkStats.auditLog.totalRows.toLocaleString() : "..."}
                  statDetail="rows"
                  enabled={hkConfig.auditLog.enabled}
                  onToggle={(v) =>
                    updateHkConfig({ auditLog: { ...hkConfig.auditLog, enabled: v } })
                  }
                  retentionDays={hkConfig.auditLog.retentionDays}
                  onRetentionChange={(v) =>
                    updateHkConfig({ auditLog: { ...hkConfig.auditLog, retentionDays: v } })
                  }
                  lastResult={hkStats?.lastRun?.categories.find((c) => c.category === "Audit Log")}
                  disabled={hkRunning}
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
                  disabled={hkRunning}
                />
                <HousekeepingCard
                  label="Orphaned Certs"
                  description="Remove unreferenced cert files"
                  stat={hkStats ? String(hkStats.orphanedCerts.count) : "..."}
                  statDetail="found"
                  enabled={hkConfig.orphanedCerts.enabled}
                  onToggle={(v) => updateHkConfig({ orphanedCerts: { enabled: v } })}
                  lastResult={hkStats?.lastRun?.categories.find(
                    (c) => c.category === "Orphaned Certs"
                  )}
                  disabled={hkRunning}
                />
                <HousekeepingCard
                  label="ACME Challenges"
                  description="Clean up validation tokens"
                  stat={hkStats ? String(hkStats.acmeChallenges.fileCount) : "..."}
                  statDetail={
                    hkStats
                      ? `files (${formatBytes(hkStats.acmeChallenges.totalSizeBytes)})`
                      : "files"
                  }
                  enabled={hkConfig.acmeCleanup.enabled}
                  onToggle={(v) => updateHkConfig({ acmeCleanup: { enabled: v } })}
                  lastResult={hkStats?.lastRun?.categories.find(
                    (c) => c.category === "ACME Challenges"
                  )}
                  disabled={hkRunning}
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
                  lastResult={hkStats?.lastRun?.categories.find(
                    (c) => c.category === "Docker Images"
                  )}
                  disabled={hkRunning}
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
        )}

        {/* Update available */}
        {updateStatus?.updateAvailable && updateStatus.latestVersion && (
          <div className="border bg-card" style={{ borderColor: "rgb(234 179 8 / 0.6)" }}>
            <div className="flex items-center justify-between border-b border-border p-4">
              <div>
                <h2 className="font-semibold" style={{ color: "rgb(234 179 8)" }}>
                  Update Available
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {updateStatus.latestVersion} is ready to install
                </p>
              </div>
              <div className="flex items-center gap-2">
                {updateStatus.releaseNotes && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      setReleaseNotesOpen(true);
                      try {
                        const all = await api.getAllReleaseNotes();
                        if (all.length > 0) {
                          setReleaseVersions(all.map((r) => r.version));
                          setReleaseNotesList(all.map((r) => r.notes));
                        }
                      } catch {
                        // Fallback: just show the cached latest release notes
                      }
                    }}
                  >
                    Release notes
                  </Button>
                )}
                {canUpdate && (
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
              <p className="text-xs text-muted-foreground mt-0.5">Application info and updates</p>
            </div>
            {canUpdate && (
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
              <InfoRow label="Version" value={updateStatus?.currentVersion ?? "..."} />
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                {updateStatus?.updateAvailable ? (
                  <Badge variant="warning" className="text-xs">
                    Update available
                  </Badge>
                ) : (
                  <Badge variant="success" className="text-xs">
                    Up to date
                  </Badge>
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
        {isUpdating &&
          ReactDOM.createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">
              <div className="flex flex-col items-center gap-4 text-center">
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <div>
                  <h2 className="text-lg font-semibold">Updating Gateway</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Updating to {updateStatus?.latestVersion}. The application will restart
                    automatically.
                  </p>
                  <p className="text-xs text-muted-foreground mt-3">This may take a minute...</p>
                </div>
              </div>
            </div>,
            document.body
          )}

        <p className="text-center text-xs text-muted-foreground">
          Powered by{" "}
          <a
            href="https://wiolett.net"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:underline"
          >
            Wiolett
          </a>
        </p>

        {/* Release Notes Dialog */}
        <Dialog open={releaseNotesOpen} onOpenChange={setReleaseNotesOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Release Notes</DialogTitle>
            </DialogHeader>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              {(releaseNotesList ?? [updateStatus?.releaseNotes])
                .filter(Boolean)
                .map((notes, i) => (
                  <div key={i}>
                    {releaseNotesList && releaseNotesList.length > 1 && (
                      <h3 className="text-base font-semibold mt-0">{releaseVersions?.[i]}</h3>
                    )}
                    <Markdown>{notes ?? ""}</Markdown>
                  </div>
                ))}
            </div>
          </DialogContent>
        </Dialog>

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

        {/* Create/View Token Dialog */}
        <Dialog
          open={createDialogOpen}
          onOpenChange={(open) => {
            setCreateDialogOpen(open);
            if (!open) setTimeout(() => setEditingToken(null), 200);
          }}
        >
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingToken ? "API Token" : "Create API Token"}</DialogTitle>
              <DialogDescription>
                {editingToken
                  ? "View token scopes or rename"
                  : "Select granular permissions for this token"}
              </DialogDescription>
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

                  <div className="border border-border">
                    <Input
                      value={tokenScopeSearch}
                      onChange={(e) => setTokenScopeSearch(e.target.value)}
                      placeholder="Search scopes..."
                      className="border-0 border-b border-border rounded-none h-9 text-sm focus-visible:ring-0"
                    />
                    <ScopeList
                      scopes={
                        editingToken
                          ? TOKEN_SCOPES.filter((s) => selectedScopes.includes(s.value))
                          : TOKEN_SCOPES.filter((s) => {
                              const userScopes = user?.scopes ?? [];
                              return userScopes.some(
                                (us) => us === s.value || us.startsWith(s.value)
                              );
                            })
                      }
                      search={tokenScopeSearch}
                      selected={selectedScopes}
                      onToggle={toggleScope}
                      readOnly={!!editingToken}
                      resources={resourceScopes}
                      onToggleResource={(scope, caId) => {
                        setResourceScopes((prev) => {
                          const current = prev[scope] || [];
                          const has = current.includes(caId);
                          return {
                            ...prev,
                            [scope]: has ? current.filter((id) => id !== caId) : [...current, caId],
                          };
                        });
                      }}
                      cas={cas}
                      nodes={nodesList}
                      proxyHosts={proxyHostsList}
                      restrictableScopes={[
                        "pki:cert:issue",
                        "pki:cert:revoke",
                        "pki:cert:export",
                        "pki:ca:create:intermediate",
                        "proxy:view",
                        "proxy:edit",
                        "proxy:delete",
                        "proxy:advanced",
                        "proxy:raw:read",
                        "proxy:raw:write",
                        "proxy:raw:toggle",
                        "nodes:details",
                        "nodes:config:view",
                        "nodes:config:edit",
                        "nodes:logs",
                        "nodes:rename",
                        "nodes:delete",
                      ]}
                    />
                    <div className="border-t border-border px-3 py-2">
                      <p className="text-xs text-muted-foreground">
                        {selectedScopes.length} scope{selectedScopes.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                    {editingToken ? "Close" : "Cancel"}
                  </Button>
                  {editingToken ? (
                    <Button
                      onClick={handleTokenRename}
                      disabled={!newTokenName.trim() || newTokenName.trim() === editingToken.name}
                    >
                      Save
                    </Button>
                  ) : (
                    <Button
                      onClick={handleCreateToken}
                      disabled={isCreating || selectedScopes.length === 0}
                    >
                      {isCreating ? "Creating..." : "Create Token"}
                    </Button>
                  )}
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

function AIBypassRow({
  label,
  description,
  checked,
  onChange,
  dangerous,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  dangerous?: boolean;
}) {
  const handleChange = async (v: boolean) => {
    if (v && dangerous) {
      const ok = await confirm({
        title: `Enable ${label.toLowerCase().replace("ai: ", "")}?`,
        description:
          "This may be dangerous. The AI assistant will perform these actions without asking for your confirmation.",
        confirmLabel: "Enable",
        variant: "destructive",
      });
      if (!ok) return;
    }
    onChange(v);
  };

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Switch checked={checked} onChange={handleChange} />
    </div>
  );
}

