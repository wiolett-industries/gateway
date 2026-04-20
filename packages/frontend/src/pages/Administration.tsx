import { useEffect, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { PageTransition } from "@/components/common/PageTransition";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlTab } from "@/hooks/use-url-tab";
import { useAuthStore } from "@/stores/auth";
import { AdminGroups } from "./AdminGroups";
import { AdminUsers } from "./AdminUsers";
import { AuditLog } from "./AuditLog";

type AdministrationTab = "users" | "groups" | "audit";

export function Administration() {
  const { hasScope } = useAuthStore();
  const canUsers = hasScope("admin:users");
  const canGroups = hasScope("admin:groups");
  const canAudit = hasScope("admin:audit");

  const availableTabs = useMemo<AdministrationTab[]>(() => {
    const tabs: AdministrationTab[] = [];
    if (canUsers) tabs.push("users");
    if (canGroups) tabs.push("groups");
    if (canAudit) tabs.push("audit");
    return tabs;
  }, [canAudit, canGroups, canUsers]);

  const [activeTab, setActiveTab] = useUrlTab(
    ["users", "groups", "audit"],
    availableTabs[0] ?? "users",
    (tab) => `/administration/${tab}`
  );

  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.includes(activeTab as AdministrationTab)) {
      setActiveTab(availableTabs[0]);
    }
  }, [activeTab, availableTabs, setActiveTab]);

  if (availableTabs.length === 0) {
    return <Navigate to="/" replace />;
  }

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Administration</h1>
          <p className="text-sm text-muted-foreground">
            Manage users, groups, and audit activity
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            {canUsers && <TabsTrigger value="users">Users</TabsTrigger>}
            {canGroups && <TabsTrigger value="groups">Groups</TabsTrigger>}
            {canAudit && <TabsTrigger value="audit">Audit Log</TabsTrigger>}
          </TabsList>

          {canUsers && (
            <TabsContent value="users">
              <AdminUsers embedded />
            </TabsContent>
          )}
          {canGroups && (
            <TabsContent value="groups">
              <AdminGroups embedded />
            </TabsContent>
          )}
          {canAudit && (
            <TabsContent value="audit">
              <AuditLog embedded />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </PageTransition>
  );
}
