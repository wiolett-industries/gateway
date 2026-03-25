import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { AccessLists } from "@/pages/AccessLists";
import { AdminUsers } from "@/pages/AdminUsers";
import { AuditLog } from "@/pages/AuditLog";
import { AuthCallback } from "@/pages/AuthCallback";
import { CADetail } from "@/pages/CADetail";
import { CAs } from "@/pages/CAs";
import { CertificateDetail } from "@/pages/CertificateDetail";
import { Certificates } from "@/pages/Certificates";
import { Dashboard } from "@/pages/Dashboard";
import { LoginPage } from "@/pages/Login";
import { NginxManagement } from "@/pages/NginxManagement";
import { NginxTemplateEdit } from "@/pages/NginxTemplateEdit";
import { NginxTemplates } from "@/pages/NginxTemplates";
import { ProxyHostDetail } from "@/pages/ProxyHostDetail";
import { ProxyHosts } from "@/pages/ProxyHosts";
import { Settings } from "@/pages/Settings";
import { SSLCertificateNew } from "@/pages/SSLCertificateNew";
import { SSLCertificates } from "@/pages/SSLCertificates";
import { Templates } from "@/pages/Templates";

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/callback" element={<AuthCallback />} />
            <Route element={<DashboardLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/proxy-hosts" element={<ProxyHosts />} />
              <Route path="/proxy-hosts/new" element={<ProxyHostDetail />} />
              <Route path="/proxy-hosts/:id" element={<ProxyHostDetail />} />
              <Route path="/nginx-templates" element={<NginxTemplates />} />
              <Route path="/nginx-templates/new" element={<NginxTemplateEdit />} />
              <Route path="/nginx-templates/:id" element={<NginxTemplateEdit />} />
              <Route path="/ssl-certificates" element={<SSLCertificates />} />
              <Route path="/ssl-certificates/new" element={<SSLCertificateNew />} />
              <Route path="/nginx" element={<NginxManagement />} />
              <Route path="/access-lists" element={<AccessLists />} />
              <Route path="/cas" element={<CAs />} />
              <Route path="/cas/:id" element={<CADetail />} />
              <Route path="/certificates" element={<Certificates />} />
              <Route path="/certificates/:id" element={<CertificateDetail />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/admin/users" element={<AdminUsers />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
