import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { PageTransition } from "@/components/common/PageTransition";
import { ResponsiveHeaderActions } from "@/components/common/ResponsiveHeaderActions";
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
  const [auditHeaderActionsEl, setAuditHeaderActionsEl] = useState<HTMLDivElement | null>(null);
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
  const usesFillLayout = currentTab === "audit";

  return (
    <PageTransition>
      <div
        className={
          usesFillLayout
            ? "flex h-full min-h-0 flex-col overflow-hidden p-6"
            : "h-full overflow-y-auto p-6 space-y-4"
        }
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{currentMeta.title}</h1>
            <p className="text-sm text-muted-foreground">{currentMeta.subtitle}</p>
          </div>
          {currentMeta.actionLabel && currentMeta.onAction ? (
            <ResponsiveHeaderActions
              actions={[
                {
                  label: currentMeta.actionLabel,
                  icon: <Plus className="h-4 w-4" />,
                  onClick: currentMeta.onAction,
                },
              ]}
            >
              <Button onClick={currentMeta.onAction}>
                <Plus className="h-4 w-4" />
                {currentMeta.actionLabel}
              </Button>
            </ResponsiveHeaderActions>
          ) : currentTab === "audit" ? (
            <div ref={setAuditHeaderActionsEl} className="shrink-0" />
          ) : null}
        </div>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className={`flex flex-col ${usesFillLayout ? "mt-4 min-h-0 flex-1" : ""}`}
        >
          <TabsList>
            {canUsers && <TabsTrigger value="users">Users</TabsTrigger>}
            {canGroups && <TabsTrigger value="groups">Groups</TabsTrigger>}
            {canAudit && <TabsTrigger value="audit">Audit Log</TabsTrigger>}
          </TabsList>

          {canUsers && (
            <TabsContent value="users" className="mt-4">
              <AdminUsers embedded createRequest={usersCreateRequest} />
            </TabsContent>
          )}
          {canGroups && (
            <TabsContent value="groups" className="mt-4">
              <AdminGroups embedded createRequest={groupsCreateRequest} />
            </TabsContent>
          )}
          {canAudit && (
            <TabsContent value="audit" className="mt-4 flex min-h-0 flex-1 flex-col">
              <AuditLog embedded headerActionsTarget={auditHeaderActionsEl} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </PageTransition>
  );
}
