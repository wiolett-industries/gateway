import { MoreVertical, Shield, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import type { User, UserRole } from "@/types";
import { formatDate } from "@/lib/utils";

const roleBadge = (role: UserRole) => {
  switch (role) {
    case "admin":
      return <Badge className="bg-destructive text-destructive-foreground">Admin</Badge>;
    case "operator":
      return <Badge className="bg-[color:var(--color-warning)] text-white">Operator</Badge>;
    case "auditor":
      return <Badge variant="secondary">Auditor</Badge>;
    case "viewer":
      return <Badge variant="secondary">Viewer</Badge>;
    default:
      return <Badge variant="secondary">{role}</Badge>;
  }
};

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
      const { data } = await api.listUsers();
      setUsers(data);
    } catch (err) {
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

  const handleDelete = async (user: User) => {
    if (!confirm(`Delete user "${user.name}"? This action cannot be undone.`)) return;
    try {
      await api.deleteUser(user.id);
      toast.success("User deleted");
      loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete user");
    }
  };

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">User Management</h1>
        <p className="text-sm text-muted-foreground">{users.length} users total</p>
      </div>

      {/* Users table */}
      {users.length > 0 ? (
        <div className="border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="p-3 text-xs font-medium text-muted-foreground">User</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Role</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground">Created</th>
                  <th className="p-3 text-xs font-medium text-muted-foreground w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-accent transition-colors">
                    <td className="p-3">
                      <div>
                        <p className="text-sm font-medium">{user.name}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </td>
                    <td className="p-3">{roleBadge(user.role)}</td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="p-3">
                      {currentUser?.id !== user.id && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleRoleChange(user.id, "admin")}>
                              <Shield className="h-4 w-4" />
                              Set as Admin
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleRoleChange(user.id, "operator")}>
                              <Shield className="h-4 w-4" />
                              Set as Operator
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleRoleChange(user.id, "auditor")}>
                              <Shield className="h-4 w-4" />
                              Set as Auditor
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleRoleChange(user.id, "viewer")}>
                              <Shield className="h-4 w-4" />
                              Set as Viewer
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDelete(user)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete User
                            </DropdownMenuItem>
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
        <div className="flex flex-col items-center gap-2 py-16 border border-border bg-card">
          <Users className="h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">No users found</p>
        </div>
      )}
    </div>
  );
}
