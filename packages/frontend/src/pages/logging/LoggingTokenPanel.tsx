import { Copy, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
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
import type { LoggingEnvironment, LoggingIngestToken } from "@/types";

export function LoggingTokenPanel({
  environment,
  canCreate,
  canDelete,
}: {
  environment: LoggingEnvironment;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const [tokens, setTokens] = useState<LoggingIngestToken[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listLoggingTokens(environment.id)
      .then(setTokens)
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Failed to load tokens")
      );
  }, [environment.id]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    try {
      const token = await api.createLoggingToken(environment.id, { name });
      setCreatedToken(token.token ?? null);
      setName("");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create token");
    }
  };

  const revoke = async (token: LoggingIngestToken) => {
    if (
      !(await confirm({
        title: "Revoke ingest token",
        description: `Revoke ${token.name}? Services using this token will stop ingesting logs.`,
        confirmLabel: "Revoke",
      }))
    ) {
      return;
    }
    await api.deleteLoggingToken(environment.id, token.id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Ingest Tokens</h3>
          <p className="text-xs text-muted-foreground">Write-only tokens for external services</p>
        </div>
        {canCreate && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> New Token
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        {tokens.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No ingest tokens.</div>
        ) : (
          tokens.map((token) => (
            <div
              key={token.id}
              className="flex flex-wrap items-center gap-3 border-b border-border p-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{token.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{token.tokenPrefix}...</p>
              </div>
              <Badge variant={token.enabled ? "success" : "secondary"}>
                {token.enabled ? "Enabled" : "Disabled"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Last used {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : "never"}
              </span>
              {canDelete && (
                <Button variant="ghost" size="icon" onClick={() => void revoke(token)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Ingest Token</DialogTitle>
            <DialogDescription>Generate a write-only token for this environment.</DialogDescription>
          </DialogHeader>
          {createdToken ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">This token is shown once.</p>
              <div className="flex items-center gap-2 rounded-md border border-border p-2">
                <code className="min-w-0 flex-1 truncate text-xs">{createdToken}</code>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => void navigator.clipboard.writeText(createdToken)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <label className="block space-y-1">
              <span className="text-sm font-medium">Name</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                setCreatedToken(null);
              }}
            >
              Close
            </Button>
            {!createdToken && (
              <Button disabled={!name.trim()} onClick={() => void create()}>
                Create
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
