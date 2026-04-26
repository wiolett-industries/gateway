import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { AppStatusGate } from "@/components/common/AppStatusGate";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { RequireScope } from "@/components/common/RequireScope";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { AccessLists } from "@/pages/AccessLists";
import { Administration } from "@/pages/Administration";
import { AdminNodeDetail } from "@/pages/AdminNodeDetail";
import { AdminNodes } from "@/pages/AdminNodes";
import { AuthCallback } from "@/pages/AuthCallback";
import { BlockedPage } from "@/pages/Blocked";
import { CADetail } from "@/pages/CADetail";
import { CAs } from "@/pages/CAs";
import { CertificateDetail } from "@/pages/CertificateDetail";
import { Certificates } from "@/pages/Certificates";
import { Dashboard } from "@/pages/Dashboard";
import { DatabaseDetail } from "@/pages/DatabaseDetail";
import { Databases } from "@/pages/Databases";
import { Docker } from "@/pages/Docker";
import { DockerComposeLogsPopout } from "@/pages/DockerComposeLogsPopout";
import { DockerConsolePopout } from "@/pages/DockerConsolePopout";
import { DockerContainerDetail } from "@/pages/DockerContainerDetail";
import { DockerDeploymentDetail } from "@/pages/DockerDeploymentDetail";
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
import { StatusPage } from "@/pages/StatusPage";
import { TemplatesPage } from "@/pages/TemplatesPage";
import { api } from "@/services/api";
import { ApiRequestError } from "@/services/api-base";
import { eventStream } from "@/services/event-stream";
import { APP_STATUS_STORAGE_KEY, useAppStatusStore } from "@/stores/app-status";
import { useAuthStore } from "@/stores/auth";

/** Helper to wrap a page element with a scope guard */
function scoped(scope: string, element: React.ReactElement) {
  return <RequireScope scope={scope}>{element}</RequireScope>;
}

function PopoutAuthGate({ children }: { children: React.ReactElement }) {
  const navigate = useNavigate();
  const { user, isLoading, setUser, setLoading, logout } = useAuthStore();

  useEffect(() => {
    let cancelled = false;

    if (user) {
      if (isLoading) setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);

    void api
      .getCurrentUser()
      .then((freshUser) => {
        if (cancelled) return;
        if (freshUser.isBlocked) {
          setUser(freshUser);
          navigate("/blocked", { replace: true });
          return;
        }
        setUser(freshUser);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.status === 401) {
          logout();
          navigate("/login", { replace: true });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isLoading, logout, navigate, setLoading, setUser, user]);

  if (isLoading && !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function DockerContainerDetailGuard() {
  const { nodeId } = useParams<{ nodeId: string }>();
  const hasScope = useAuthStore((s) => s.hasScope);

  if (
    !hasScope("docker:containers:view") &&
    !(nodeId && hasScope(`docker:containers:view:${nodeId}`))
  ) {
    return <Navigate to="/" replace />;
  }

  return <DockerContainerDetail />;
}

function DockerDeploymentDetailGuard() {
  const { nodeId } = useParams<{ nodeId: string }>();
  const hasScope = useAuthStore((s) => s.hasScope);

  if (
    !hasScope("docker:containers:view") &&
    !(nodeId && hasScope(`docker:containers:view:${nodeId}`))
  ) {
    return <Navigate to="/" replace />;
  }

  return <DockerDeploymentDetail />;
}

function ProxyHostDetailGuard() {
  const { id } = useParams<{ id: string }>();
  const hasScope = useAuthStore((s) => s.hasScope);

  if (!hasScope("proxy:view") && !(id && hasScope(`proxy:view:${id}`))) {
    return <Navigate to="/" replace />;
  }

  return <ProxyHostDetail />;
}

function CAsPageGuard() {
  const hasAnyScope = useAuthStore((s) => s.hasAnyScope);

  if (!hasAnyScope("pki:ca:list:root", "pki:ca:list:intermediate")) {
    return <Navigate to="/" replace />;
  }

  return <CAs />;
}

function CADetailGuard() {
  const hasAnyScope = useAuthStore((s) => s.hasAnyScope);

  if (!hasAnyScope("pki:ca:view:root", "pki:ca:view:intermediate")) {
    return <Navigate to="/" replace />;
  }

  return <CADetail />;
}

function CertificateDetailGuard() {
  const hasScope = useAuthStore((s) => s.hasScope);

  if (!hasScope("pki:cert:view")) {
    return <Navigate to="/" replace />;
  }

  return <CertificateDetail />;
}

function NodeDetailGuard() {
  const { id } = useParams<{ id: string }>();
  const hasScope = useAuthStore((s) => s.hasScope);

  if (!hasScope("nodes:details") && !(id && hasScope(`nodes:details:${id}`))) {
    return <Navigate to="/" replace />;
  }

  return <AdminNodeDetail />;
}

function DockerPageGuard() {
  const hasScopedAccess = useAuthStore((s) => s.hasScopedAccess);

  const canAccessDocker =
    hasScopedAccess("docker:containers:list") ||
    hasScopedAccess("docker:images:list") ||
    hasScopedAccess("docker:volumes:list") ||
    hasScopedAccess("docker:networks:list") ||
    hasScopedAccess("docker:tasks");

  if (!canAccessDocker) {
    return <Navigate to="/" replace />;
  }

  return <Docker />;
}

function DatabasesPageGuard() {
  const hasScopedAccess = useAuthStore((s) => s.hasScopedAccess);

  const canAccessDatabases = hasScopedAccess("databases:list");

  if (!canAccessDatabases) {
    return <Navigate to="/" replace />;
  }

  return <Databases />;
}

function DatabaseDetailGuard() {
  const { id } = useParams<{ id: string }>();
  const hasScope = useAuthStore((s) => s.hasScope);

  if (!hasScope("databases:view") && !(id && hasScope(`databases:view:${id}`))) {
    return <Navigate to="/" replace />;
  }

  return <DatabaseDetail />;
}

function NotificationsPageGuard() {
  const hasAnyScope = useAuthStore((s) => s.hasAnyScope);

  const canAccessNotifications = hasAnyScope(
    "notifications:alerts:list",
    "notifications:alerts:view",
    "notifications:alerts:create",
    "notifications:alerts:edit",
    "notifications:alerts:delete",
    "notifications:webhooks:list",
    "notifications:webhooks:view",
    "notifications:webhooks:create",
    "notifications:webhooks:edit",
    "notifications:webhooks:delete",
    "notifications:deliveries:list",
    "notifications:deliveries:view",
    "notifications:view",
    "notifications:manage"
  );

  if (!canAccessNotifications) {
    return <Navigate to="/" replace />;
  }

  return <Notifications />;
}

function AdministrationPageGuard() {
  const hasAnyScope = useAuthStore((s) => s.hasAnyScope);

  if (!hasAnyScope("admin:audit", "admin:users", "admin:groups")) {
    return <Navigate to="/" replace />;
  }

  return <Administration />;
}

function RealtimeBridge() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const canListNodes = useAuthStore((s) => s.hasScope("nodes:list"));
  const setGatewayUpdatingActive = useAppStatusStore((s) => s.setGatewayUpdatingActive);
  const clearGatewayUpdating = useAppStatusStore((s) => s.clearGatewayUpdating);

  useEffect(() => {
    if (isAuthenticated) {
      eventStream.start();
      return () => eventStream.stop();
    }
    return;
  }, [isAuthenticated]);

  // Live permission updates: refresh the local user (and thus scopes) whenever
  // the server says this user's permissions changed.
  useEffect(() => {
    if (!user?.id) return;
    return eventStream.subscribe(`permissions.changed.${user.id}`, async () => {
      try {
        const freshUser = await api.getCurrentUser();
        setUser(freshUser);
      } catch {
        logout();
      }
    });
  }, [logout, setUser, user?.id]);

  // Keep node-related views in sync by activating the shared node.changed
  // invalidation path in the event stream singleton.
  useEffect(() => {
    if (!user || !canListNodes) return;
    return eventStream.subscribe("node.changed", () => {});
  }, [user, canListNodes]);

  useEffect(() => {
    if (!user) return;
    return eventStream.subscribe("system.update.changed", (payload) => {
      const ev = payload as { updating?: boolean; targetVersion?: string | null } | undefined;
      if (ev?.updating) {
        setGatewayUpdatingActive(true, ev.targetVersion ?? null);
      } else {
        clearGatewayUpdating();
      }
    });
  }, [clearGatewayUpdating, user, setGatewayUpdatingActive]);

  return null;
}

export default function App() {
  const [startupChecked, setStartupChecked] = useState(false);
  const maintenanceActive = useAppStatusStore((s) => s.maintenanceActive);
  const setMaintenanceActive = useAppStatusStore((s) => s.setMaintenanceActive);
  const setGatewayUpdatingActive = useAppStatusStore((s) => s.setGatewayUpdatingActive);
  const clearGatewayUpdating = useAppStatusStore((s) => s.clearGatewayUpdating);

  useEffect(() => {
    localStorage.removeItem("gateway-auth");

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

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== APP_STATUS_STORAGE_KEY || event.newValue == null) return;

      try {
        const parsed = JSON.parse(event.newValue) as {
          state?: {
            gatewayUpdatingActive?: boolean;
            gatewayUpdatingTargetVersion?: string | null;
          };
        };
        if (parsed.state?.gatewayUpdatingActive) {
          setGatewayUpdatingActive(true, parsed.state.gatewayUpdatingTargetVersion ?? null);
        } else {
          clearGatewayUpdating();
        }
      } catch {
        // Ignore malformed storage updates.
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [clearGatewayUpdating, setGatewayUpdatingActive]);

  if (!startupChecked) {
    return (
      <ThemeProvider>
        <div className="flex h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
            <Route
              path="/docker/console/:nodeId/:containerId"
              element={
                <PopoutAuthGate>
                  <DockerConsolePopout />
                </PopoutAuthGate>
              }
            />
            <Route
              path="/docker/logs/:nodeId/:containerId"
              element={
                <PopoutAuthGate>
                  <DockerLogsPopout />
                </PopoutAuthGate>
              }
            />
            <Route
              path="/docker/file/:nodeId/:containerId"
              element={
                <PopoutAuthGate>
                  <DockerFilePopout />
                </PopoutAuthGate>
              }
            />
            <Route
              path="/docker/compose-logs/:nodeId/:project"
              element={
                <PopoutAuthGate>
                  <DockerComposeLogsPopout />
                </PopoutAuthGate>
              }
            />
            <Route
              path="/nodes/console/:nodeId"
              element={
                <PopoutAuthGate>
                  <NodeConsolePopout />
                </PopoutAuthGate>
              }
            />
            <Route element={<DashboardLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/proxy-hosts" element={scoped("proxy:list", <ProxyHosts />)} />
              <Route path="/proxy-hosts/:id/:tab?" element={<ProxyHostDetailGuard />} />
              <Route
                path="/nginx-templates/new"
                element={scoped("proxy:edit", <NginxTemplateEdit />)}
              />
              <Route
                path="/nginx-templates/:id"
                element={scoped("proxy:edit", <NginxTemplateEdit />)}
              />
              <Route
                path="/ssl-certificates"
                element={scoped("ssl:cert:list", <SSLCertificates />)}
              />
              <Route path="/domains" element={scoped("proxy:list", <Domains />)} />
              <Route path="/access-lists" element={scoped("acl:list", <AccessLists />)} />
              <Route path="/cas" element={<CAsPageGuard />} />
              <Route path="/cas/:id" element={<CADetailGuard />} />
              <Route path="/certificates" element={scoped("pki:cert:list", <Certificates />)} />
              <Route path="/certificates/:id" element={<CertificateDetailGuard />} />
              <Route path="/templates/:tab?" element={<TemplatesPage />} />
              <Route path="/administration" element={<AdministrationPageGuard />} />
              <Route path="/administration/:tab" element={<AdministrationPageGuard />} />
              <Route
                path="/audit"
                element={scoped("admin:audit", <Navigate to="/administration/audit" replace />)}
              />
              <Route path="/notifications/:tab?" element={<NotificationsPageGuard />} />
              <Route
                path="/status-page/:tab?"
                element={scoped("status-page:view", <StatusPage />)}
              />
              <Route path="/databases" element={<DatabasesPageGuard />} />
              <Route path="/databases/:id/:tab?" element={<DatabaseDetailGuard />} />
              <Route path="/settings" element={<Settings />} />
              <Route
                path="/admin/users"
                element={scoped("admin:users", <Navigate to="/administration/users" replace />)}
              />
              <Route
                path="/admin/groups"
                element={scoped("admin:groups", <Navigate to="/administration/groups" replace />)}
              />
              <Route path="/nodes" element={scoped("nodes:list", <AdminNodes />)} />
              <Route path="/nodes/:id/:tab?" element={<NodeDetailGuard />} />
              <Route path="/docker/:tab?" element={<DockerPageGuard />} />
              <Route
                path="/docker/containers/:nodeId/:containerId/:tab?"
                element={<DockerContainerDetailGuard />}
              />
              <Route
                path="/docker/deployments/:nodeId/:deploymentId/:tab?"
                element={<DockerDeploymentDetailGuard />}
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
