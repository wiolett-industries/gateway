import { Copy, Key, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
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
  buildFinalScopes,
  deriveAllowedResourceIdsByScope,
  hasSelectableScopeBase,
  parseScopesForForm,
} from "@/lib/scope-utils";
import { formatDate, formatRelativeDate } from "@/lib/utils";
import { api } from "@/services/api";
import { useCAStore } from "@/stores/ca";
import type { DatabaseConnection, LoggingSchema, Node, ProxyHost, User } from "@/types";
import { API_TOKEN_SCOPES, type ApiToken, RESOURCE_SCOPABLE_SCOPES } from "@/types";

interface ApiTokensSectionProps {
  user: User | null;
  nodesList: Node[];
  proxyHostsList: ProxyHost[];
  databasesList: DatabaseConnection[];
  loggingSchemasList: LoggingSchema[];
}

export function ApiTokensSection({
  user,
  nodesList,
  proxyHostsList,
  databasesList,
  loggingSchemasList,
}: ApiTokensSectionProps) {
  const { cas } = useCAStore();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [resourceScopes, setResourceScopes] = useState<Record<string, string[]>>({});
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [tokenScopeSearch, setTokenScopeSearch] = useState("");
  const [editingToken, setEditingToken] = useState<ApiToken | null>(null);
  const userScopes = useMemo(() => user?.scopes ?? [], [user?.scopes]);
  const allowedResourceIdsByScope = useMemo(
    () => deriveAllowedResourceIdsByScope(userScopes),
    [userScopes]
  );

  const loadTokens = useCallback(async () => {
    try {
      const data = await api.listTokens();
      setTokens(data || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  const openTokenEdit = (token: ApiToken) => {
    setEditingToken(token);
    setNewTokenName(token.name);
    const parsed = parseScopesForForm(token.scopes || []);
    setSelectedScopes(parsed.baseScopes);
    setResourceScopes(parsed.resources);
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
    setSelectedScopes((prev) => {
      if (prev.includes(scope)) {
        setResourceScopes((resources) => {
          const next = { ...resources };
          delete next[scope];
          return next;
        });
        return prev.filter((s) => s !== scope);
      }
      const allowedResourceIds = allowedResourceIdsByScope[scope];
      if (allowedResourceIds?.length) {
        setResourceScopes((resources) => ({ ...resources, [scope]: allowedResourceIds }));
      }
      return [...prev, scope];
    });
  };

  const handleCreateToken = async () => {
    if (!newTokenName.trim()) {
      toast.error("Token name is required");
      return;
    }
    for (const scope of selectedScopes) {
      if (allowedResourceIdsByScope[scope]?.length && (resourceScopes[scope]?.length ?? 0) === 0) {
        toast.error(`Select at least one resource for ${scope}`);
        return;
      }
    }
    const finalScopes = buildFinalScopes(selectedScopes, resourceScopes);
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

  return (
    <>
      <div className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="font-semibold">API Tokens</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Granular tokens for programmatic access. AI is available to users only.
            </p>
          </div>
          <Button size="sm" onClick={openTokenCreate}>
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
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-border bg-muted">
                      <Key className="h-4 w-4 text-muted-foreground" />
                    </div>
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
                        ? API_TOKEN_SCOPES.filter((s) => selectedScopes.includes(s.value))
                        : API_TOKEN_SCOPES.filter((s) =>
                            hasSelectableScopeBase(userScopes, s.value)
                          )
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
                    databases={databasesList}
                    loggingSchemas={loggingSchemasList}
                    restrictableScopes={RESOURCE_SCOPABLE_SCOPES}
                    allowedResourceIds={allowedResourceIdsByScope}
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
    </>
  );
}
