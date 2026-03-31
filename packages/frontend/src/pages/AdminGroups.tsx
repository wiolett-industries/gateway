import { Loader2, Pencil, Plus, Shield, ShieldCheck, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { ScopeList } from "@/components/common/ScopeList";
import { PageTransition } from "@/components/common/PageTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import { TOKEN_SCOPES } from "@/types";
import type { PermissionGroup } from "@/types";

/** Scopes that can be restricted to specific CAs */
const CA_RESTRICTABLE_SCOPES = [
  "cert:issue",
  "cert:revoke",
  "cert:export",
  "ca:create:intermediate",
];

/**
 * Parse a scopes array into base selections + resource map.
 * e.g. ["cert:read", "cert:issue:abc", "cert:issue:def"] →
 *   baseScopes: ["cert:read", "cert:issue"]
 *   resources: { "cert:issue": ["abc", "def"] }
 */
function parseScopesForForm(scopes: string[]) {
  const baseScopes: string[] = [];
  const resources: Record<string, string[]> = {};

  for (const s of scopes) {
    // Check if this scope is a resource-scoped version of a CA-restrictable scope
    let matched = false;
    for (const base of CA_RESTRICTABLE_SCOPES) {
      if (s.startsWith(base + ":")) {
        const resourceId = s.slice(base.length + 1);
        if (!baseScopes.includes(base)) baseScopes.push(base);
        if (!resources[base]) resources[base] = [];
        resources[base].push(resourceId);
        matched = true;
        break;
      }
    }
    if (!matched) {
      baseScopes.push(s);
    }
  }

  return { baseScopes, resources };
}

/**
 * Build final scopes array from base selections + resource map.
 * If a CA-restrictable scope has resources selected, emit per-resource scopes.
 * Otherwise emit the base scope (unrestricted).
 */
function buildFinalScopes(
  baseScopes: string[],
  resources: Record<string, string[]>,
): string[] {
  const result: string[] = [];
  for (const scope of baseScopes) {
    const res = resources[scope];
    if (res && res.length > 0) {
      for (const id of res) result.push(`${scope}:${id}`);
    } else {
      result.push(scope);
    }
  }
  return result;
}

export function AdminGroups() {
  const navigate = useNavigate();
  const hasScope = useAuthStore((s) => s.hasScope);
  const { cas, fetchCAs } = useCAStore();
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PermissionGroup | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formBaseScopes, setFormBaseScopes] = useState<string[]>([]);
  const [formResources, setFormResources] = useState<Record<string, string[]>>({});
  const [scopeSearch, setScopeSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!hasScope("admin:groups")) {
      navigate("/");
      return;
    }
  }, [hasScope, navigate]);

  const fetchGroups = useCallback(async () => {
    try {
      const data = await api.listGroups();
      setGroups(data);
    } catch {
      toast.error("Failed to load groups");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
    fetchCAs();
  }, [fetchGroups, fetchCAs]);

  const openCreateDialog = () => {
    setEditingGroup(null);
    setFormName("");
    setFormDescription("");
    setFormBaseScopes([]);
    setFormResources({});
    setScopeSearch("");
    setDialogOpen(true);
  };

  const openEditDialog = (group: PermissionGroup) => {
    setEditingGroup(group);
    setFormName(group.name);
    setFormDescription(group.description ?? "");
    const { baseScopes, resources } = parseScopesForForm(group.scopes);
    setFormBaseScopes(baseScopes);
    setFormResources(resources);
    setScopeSearch("");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const finalScopes = buildFinalScopes(formBaseScopes, formResources);
    if (!formName.trim() || finalScopes.length === 0) {
      toast.error("Name and at least one scope are required");
      return;
    }
    setSaving(true);
    try {
      if (editingGroup) {
        await api.updateGroup(editingGroup.id, {
          name: formName.trim(),
          description: formDescription.trim() || null,
          scopes: finalScopes,
        });
        toast.success("Group updated");
      } else {
        await api.createGroup({
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          scopes: finalScopes,
        });
        toast.success("Group created");
      }
      setDialogOpen(false);
      fetchGroups();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save group");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (group: PermissionGroup) => {
    const ok = await confirm({
      title: "Delete Group",
      description: `Delete "${group.name}"? ${group.memberCount ? `${group.memberCount} user(s) are assigned — reassign them first.` : "This cannot be undone."}`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteGroup(group.id);
      toast.success("Group deleted");
      fetchGroups();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to delete group");
    }
  };

  const toggleScope = (scope: string) => {
    setFormBaseScopes((prev) => {
      if (prev.includes(scope)) {
        // Removing scope — also clear any resource restrictions
        setFormResources((r) => {
          const next = { ...r };
          delete next[scope];
          return next;
        });
        return prev.filter((s) => s !== scope);
      }
      return [...prev, scope];
    });
  };

  const toggleResource = (scope: string, caId: string) => {
    setFormResources((prev) => {
      const current = prev[scope] || [];
      const next = current.includes(caId)
        ? current.filter((id) => id !== caId)
        : [...current, caId];
      return { ...prev, [scope]: next };
    });
  };

  const selectedCount = buildFinalScopes(formBaseScopes, formResources).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">Permission Groups</h1>
            <p className="text-sm text-muted-foreground">
              {groups.length} group{groups.length !== 1 ? "s" : ""} &middot; Manage scoped access control
            </p>
          </div>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            Create Group
          </Button>
        </div>

        {groups.length > 0 ? (
          <div className="border border-border bg-card">
            <div className="divide-y divide-border">
              {groups.map((group) => (
                <div key={group.id} className="flex items-center gap-4 p-4">
                  {group.isBuiltin ? (
                    <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
                  ) : (
                    <Shield className="h-5 w-5 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{group.name}</span>
                      {group.isBuiltin && (
                        <Badge variant="secondary" className="text-[10px]">Built-in</Badge>
                      )}
                    </div>
                    {group.description && (
                      <p className="text-sm text-muted-foreground truncate">{group.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {group.memberCount ?? 0} member{(group.memberCount ?? 0) !== 1 ? "s" : ""}
                      </span>
                      <span>{group.scopes.length} scope{group.scopes.length !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  {!group.isBuiltin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(group)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(group)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState message="No permission groups found. Create one to get started." />
        )}
      </div>

      {/* Create / Edit Group Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingGroup ? "Edit Group" : "Create Group"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. cert-operator"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Optional description"
                className="mt-1"
              />
            </div>
            <div className="border border-border">
              <Input
                value={scopeSearch}
                onChange={(e) => setScopeSearch(e.target.value)}
                placeholder="Search scopes..."
                className="border-0 border-b border-border rounded-none h-9 text-sm focus-visible:ring-0"
              />
              <ScopeList
                scopes={TOKEN_SCOPES}
                search={scopeSearch}
                selected={formBaseScopes}
                onToggle={toggleScope}
                resources={formResources}
                onToggleResource={toggleResource}
                cas={cas}
                restrictableScopes={CA_RESTRICTABLE_SCOPES}
              />
              <div className="border-t border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {selectedCount} scope{selectedCount !== 1 ? "s" : ""} selected
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingGroup ? "Save Changes" : "Create Group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
