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
import { Docker } from "@/pages/Docker";
import { Domains } from "@/pages/Domains";
import { LoginPage } from "@/pages/Login";
import { NginxTemplateEdit } from "@/pages/NginxTemplateEdit";
import { TemplatesPage } from "@/pages/TemplatesPage";
import { ProxyHostDetail } from "@/pages/ProxyHostDetail";
import { ProxyHosts } from "@/pages/ProxyHosts";
import { Settings } from "@/pages/Settings";
import { SSLCertificates } from "@/pages/SSLCertificates";

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
              <Route path="/proxy-hosts/:id/:tab" element={scoped("proxy:list", <ProxyHostDetail />)} />
              <Route
                path="/nginx-templates/new"
                element={scoped("proxy:edit", <NginxTemplateEdit />)}
              />
              <Route
                path="/nginx-templates/:id"
                element={scoped("proxy:list", <NginxTemplateEdit />)}
              />
              <Route path="/ssl-certificates" element={scoped("ssl:cert:list", <SSLCertificates />)} />
              <Route path="/domains" element={scoped("proxy:list", <Domains />)} />
              <Route path="/access-lists" element={scoped("acl:list", <AccessLists />)} />
              <Route path="/cas" element={scoped("pki:ca:list:root", <CAs />)} />
              <Route path="/cas/:id" element={scoped("pki:ca:list:root", <CADetail />)} />
              <Route path="/certificates" element={scoped("pki:cert:list", <Certificates />)} />
              <Route
                path="/certificates/:id"
                element={scoped("pki:cert:list", <CertificateDetail />)}
              />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/templates/:tab" element={<TemplatesPage />} />
              <Route path="/audit" element={scoped("admin:audit", <AuditLog />)} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/admin/users" element={scoped("admin:users", <AdminUsers />)} />
              <Route path="/admin/groups" element={scoped("admin:groups", <AdminGroups />)} />
              <Route path="/nodes" element={scoped("nodes:list", <AdminNodes />)} />
              <Route path="/nodes/:id" element={scoped("nodes:list", <AdminNodeDetail />)} />
              <Route path="/nodes/:id/:tab" element={scoped("nodes:list", <AdminNodeDetail />)} />
              <Route path="/docker" element={scoped("docker:containers:list", <Docker />)} />
              <Route path="/docker/:tab" element={scoped("docker:containers:list", <Docker />)} />
              <Route
                path="/docker/containers/:nodeId/:containerId"
                element={scoped("docker:containers:view", <DockerContainerDetail />)}
              />
              <Route
                path="/docker/containers/:nodeId/:containerId/:tab"
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
