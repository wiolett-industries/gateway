import { Ban, Lock, Plus, Trash2, Unlock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { PageTransition } from "@/components/common/PageTransition";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import type { PermissionGroup, User } from "@/types";

function getInitials(name: string | null, email: string): string {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }
  return email[0].toUpperCase();
}

export function AdminUsers() {
  const navigate = useNavigate();
  const { user: currentUser, hasScope } = useAuthStore();
  const cachedUsers = api.getCached<User[]>("admin:users");
  const [users, setUsers] = useState<User[]>(cachedUsers ?? []);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(!cachedUsers);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createName, setCreateName] = useState("");
  const [createGroupId, setCreateGroupId] = useState("");

  useEffect(() => {
    if (!hasScope("admin:users")) {
      navigate("/");
      return;
    }
  }, [hasScope, navigate]);

  const loadUsers = useCallback(async () => {
    try {
      const data = await api.listUsers();
      setUsers(data || []);
    } catch {
      toast.error("Failed to load users");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    api
      .listGroups()
      .then(setGroups)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (createGroupId || groups.length === 0) return;
    const preferred =
      groups.find((group) => group.name === "viewer") ??
      groups.find((group) => !group.isBuiltin) ??
      groups[0];
    if (preferred) setCreateGroupId(preferred.id);
  }, [createGroupId, groups]);

  useRealtime("user.changed", () => {
    reloadUsers();
  });

  useRealtime("group.changed", () => {
    api
      .listGroups()
      .then(setGroups)
      .catch(() => {});
    reloadUsers();
  });

  const reloadUsers = useCallback(() => {
    api.invalidateCache("req:");
    api.invalidateCache("admin:users");
    return loadUsers();
  }, [loadUsers]);

  const handleGroupChange = async (userId: string, groupId: string) => {
    try {
      await api.updateUserGroup(userId, groupId);
      toast.success("Group updated");
      reloadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update group");
    }
  };

  const handleBlockToggle = async (user: User) => {
    const newBlocked = !user.isBlocked;
    try {
      await api.blockUser(user.id, newBlocked);
      toast.success(newBlocked ? "User blocked" : "User unblocked");
      reloadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update user");
    }
  };

  const handleDelete = async (user: User) => {
    const ok = await confirm({
      title: "Delete User",
      description: `Delete "${user.name || user.email}"? They will be recreated with default group on next login.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteUser(user.id);
      toast.success("User deleted");
      reloadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete user");
    }
  };

  const resetCreateDialog = () => {
    setCreateOpen(false);
    setCreateEmail("");
    setCreateName("");
    const preferred =
      groups.find((group) => group.name === "viewer") ??
      groups.find((group) => !group.isBuiltin) ??
      groups[0];
    setCreateGroupId(preferred?.id ?? "");
  };

  const handleCreateUser = async () => {
    if (!createEmail.trim() || !createGroupId) {
      toast.error("Email and group are required");
      return;
    }

    setCreating(true);
    try {
      await api.createUser({
        email: createEmail.trim(),
        name: createName.trim() || undefined,
        groupId: createGroupId,
      });
      toast.success("User created");
      resetCreateDialog();
      reloadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  // Group users by their group name for summary
  const groupCounts = new Map<string, number>();
  let blockedCount = 0;
  for (const u of users) {
    if (u.isBlocked) {
      blockedCount++;
    } else {
      groupCounts.set(u.groupName, (groupCounts.get(u.groupName) || 0) + 1);
    }
  }
  const summaryParts = Array.from(groupCounts.entries()).map(
    ([name, count]) => `${count} ${name.toLowerCase()}${count !== 1 ? "s" : ""}`
  );
  if (blockedCount > 0) summaryParts.push(`${blockedCount} blocked`);

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Users</h1>
            <p className="text-sm text-muted-foreground">
              {users.length} user{users.length !== 1 ? "s" : ""}
              {summaryParts.length > 0 && <> &middot; {summaryParts.join(", ")}</>}
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Create User
          </Button>
        </div>

        {users.length > 0 ? (
          <div className="border border-border bg-card">
            <div className="divide-y divide-border -mb-px [&>*:last-child]:border-b [&>*:last-child]:border-border">
              {users.map((user) => {
                const isSelf = currentUser?.id === user.id;
                const isSystemUser = user.oidcSubject?.startsWith("system:");
                const isReadOnly = isSelf || isSystemUser;
                return (
                  <div
                    key={user.id}
                    className={`flex items-center gap-4 p-4 ${isSelf ? "bg-primary/5" : user.isBlocked ? "opacity-60" : ""}`}
                  >
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarImage src={user.avatarUrl ?? undefined} />
                      <AvatarFallback className="text-xs">
                        {getInitials(user.name, user.email)}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{user.name || user.email}</p>
                        {isSelf ? (
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            You
                          </Badge>
                        ) : isSystemUser ? (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            System
                          </Badge>
                        ) : user.isBlocked ? (
                          <Badge variant="destructive" className="text-[10px] shrink-0">
                            <Ban className="h-2.5 w-2.5 mr-0.5" />
                            Blocked
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] shrink-0 invisible">
                            You
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>

                    <div className="shrink-0">
                      {isReadOnly ? (
                        <Badge variant="secondary" className="text-xs">
                          {user.groupName}
                        </Badge>
                      ) : (
                        <div className="w-44">
                          <Select
                            value={user.groupId}
                            onValueChange={(v) => handleGroupChange(user.id, v)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {groups.map((group) => (
                                <SelectItem key={group.id} value={group.id}>
                                  {group.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>

                    {!isReadOnly && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-8 w-8 shrink-0 text-muted-foreground ${user.isBlocked ? "hover:text-green-600" : "hover:text-orange-600"}`}
                          onClick={() => handleBlockToggle(user)}
                          title={user.isBlocked ? "Unblock user" : "Block user"}
                        >
                          {user.isBlocked ? (
                            <Unlock className="h-4 w-4" />
                          ) : (
                            <Lock className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(user)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <EmptyState message="No users." />
        )}

        <Dialog open={createOpen} onOpenChange={(open) => (!creating ? setCreateOpen(open) : null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="create-user-email" className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id="create-user-email"
                  type="email"
                  placeholder="user@example.com"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="create-user-name" className="text-sm font-medium">
                  Name
                </label>
                <Input
                  id="create-user-name"
                  placeholder="Jane Doe"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Group</label>
                <Select value={createGroupId} onValueChange={setCreateGroupId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select group" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                This creates a placeholder account so you can assign permissions before the user
                logs in for the first time.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetCreateDialog} disabled={creating}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateUser}
                disabled={creating || !createEmail || !createGroupId}
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PageTransition>
  );
}
