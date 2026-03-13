import { Copy, Key, Moon, Plus, Sun, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Separator } from "@/components/ui/separator";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import { useUIStore } from "@/stores/ui";
import { TOKEN_SCOPES, type ApiToken } from "@/types";
import { formatDate } from "@/lib/utils";

const SCOPE_GROUPS = [...new Set(TOKEN_SCOPES.map((s) => s.group))];

export function Settings() {
  const { user } = useAuthStore();
  const { theme, setTheme } = useUIStore();
  const { cas } = useCAStore();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [caSpecificScopes, setCaSpecificScopes] = useState<Record<string, string>>({});
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

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
  }, []);

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
    if (!confirm(`Revoke token "${token.name}"?`)) return;
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
            <p className="text-xs text-muted-foreground mt-0.5">Granular tokens for programmatic access</p>
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
                          <Badge key={scope} variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
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

      {/* Create Token Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create API Token</DialogTitle>
            <DialogDescription>
              Select granular permissions for this token
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

                <div className="space-y-2">
                  <label className="text-sm font-medium">Scopes</label>
                  <div className="border border-border max-h-64 overflow-y-auto">
                    {SCOPE_GROUPS.map((group, gi) => (
                      <div key={group}>
                        {gi > 0 && <Separator />}
                        <div className="px-3 py-1.5 bg-muted/50">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{group}</p>
                        </div>
                        {TOKEN_SCOPES.filter((s) => s.group === group).map((scope) => {
                          const isSelected = selectedScopes.includes(scope.value);
                          const canLimitToCA = scope.value === "cert:issue" || scope.value === "ca:create:intermediate";
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
                                  <p className="text-xs text-muted-foreground font-mono">{scope.value}</p>
                                </div>
                              </label>
                              {/* CA-specific restriction for cert:issue and ca:create:intermediate */}
                              {canLimitToCA && isSelected && (cas || []).length > 0 && (
                                <div className="px-3 pb-2 pl-10">
                                  <select
                                    value={caSpecificScopes[scope.value] || ""}
                                    onChange={(e) => setCaSpecificScopes((prev) => ({ ...prev, [scope.value]: e.target.value }))}
                                    className="h-8 w-full text-xs"
                                  >
                                    <option value="">All CAs (no restriction)</option>
                                    {(cas || []).map((ca) => (
                                      <option key={ca.id} value={ca.id}>{ca.commonName}</option>
                                    ))}
                                  </select>
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
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleCreateToken} disabled={isCreating || selectedScopes.length === 0}>
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

function InfoRow({ label, value, capitalize = false }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${capitalize ? "capitalize" : ""}`}>{value}</span>
    </div>
  );
}
