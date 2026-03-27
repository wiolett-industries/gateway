import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageTransition } from "@/components/common/PageTransition";

import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { User, UserRole } from "@/types";

const ROLES: UserRole[] = ["admin", "operator", "viewer"];

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
      toast.success("User role updated");
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

  return (
    <PageTransition>
    <div className="h-full overflow-y-auto p-6 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">User Management</h1>
        <p className="text-sm text-muted-foreground">{users.length} users total</p>
      </div>

      {/* Users table */}
      {users.length > 0 ? (
        <div className="border border-border rounded-md bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left bg-muted/40">
                  <th className="p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Role</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-20">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => {
                  const isSelf = currentUser?.id === user.id;
                  return (
                    <tr
                      key={user.id}
                      className={
                        isSelf
                          ? "bg-primary/5 border-l-2 border-l-primary"
                          : "hover:bg-accent transition-colors"
                      }
                    >
                      <td className="p-3 text-sm font-medium">
                        <span className="flex items-center gap-2">
                          {user.name || user.email}
                          {isSelf && (
                            <span className="text-xs text-muted-foreground">(you)</span>
                          )}
                        </span>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">{user.email}</td>
                      <td className="p-3">
                        <select
                          value={user.role}
                          disabled={isSelf}
                          onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)}
                          className={
                            "h-9 w-full text-sm " +
                            (isSelf ? "opacity-50 cursor-not-allowed" : "cursor-pointer")
                          }
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role.charAt(0).toUpperCase() + role.slice(1)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {isSelf ? (
                          <span className="text-xs italic">N/A</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Change role</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 border border-border rounded-md bg-card">
          <Users className="h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">No users found</p>
        </div>
      )}
    </div>
    </PageTransition>
  );
}
