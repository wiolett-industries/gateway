import { Ban, Lock, Trash2, Unlock } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

  if (isLoading) {
    return (
      <LoadingSpinner />
    );
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
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-sm text-muted-foreground">
            {users.length} user{users.length !== 1 ? "s" : ""}
            {summaryParts.length > 0 && <> &middot; {summaryParts.join(", ")}</>}
          </p>
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
      </div>
    </PageTransition>
  );
}
