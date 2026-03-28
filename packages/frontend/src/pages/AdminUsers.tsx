import { Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageTransition } from "@/components/common/PageTransition";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { User, UserRole } from "@/types";

const ROLES: { value: UserRole; label: string; description: string }[] = [
  { value: "admin", label: "Admin", description: "Full access — manage CAs, users, settings" },
  { value: "operator", label: "Operator", description: "Issue and revoke certificates" },
  { value: "viewer", label: "Viewer", description: "Read-only access" },
];

function getInitials(name: string | null, email: string): string {
  if (name) {
    return name.split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  }
  return email[0].toUpperCase();
}

export function AdminUsers() {
  const navigate = useNavigate();
  const { user: currentUser, hasRole } = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!hasRole("admin")) {
      navigate("/");
      return;
    }
  }, [hasRole, navigate]);

  const loadUsers = async () => {
    try {
      const data = await api.listUsers();
      setUsers(data || []);
    } catch {
      toast.error("Failed to load users");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    try {
      await api.updateUserRole(userId, newRole);
      toast.success("Role updated");
      loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update role");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const admins = users.filter((u) => u.role === "admin").length;
  const operators = users.filter((u) => u.role === "operator").length;
  const viewers = users.filter((u) => u.role === "viewer").length;

  return (
    <PageTransition>
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-sm text-muted-foreground">
          {admins} admin{admins !== 1 ? "s" : ""}, {operators} operator{operators !== 1 ? "s" : ""}, {viewers} viewer{viewers !== 1 ? "s" : ""}
          &nbsp;&middot; New users get <strong>viewer</strong> role on first OIDC login
        </p>
      </div>

      {users.length > 0 ? (
        <div className="border border-border bg-card">
          <div className="divide-y divide-border">
            {users.map((user) => {
              const isSelf = currentUser?.id === user.id;
              return (
                <div
                  key={user.id}
                  className={`flex items-center gap-4 p-4 ${isSelf ? "bg-primary/5" : ""}`}
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
                      {isSelf && <Badge variant="secondary" className="text-[10px]">You</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>

                  <div className="w-40 shrink-0">
                    {isSelf ? (
                      <div className="flex items-center gap-2 px-3 py-2 text-sm">
                        <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="capitalize text-muted-foreground">{user.role}</span>
                      </div>
                    ) : (
                      <Select value={user.role} onValueChange={(v) => handleRoleChange(user.id, v as UserRole)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((role) => (
                            <SelectItem key={role.value} value={role.value}>
                              <div>
                                <span>{role.label}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 border border-border bg-card">
          <p className="text-muted-foreground">No users yet</p>
        </div>
      )}
    </div>
    </PageTransition>
  );
}
