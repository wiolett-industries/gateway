import { Copy, Key, Moon, Plus, Sun, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useUIStore } from "@/stores/ui";
import type { ApiToken } from "@/types";
import { formatDate } from "@/lib/utils";

export function Settings() {
  const { user } = useAuthStore();
  const { theme, setTheme } = useUIStore();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenPermission, setNewTokenPermission] = useState<"read" | "read-write">("read");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const loadTokens = async () => {
    try {
      const data = await api.listTokens();
      setTokens(data || []);
    } catch {
      // Tokens might not be available
    }
  };

  useEffect(() => {
    loadTokens();
  }, []);

  const handleCreateToken = async () => {
    if (!newTokenName.trim()) {
      toast.error("Token name is required");
      return;
    }

    setIsCreating(true);
    try {
      const result = await api.createToken({
        name: newTokenName,
        permission: newTokenPermission,
      });
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

  return (
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
              <InfoRow label="Role" value={user.role} />
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
          <div className="flex gap-2">
            {(["light", "dark", "system"] as const).map((t) => (
              <Button
                key={t}
                variant={theme === t ? "default" : "outline"}
                size="sm"
                onClick={() => setTheme(t)}
                className="capitalize"
              >
                {t === "light" && <Sun className="h-4 w-4" />}
                {t === "dark" && <Moon className="h-4 w-4" />}
                {t}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* API Tokens */}
      <div className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-semibold">API Tokens</h2>
          <Button size="sm" onClick={() => {
            setNewTokenName("");
            setNewTokenPermission("read");
            setCreatedSecret(null);
            setCreateDialogOpen(true);
          }}>
            <Plus className="h-4 w-4" />
            Create Token
          </Button>
        </div>
        <div className="p-4">
          {tokens.length > 0 ? (
            <div className="divide-y divide-border">
              {tokens.map((token) => (
                <div key={token.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <Key className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{token.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {token.tokenPrefix}... &middot; Created {formatDate(token.createdAt)}
                        {token.lastUsedAt && ` · Last used ${formatDate(token.lastUsedAt)}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{token.permission}</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleRevokeToken(token)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Token</DialogTitle>
            <DialogDescription>
              Create a new API token for programmatic access
            </DialogDescription>
          </DialogHeader>

          {createdSecret ? (
            <div className="space-y-4">
              <div className="border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/5 p-3">
                <p className="text-sm font-medium text-[color:var(--color-warning)]">
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
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Permission</label>
                  <select
                    value={newTokenPermission}
                    onChange={(e) => setNewTokenPermission(e.target.value as "read" | "read-write")}
                    className="flex h-9 w-full border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="read">Read only</option>
                    <option value="read-write">Read &amp; Write</option>
                  </select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleCreateToken} disabled={isCreating}>
                  {isCreating ? "Creating..." : "Create Token"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium capitalize">{value}</span>
    </div>
  );
}
