import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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
import { DockerConsolePopout } from "@/pages/DockerConsolePopout";
import { DockerContainerDetail } from "@/pages/DockerContainerDetail";
import { DockerFilePopout } from "@/pages/DockerFilePopout";
import { DockerLogsPopout } from "@/pages/DockerLogsPopout";
import { DockerContainers } from "@/pages/DockerContainers";
import { DockerImages } from "@/pages/DockerImages";
import { DockerNetworks } from "@/pages/DockerNetworks";
import { DockerTasks } from "@/pages/DockerTasks";
import { DockerTemplatesPage } from "@/pages/DockerTemplates";
import { DockerVolumes } from "@/pages/DockerVolumes";
import { Domains } from "@/pages/Domains";
import { LoginPage } from "@/pages/Login";
import { NginxTemplateEdit } from "@/pages/NginxTemplateEdit";
import { NginxTemplates } from "@/pages/NginxTemplates";
import { ProxyHostDetail } from "@/pages/ProxyHostDetail";
import { ProxyHosts } from "@/pages/ProxyHosts";
import { Settings } from "@/pages/Settings";
import { SSLCertificates } from "@/pages/SSLCertificates";
import { Templates } from "@/pages/Templates";

/** Helper to wrap a page element with a scope guard */
function scoped(scope: string, element: React.ReactElement) {
  return <RequireScope scope={scope}>{element}</RequireScope>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/callback" element={<AuthCallback />} />
            <Route path="/blocked" element={<BlockedPage />} />
            <Route
              path="/docker/console/:nodeId/:containerId"
              element={<DockerConsolePopout />}
            />
            <Route
              path="/docker/logs/:nodeId/:containerId"
              element={<DockerLogsPopout />}
            />
            <Route
              path="/docker/file/:nodeId/:containerId"
              element={<DockerFilePopout />}
            />
            <Route element={<DashboardLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/proxy-hosts" element={scoped("proxy:list", <ProxyHosts />)} />
              <Route path="/proxy-hosts/:id" element={scoped("proxy:list", <ProxyHostDetail />)} />
              <Route path="/nginx-templates" element={scoped("proxy:list", <NginxTemplates />)} />
              <Route
                path="/nginx-templates/new"
                element={scoped("proxy:edit", <NginxTemplateEdit />)}
              />
              <Route
                path="/nginx-templates/:id"
                element={scoped("proxy:list", <NginxTemplateEdit />)}
              />
              <Route path="/ssl-certificates" element={scoped("ssl:read", <SSLCertificates />)} />
              <Route path="/domains" element={scoped("proxy:list", <Domains />)} />
              <Route path="/access-lists" element={scoped("access-list:read", <AccessLists />)} />
              <Route path="/cas" element={scoped("ca:read", <CAs />)} />
              <Route path="/cas/:id" element={scoped("ca:read", <CADetail />)} />
              <Route path="/certificates" element={scoped("cert:read", <Certificates />)} />
              <Route
                path="/certificates/:id"
                element={scoped("cert:read", <CertificateDetail />)}
              />
              <Route path="/templates" element={scoped("template:read", <Templates />)} />
              <Route path="/audit" element={scoped("admin:audit", <AuditLog />)} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/admin/users" element={scoped("admin:users", <AdminUsers />)} />
              <Route path="/admin/groups" element={scoped("admin:groups", <AdminGroups />)} />
              <Route path="/nodes" element={scoped("nodes:list", <AdminNodes />)} />
              <Route path="/nodes/:id" element={scoped("nodes:list", <AdminNodeDetail />)} />
              <Route
                path="/docker/containers"
                element={scoped("docker:list", <DockerContainers />)}
              />
              <Route
                path="/docker/containers/:nodeId/:containerId"
                element={scoped("docker:view", <DockerContainerDetail />)}
              />
              <Route path="/docker/images" element={scoped("docker:images", <DockerImages />)} />
              <Route path="/docker/volumes" element={scoped("docker:volumes", <DockerVolumes />)} />
              <Route
                path="/docker/networks"
                element={scoped("docker:networks", <DockerNetworks />)}
              />
              <Route
                path="/docker/templates"
                element={scoped("docker:templates", <DockerTemplatesPage />)}
              />
              <Route path="/docker/tasks" element={scoped("docker:tasks", <DockerTasks />)} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
