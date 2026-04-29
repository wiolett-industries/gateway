import { Globe, Play, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRealtime } from "@/hooks/use-realtime";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { DockerRegistry, Node } from "@/types";

interface DockerRegistriesSectionProps {
  nodesList: Node[];
}

export function DockerRegistriesSection({ nodesList }: DockerRegistriesSectionProps) {
  const { hasScope } = useAuthStore();
  const canCreateRegistry = hasScope("docker:registries:create");
  const canEditRegistry = hasScope("docker:registries:edit");
  const canDeleteRegistry = hasScope("docker:registries:delete");
  const canTestRegistry = canEditRegistry;
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

  const loadRegistries = useCallback(async () => {
    try {
      const data = await api.listDockerRegistries();
      setRegistries(data ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadRegistries();
  }, [loadRegistries]);

  useRealtime("docker.registry.changed", () => {
    loadRegistries();
  });

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
    if (!canEditRegistry) return;
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
        if (!canEditRegistry) return;
        await api.updateRegistry(regEditId, payload);
        toast.success("Registry updated");
      } else {
        if (!canCreateRegistry) return;
        if (canTestRegistry) {
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

  return (
    <>
      <div className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="font-semibold">Docker Registries</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure private container registries for pulling images
            </p>
          </div>
          {canCreateRegistry && (
            <Button size="sm" onClick={openRegCreate}>
              <Plus className="h-4 w-4" />
              Add Registry
            </Button>
          )}
        </div>
        <div>
          {registries.length > 0 ? (
            <div className="divide-y divide-border">
              {registries.map((r) => (
                <div
                  key={r.id}
                  className={`flex items-center justify-between p-4 gap-4 transition-colors ${
                    canEditRegistry ? "cursor-pointer hover:bg-accent/50" : ""
                  }`}
                  onClick={canEditRegistry ? () => openRegEdit(r) : undefined}
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
                    {canTestRegistry && (
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
                    )}
                    {canDeleteRegistry && (
                      <Button variant="outline" size="icon" onClick={() => handleRegDelete(r)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
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
              disabled={
                regSaving ||
                !regName.trim() ||
                !regUrl.trim() ||
                (!regEditId && !canCreateRegistry) ||
                (!!regEditId && !canEditRegistry)
              }
            >
              {regSaving ? "Saving..." : regEditId ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
