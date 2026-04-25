import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { PageTransition } from "@/components/common/PageTransition";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlTab } from "@/hooks/use-url-tab";
import { useAuthStore } from "@/stores/auth";
import { AdminGroups } from "./AdminGroups";
import { AdminUsers } from "./AdminUsers";
import { AuditLog } from "./AuditLog";

type AdministrationTab = "users" | "groups" | "audit";

export function Administration() {
  const { hasScope } = useAuthStore();
  const [usersCreateRequest, setUsersCreateRequest] = useState(0);
  const [groupsCreateRequest, setGroupsCreateRequest] = useState(0);
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

  const tabMeta: Record<
    AdministrationTab,
    { title: string; subtitle: string; actionLabel?: string; onAction?: () => void }
  > = {
    users: {
      title: "Users",
      subtitle: "Manage system users and their assigned permission groups",
      actionLabel: "Create User",
      onAction: () => setUsersCreateRequest((value) => value + 1),
    },
    groups: {
      title: "Groups",
      subtitle: "Manage permission groups and scoped access rules",
      actionLabel: "Create Group",
      onAction: () => setGroupsCreateRequest((value) => value + 1),
    },
    audit: {
      title: "Audit Log",
      subtitle: "Review administrative actions and system activity",
    },
  };

  const currentTab = (
    availableTabs.includes(activeTab as AdministrationTab) ? activeTab : availableTabs[0]
  ) as AdministrationTab;
  const currentMeta = tabMeta[currentTab];

  return (
    <PageTransition>
      <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{currentMeta.title}</h1>
            <p className="text-sm text-muted-foreground">{currentMeta.subtitle}</p>
          </div>
          {currentMeta.actionLabel && currentMeta.onAction ? (
            <Button onClick={currentMeta.onAction}>
              <Plus className="h-4 w-4" />
              {currentMeta.actionLabel}
            </Button>
          ) : null}
        </div>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="mt-4 flex min-h-0 flex-1 flex-col"
        >
          <TabsList>
            {canUsers && <TabsTrigger value="users">Users</TabsTrigger>}
            {canGroups && <TabsTrigger value="groups">Groups</TabsTrigger>}
            {canAudit && <TabsTrigger value="audit">Audit Log</TabsTrigger>}
          </TabsList>

          {canUsers && (
            <TabsContent value="users" className="mt-4 flex min-h-0 flex-1 flex-col">
              <AdminUsers embedded createRequest={usersCreateRequest} />
            </TabsContent>
          )}
          {canGroups && (
            <TabsContent value="groups" className="mt-4 flex min-h-0 flex-1 flex-col">
              <AdminGroups embedded createRequest={groupsCreateRequest} />
            </TabsContent>
          )}
          {canAudit && (
            <TabsContent value="audit" className="mt-4 flex min-h-0 flex-1 flex-col">
              <AuditLog embedded />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </PageTransition>
  );
}
