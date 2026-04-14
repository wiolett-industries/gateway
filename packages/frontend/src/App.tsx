import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppStatusGate } from "@/components/common/AppStatusGate";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { RequireScope } from "@/components/common/RequireScope";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { AccessLists } from "@/pages/AccessLists";
import { AdminGroups } from "@/pages/AdminGroups";
import { AdminNodeDetail } from "@/pages/AdminNodeDetail";
import { AdminNodes } from "@/pages/AdminNodes";
import { AdminUsers } from "@/pages/AdminUsers";
import { AuditLog } from "@/pages/AuditLog";
import { AuthCallback } from "@/pages/AuthCallback";
import { BlockedPage } from "@/pages/Blocked";
import { CADetail } from "@/pages/CADetail";
import { CAs } from "@/pages/CAs";
import { CertificateDetail } from "@/pages/CertificateDetail";
import { Certificates } from "@/pages/Certificates";
import { Dashboard } from "@/pages/Dashboard";
import { Docker } from "@/pages/Docker";
import { DockerComposeLogsPopout } from "@/pages/DockerComposeLogsPopout";
import { DockerConsolePopout } from "@/pages/DockerConsolePopout";
import { DockerContainerDetail } from "@/pages/DockerContainerDetail";
import { DockerFilePopout } from "@/pages/DockerFilePopout";
import { DockerLogsPopout } from "@/pages/DockerLogsPopout";
import { Domains } from "@/pages/Domains";
import { LoginPage } from "@/pages/Login";
import { NginxTemplateEdit } from "@/pages/NginxTemplateEdit";
import { NodeConsolePopout } from "@/pages/NodeConsolePopout";
import { Notifications } from "@/pages/Notifications";
import { ProxyHostDetail } from "@/pages/ProxyHostDetail";
import { ProxyHosts } from "@/pages/ProxyHosts";
import { Settings } from "@/pages/Settings";
import { SSLCertificates } from "@/pages/SSLCertificates";
import { TemplatesPage } from "@/pages/TemplatesPage";
import { eventStream } from "@/services/event-stream";
import { useAppStatusStore } from "@/stores/app-status";
import { useAuthStore } from "@/stores/auth";

/** Helper to wrap a page element with a scope guard */
function scoped(scope: string, element: React.ReactElement) {
  return <RequireScope scope={scope}>{element}</RequireScope>;
}

function RealtimeBridge() {
  const sessionId = useAuthStore((s) => s.sessionId);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const canListNodes = useAuthStore((s) => s.hasScope("nodes:list"));

  useEffect(() => {
    if (sessionId) {
      eventStream.start();
      return () => eventStream.stop();
    }
    return;
  }, [sessionId]);

  // Live permission updates: refresh the local user (and thus scopes) whenever
  // the server says this user's permissions changed.
  useEffect(() => {
    if (!user?.id) return;
    return eventStream.subscribe(`permissions.changed.${user.id}`, async (payload) => {
      const ev = payload as { scopes?: string[]; groupId?: string | null };
      // Trust the pushed scopes — these come from the same source the server uses
      if (Array.isArray(ev?.scopes)) {
        const current = useAuthStore.getState().user;
        if (current) {
          setUser({
            ...current,
            scopes: ev.scopes,
            groupId: ev.groupId ?? current.groupId,
          } as typeof current);
        }
      }
    });
  }, [user?.id, setUser]);

  // Keep node-related views in sync by activating the shared node.changed
  // invalidation path in the event stream singleton.
  useEffect(() => {
    if (!sessionId || !canListNodes) return;
    return eventStream.subscribe("node.changed", () => {});
  }, [sessionId, canListNodes]);

  return null;
}

export default function App() {
  const [startupChecked, setStartupChecked] = useState(false);
  const maintenanceActive = useAppStatusStore((s) => s.maintenanceActive);
  const setMaintenanceActive = useAppStatusStore((s) => s.setMaintenanceActive);

  useEffect(() => {
    let cancelled = false;

    const checkHealth = async () => {
      try {
        const response = await fetch("/health", { cache: "no-store" });
        if (!cancelled) {
          setMaintenanceActive(!response.ok);
          setStartupChecked(true);
        }
      } catch {
        if (!cancelled) {
          setMaintenanceActive(true);
          setStartupChecked(true);
        }
      }
    };

    void checkHealth();

    return () => {
      cancelled = true;
    };
  }, [setMaintenanceActive]);

  if (!startupChecked) {
    return (
      <ThemeProvider>
        <div className="flex h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  if (maintenanceActive) {
    return (
      <ErrorBoundary>
        <ThemeProvider>
          <AppStatusGate />
        </ThemeProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <RealtimeBridge />
        <AppStatusGate />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/callback" element={<AuthCallback />} />
            <Route path="/blocked" element={<BlockedPage />} />
            <Route path="/docker/console/:nodeId/:containerId" element={<DockerConsolePopout />} />
            <Route path="/docker/logs/:nodeId/:containerId" element={<DockerLogsPopout />} />
            <Route path="/docker/file/:nodeId/:containerId" element={<DockerFilePopout />} />
            <Route
              path="/docker/compose-logs/:nodeId/:project"
              element={<DockerComposeLogsPopout />}
            />
            <Route path="/nodes/console/:nodeId" element={<NodeConsolePopout />} />
            <Route element={<DashboardLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/proxy-hosts" element={scoped("proxy:list", <ProxyHosts />)} />
              <Route
                path="/proxy-hosts/:id/:tab?"
                element={scoped("proxy:list", <ProxyHostDetail />)}
              />
              <Route
                path="/nginx-templates/new"
                element={scoped("proxy:edit", <NginxTemplateEdit />)}
              />
              <Route
                path="/nginx-templates/:id"
                element={scoped("proxy:list", <NginxTemplateEdit />)}
              />
              <Route
                path="/ssl-certificates"
                element={scoped("ssl:cert:list", <SSLCertificates />)}
              />
              <Route path="/domains" element={scoped("proxy:list", <Domains />)} />
              <Route path="/access-lists" element={scoped("acl:list", <AccessLists />)} />
              <Route path="/cas" element={scoped("pki:ca:list:root", <CAs />)} />
              <Route path="/cas/:id" element={scoped("pki:ca:list:root", <CADetail />)} />
              <Route path="/certificates" element={scoped("pki:cert:list", <Certificates />)} />
              <Route
                path="/certificates/:id"
                element={scoped("pki:cert:list", <CertificateDetail />)}
              />
              <Route path="/templates/:tab?" element={<TemplatesPage />} />
              <Route path="/audit" element={scoped("admin:audit", <AuditLog />)} />
              <Route
                path="/notifications/:tab?"
                element={scoped("notifications:view", <Notifications />)}
              />
              <Route path="/settings" element={<Settings />} />
              <Route path="/admin/users" element={scoped("admin:users", <AdminUsers />)} />
              <Route path="/admin/groups" element={scoped("admin:groups", <AdminGroups />)} />
              <Route path="/nodes" element={scoped("nodes:list", <AdminNodes />)} />
              <Route path="/nodes/:id/:tab?" element={scoped("nodes:list", <AdminNodeDetail />)} />
              <Route path="/docker/:tab?" element={scoped("docker:containers:list", <Docker />)} />
              <Route
                path="/docker/containers/:nodeId/:containerId/:tab?"
                element={scoped("docker:containers:view", <DockerContainerDetail />)}
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
