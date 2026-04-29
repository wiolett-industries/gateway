import {
  CornerDownRight,
  Loader2,
  Pencil,
  Plus,
  Shield,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { PageTransition } from "@/components/common/PageTransition";
import { ScopeList } from "@/components/common/ScopeList";
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
import { useCAStore } from "@/stores/ca";
import type { DatabaseConnection, LoggingSchema, Node, PermissionGroup, ProxyHost } from "@/types";
import { GROUP_ASSIGNABLE_SCOPES, RESOURCE_SCOPABLE_SCOPES } from "@/types";

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
    // Check if this scope is a resource-scoped version of a restrictable scope
    let matched = false;
    for (const base of RESOURCE_SCOPABLE_SCOPES) {
      if (s.startsWith(`${base}:`)) {
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
function buildFinalScopes(baseScopes: string[], resources: Record<string, string[]>): string[] {
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

function scopeMatches(scopes: string[], requiredScope: string): boolean {
  if (scopes.includes(requiredScope)) return true;
  const parts = requiredScope.split(":");
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join(":");
    if (scopes.includes(prefix)) return true;
  }
  return false;
}

function isScopeSubset(requestedScopes: string[], allowedScopes: string[]): boolean {
  return requestedScopes.every((scope) => scopeMatches(allowedScopes, scope));
}

function getGroupEffectiveScopes(group: PermissionGroup): string[] {
  return [...new Set([...group.scopes, ...(group.inheritedScopes ?? [])])];
}

function findMissingRequiredResourceSelection(
  baseScopes: string[],
  resources: Record<string, string[]>,
  allowedResourceIdsByScope: Record<string, string[]>
): string | null {
  for (const scope of baseScopes) {
    if (
      (allowedResourceIdsByScope[scope]?.length ?? 0) > 0 &&
      (resources[scope]?.length ?? 0) === 0
    ) {
      return scope;
    }
  }
  return null;
}

export function AdminGroups({
  embedded = false,
  createRequest = 0,
}: {
  embedded?: boolean;
  createRequest?: number;
}) {
  const navigate = useNavigate();
  const { user, hasScope } = useAuthStore();
  const { cas, fetchCAs } = useCAStore();
  const [nodesList, setNodesList] = useState<Node[]>([]);
  const [proxyHostsList, setProxyHostsList] = useState<ProxyHost[]>([]);
  const [databasesList, setDatabasesList] = useState<DatabaseConnection[]>([]);
  const [loggingSchemasList, setLoggingSchemasList] = useState<LoggingSchema[]>([]);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PermissionGroup | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formParentId, setFormParentId] = useState<string | null>(null);
  const [formBaseScopes, setFormBaseScopes] = useState<string[]>([]);
  const [formResources, setFormResources] = useState<Record<string, string[]>>({});
  const [scopeSearch, setScopeSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const userScopes = useMemo(() => user?.scopes ?? [], [user?.scopes]);
  const allowedResourceIdsByScope = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const scope of RESOURCE_SCOPABLE_SCOPES) {
      if (userScopes.includes(scope)) continue;
      const prefix = `${scope}:`;
      const ids = userScopes
        .filter((candidate) => candidate.startsWith(prefix))
        .map((candidate) => candidate.slice(prefix.length));
      if (ids.length > 0) result[scope] = [...new Set(ids)];
    }
    return result;
  }, [userScopes]);
  const assignableScopes = useMemo(
    () =>
      GROUP_ASSIGNABLE_SCOPES.filter((scope) =>
        userScopes.some(
          (userScope) => userScope === scope.value || userScope.startsWith(`${scope.value}:`)
        )
      ),
    [userScopes]
  );
  const canManageGroup = useCallback(
    (group: PermissionGroup) => isScopeSubset(getGroupEffectiveScopes(group), userScopes),
    [userScopes]
  );
  const availableParentGroups = useMemo(
    () =>
      groups.filter(
        (group) =>
          group.id !== editingGroup?.id &&
          !group.parentId &&
          !getGroupEffectiveScopes(group).includes("admin:system") &&
          isScopeSubset(getGroupEffectiveScopes(group), userScopes)
      ),
    [editingGroup?.id, groups, userScopes]
  );

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
    api
      .listNodes({ limit: 100 })
      .then((r) => setNodesList(r.data ?? []))
      .catch(() => {});
    api
      .listProxyHosts({ limit: 100 })
      .then((r) => setProxyHostsList(r.data ?? []))
      .catch(() => {});
    api
      .listDatabases({ limit: 200 })
      .then((r) => setDatabasesList(r.data ?? []))
      .catch(() => {});
    if (
      userScopes.some(
        (scope) =>
          scope === "logs:schemas:list" ||
          scope === "logs:manage" ||
          scope.startsWith("logs:schemas:view:")
      )
    ) {
      api
        .listLoggingSchemas()
        .then(setLoggingSchemasList)
        .catch(() => {});
    }
  }, [fetchGroups, fetchCAs, userScopes]);

  useRealtime("group.changed", () => {
    fetchGroups();
  });

  useRealtime("user.changed", () => {
    fetchGroups();
  });

  useRealtime("ca.changed", () => {
    fetchCAs();
  });

  useRealtime("node.changed", () => {
    api
      .listNodes({ limit: 100 })
      .then((r) => setNodesList(r.data ?? []))
      .catch(() => {});
  });

  useRealtime("proxy.host.changed", () => {
    api
      .listProxyHosts({ limit: 100 })
      .then((r) => setProxyHostsList(r.data ?? []))
      .catch(() => {});
  });

  useRealtime("database.changed", () => {
    api
      .listDatabases({ limit: 200 })
      .then((r) => setDatabasesList(r.data ?? []))
      .catch(() => {});
  });

  const openCreateDialog = useCallback(() => {
    setEditingGroup(null);
    setFormName("");
    setFormDescription("");
    setFormParentId(null);
    setFormBaseScopes([]);
    setFormResources({});
    setScopeSearch("");
    setDialogOpen(true);
  }, []);

  useEffect(() => {
    if (!embedded || createRequest === 0) return;
    openCreateDialog();
  }, [createRequest, embedded, openCreateDialog]);

  const openEditDialog = (group: PermissionGroup) => {
    setEditingGroup(group);
    setFormName(group.name);
    setFormDescription(group.description ?? "");
    setFormParentId(group.parentId);
    const { baseScopes, resources } = parseScopesForForm(group.scopes);
    setFormBaseScopes(baseScopes);
    setFormResources(resources);
    setScopeSearch("");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const missingResourceScope = findMissingRequiredResourceSelection(
      formBaseScopes,
      formResources,
      allowedResourceIdsByScope
    );
    if (missingResourceScope) {
      toast.error(`Select at least one resource for ${missingResourceScope}`);
      return;
    }

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
          parentId: formParentId,
        });
        toast.success("Group updated");
      } else {
        await api.createGroup({
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          scopes: finalScopes,
          parentId: formParentId,
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
      const allowedResourceIds = allowedResourceIdsByScope[scope];
      if (allowedResourceIds?.length) {
        setFormResources((resources) => ({ ...resources, [scope]: allowedResourceIds }));
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

  const ownCount = buildFinalScopes(formBaseScopes, formResources).length;
  const inheritedScopes = formParentId
    ? [
        ...new Set([
          ...(groups.find((g) => g.id === formParentId)?.scopes ?? []),
          ...(groups.find((g) => g.id === formParentId)?.inheritedScopes ?? []),
        ]),
      ]
    : [];
  const inheritedCount = inheritedScopes.length;
  const selectedCount = new Set([
    ...buildFinalScopes(formBaseScopes, formResources),
    ...inheritedScopes,
  ]).size;

  if (isLoading) {
    return <LoadingSpinner />;
  }

  const content = (
    <>
      <div className={embedded ? "space-y-4" : "h-full overflow-y-auto p-6 space-y-4"}>
        {!embedded && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl font-bold">Permission Groups</h1>
              <p className="text-sm text-muted-foreground">
                {groups.length} group{groups.length !== 1 ? "s" : ""} &middot; Manage scoped access
                control
              </p>
            </div>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4" />
              Create Group
            </Button>
          </div>
        )}

        {groups.length > 0 ? (
          <div className="border border-border bg-card">
            <div className="divide-y divide-border">
              {groups
                .filter((g) => !g.parentId)
                .map((group) => (
                  <GroupRow
                    key={group.id}
                    group={group}
                    allGroups={groups}
                    depth={0}
                    canManageGroup={canManageGroup}
                    onEdit={openEditDialog}
                    onDelete={handleDelete}
                  />
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
            <div>
              <label className="text-sm font-medium">Inherit From</label>
              {editingGroup && groups.some((g) => g.parentId === editingGroup.id) ? (
                <>
                  <Input value="None" disabled className="mt-1" />
                  <p className="text-xs text-muted-foreground mt-1">
                    This group has child groups — it cannot be nested under another group
                  </p>
                </>
              ) : (
                <>
                  <Select
                    value={formParentId ?? "__none__"}
                    onValueChange={(v) => setFormParentId(v === "__none__" ? null : v)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {availableParentGroups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                          {g.isBuiltin ? " (built-in)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Inherited permissions stay inline in their normal categories and cannot be
                    removed here
                  </p>
                </>
              )}
            </div>
            <div className="border border-border">
              <Input
                value={scopeSearch}
                onChange={(e) => setScopeSearch(e.target.value)}
                placeholder="Search scopes..."
                className="border-0 border-b border-border rounded-none h-9 text-sm focus-visible:ring-0"
              />
              <ScopeList
                scopes={assignableScopes}
                search={scopeSearch}
                selected={formBaseScopes}
                onToggle={toggleScope}
                resources={formResources}
                onToggleResource={toggleResource}
                cas={cas}
                nodes={nodesList}
                proxyHosts={proxyHostsList}
                databases={databasesList}
                loggingSchemas={loggingSchemasList}
                restrictableScopes={RESOURCE_SCOPABLE_SCOPES}
                allowedResourceIds={allowedResourceIdsByScope}
                inheritedScopes={inheritedScopes}
                inheritedFromName={groups.find((g) => g.id === formParentId)?.name}
              />
              <div className="border-t border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {selectedCount} scope{selectedCount !== 1 ? "s" : ""} selected
                  {inheritedCount > 0 && ` (${ownCount} own + ${inheritedCount} inherited)`}
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
    </>
  );

  return embedded ? content : <PageTransition>{content}</PageTransition>;
}

function GroupRow({
  group,
  allGroups,
  depth,
  canManageGroup,
  onEdit,
  onDelete,
}: {
  group: PermissionGroup;
  allGroups: PermissionGroup[];
  depth: number;
  canManageGroup: (g: PermissionGroup) => boolean;
  onEdit: (g: PermissionGroup) => void;
  onDelete: (g: PermissionGroup) => void;
}) {
  const children = allGroups.filter((g) => g.parentId === group.id);
  const canManage = canManageGroup(group);

  return (
    <>
      <div className="flex items-center gap-4 p-4">
        <div className="flex items-center gap-1.5">
          {depth > 0 && <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          {group.isBuiltin ? (
            <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
          ) : (
            <Shield className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{group.name}</span>
            {group.isBuiltin && (
              <Badge variant="secondary" className="text-[10px]">
                Built-in
              </Badge>
            )}
            {group.parentId && (
              <Badge variant="outline" className="text-[10px]">
                Inherits
              </Badge>
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
            <span>
              {group.scopes.length} scope{group.scopes.length !== 1 ? "s" : ""}
              {(group.inheritedScopes?.length ?? 0) > 0 && (
                <> + {group.inheritedScopes!.length} inherited</>
              )}
            </span>
          </div>
        </div>
        {!group.isBuiltin && (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!canManage}
              title={
                !canManage ? "Cannot edit groups with permissions you do not possess" : undefined
              }
              onClick={() => canManage && onEdit(group)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!canManage}
              title={
                !canManage ? "Cannot delete groups with permissions you do not possess" : undefined
              }
              onClick={() => canManage && onDelete(group)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      {children.map((child) => (
        <GroupRow
          key={child.id}
          group={child}
          allGroups={allGroups}
          depth={depth + 1}
          canManageGroup={canManageGroup}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}
