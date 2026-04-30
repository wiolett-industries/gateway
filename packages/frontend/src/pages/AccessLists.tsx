import { motion } from "framer-motion";
import { Minus, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { PageTransition } from "@/components/common/PageTransition";
import { ResponsiveHeaderActions } from "@/components/common/ResponsiveHeaderActions";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useRealtime } from "@/hooks/use-realtime";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { AccessList, IPRule } from "@/types";

interface BasicAuthInput {
  username: string;
  password: string;
}

export function AccessLists() {
  const { hasScope } = useAuthStore();
  const cachedAccessLists = api.getCached<{ data: AccessList[] }>("access-lists:list");
  const [accessLists, setAccessLists] = useState<AccessList[]>(cachedAccessLists?.data ?? []);
  const [isLoading, setIsLoading] = useState(!cachedAccessLists);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AccessList | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ipRules, setIpRules] = useState<IPRule[]>([]);
  const [basicAuthEnabled, setBasicAuthEnabled] = useState(false);
  const [basicAuthUsers, setBasicAuthUsers] = useState<BasicAuthInput[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const loadAccessLists = useCallback(async () => {
    try {
      const res = await api.listAccessLists();
      setAccessLists(res.data || []);
    } catch {
      toast.error("Failed to load access lists");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccessLists();
  }, [loadAccessLists]);

  useRealtime("access-list.changed", () => {
    loadAccessLists();
  });

  const resetForm = () => {
    setName("");
    setDescription("");
    setIpRules([]);
    setBasicAuthEnabled(false);
    setBasicAuthUsers([]);
  };

  const openCreate = () => {
    setEditing(null);
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (al: AccessList) => {
    setEditing(al);
    setName(al.name);
    setDescription(al.description || "");
    setIpRules(al.ipRules || []);
    setBasicAuthEnabled(al.basicAuthEnabled);
    // Don't pre-fill passwords for edit
    setBasicAuthUsers(
      (al.basicAuthUsers || []).map((u) => ({ username: u.username, password: "" }))
    );
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    setIsSaving(true);
    try {
      const data = {
        name,
        description: description || undefined,
        ipRules: ipRules.filter((r) => r.value.trim() !== ""),
        basicAuthEnabled,
        basicAuthUsers: basicAuthEnabled
          ? basicAuthUsers.filter((u) => u.username.trim() !== "" && u.password.trim() !== "")
          : undefined,
      };

      if (editing) {
        await api.updateAccessList(editing.id, data);
        toast.success("Access list updated");
      } else {
        await api.createAccessList(data);
        toast.success("Access list created");
      }
      setDialogOpen(false);
      await loadAccessLists();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save access list");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (al: AccessList) => {
    const ok = await confirm({
      title: "Delete Access List",
      description: `Are you sure you want to delete "${al.name}"? This action cannot be undone.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteAccessList(al.id);
      toast.success("Access list deleted");
      loadAccessLists();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete access list");
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">Access Lists</h1>
            <p className="text-sm text-muted-foreground">
              Manage IP rules and basic authentication
            </p>
          </div>
          {hasScope("acl:edit") && (
            <ResponsiveHeaderActions
              actions={[
                {
                  label: "Add Access List",
                  icon: <Plus className="h-4 w-4" />,
                  onClick: openCreate,
                },
              ]}
            >
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Add Access List
              </Button>
            </ResponsiveHeaderActions>
          )}
        </div>

        {/* Table */}
        {accessLists.length > 0 ? (
          <div className="border border-border bg-card">
            <div className="overflow-x-auto -mb-px">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="p-3 text-xs font-medium text-muted-foreground">Name</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Description</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">IP Rules</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Auth Users</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Usage</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {accessLists.map((al) => (
                    <tr key={al.id} className="hover:bg-accent transition-colors">
                      <td className="p-3">
                        <p className="text-sm font-medium">{al.name}</p>
                      </td>
                      <td className="p-3">
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {al.description || "—"}
                        </p>
                      </td>
                      <td className="p-3">
                        <Badge variant="secondary" className="text-xs">
                          {(al.ipRules || []).length} rules
                        </Badge>
                      </td>
                      <td className="p-3">
                        {al.basicAuthEnabled ? (
                          <Badge variant="secondary" className="text-xs">
                            {(al.basicAuthUsers || []).length} users
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Disabled</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="text-sm text-muted-foreground">
                          {al.usageCount ?? 0} hosts
                        </span>
                      </td>
                      <td className="p-3">
                        {hasScope("acl:edit") && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(al)}>
                                <Pencil className="h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              {hasScope("acl:delete") && (
                                <DropdownMenuItem
                                  onClick={() => handleDelete(al)}
                                  className="text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState
            message="No access lists."
            {...(hasScope("acl:edit") ? { actionLabel: "Create one", onAction: openCreate } : {})}
          />
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Access List" : "Create Access List"}</DialogTitle>
              <DialogDescription>
                {editing
                  ? "Update access list settings"
                  : "Create a new access list with IP rules and optional basic authentication"}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              {/* Basic info */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Office Only"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description"
                  />
                </div>
              </div>

              {/* IP Rules */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">IP Rules</h3>
                {ipRules.map((rule, i) => (
                  <div key={i} className="flex gap-2">
                    <Select
                      value={rule.type}
                      onValueChange={(v) => {
                        const next = [...ipRules];
                        next[i] = { ...next[i], type: v as "allow" | "deny" };
                        setIpRules(next);
                      }}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="allow">Allow</SelectItem>
                        <SelectItem value="deny">Deny</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      className="flex-1"
                      value={rule.value}
                      onChange={(e) => {
                        const next = [...ipRules];
                        next[i] = { ...next[i], value: e.target.value };
                        setIpRules(next);
                      }}
                      placeholder="192.168.1.0/24 or IP address"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setIpRules(ipRules.filter((_, j) => j !== i))}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIpRules([...ipRules, { type: "allow", value: "" }])}
                >
                  <Plus className="h-4 w-4" />
                  Add IP Rule
                </Button>
              </div>

              {/* Basic Auth */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Switch checked={basicAuthEnabled} onChange={setBasicAuthEnabled} />
                  <span className="text-sm font-semibold">Basic Authentication</span>
                </div>

                {basicAuthEnabled && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                    className="space-y-2"
                  >
                    {basicAuthUsers.map((user, i) => (
                      <div key={i} className="flex gap-2">
                        <Input
                          placeholder="Username"
                          value={user.username}
                          onChange={(e) => {
                            const next = [...basicAuthUsers];
                            next[i] = { ...next[i], username: e.target.value };
                            setBasicAuthUsers(next);
                          }}
                        />
                        <Input
                          type="password"
                          placeholder={editing ? "New password (leave blank to keep)" : "Password"}
                          value={user.password}
                          onChange={(e) => {
                            const next = [...basicAuthUsers];
                            next[i] = { ...next[i], password: e.target.value };
                            setBasicAuthUsers(next);
                          }}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() =>
                            setBasicAuthUsers(basicAuthUsers.filter((_, j) => j !== i))
                          }
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setBasicAuthUsers([...basicAuthUsers, { username: "", password: "" }])
                      }
                    >
                      <Plus className="h-4 w-4" />
                      Add User
                    </Button>
                  </motion.div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Saving..." : editing ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PageTransition>
  );
}
