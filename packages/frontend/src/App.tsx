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
            <Route element={<DashboardLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/proxy-hosts" element={scoped("proxy:read", <ProxyHosts />)} />
              <Route path="/proxy-hosts/:id" element={scoped("proxy:read", <ProxyHostDetail />)} />
              <Route path="/nginx-templates" element={scoped("proxy:read", <NginxTemplates />)} />
              <Route
                path="/nginx-templates/new"
                element={scoped("proxy:manage", <NginxTemplateEdit />)}
              />
              <Route
                path="/nginx-templates/:id"
                element={scoped("proxy:read", <NginxTemplateEdit />)}
              />
              <Route path="/ssl-certificates" element={scoped("ssl:read", <SSLCertificates />)} />
              <Route path="/domains" element={scoped("proxy:read", <Domains />)} />
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
              <Route path="/nodes" element={scoped("nodes:view", <AdminNodes />)} />
              <Route path="/nodes/:id" element={scoped("nodes:view", <AdminNodeDetail />)} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
