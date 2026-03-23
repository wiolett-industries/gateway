import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { LoginPage } from "@/pages/Login";
import { AuthCallback } from "@/pages/AuthCallback";
import { Dashboard } from "@/pages/Dashboard";
import { CAs } from "@/pages/CAs";
import { CADetail } from "@/pages/CADetail";
import { Certificates } from "@/pages/Certificates";
import { CertificateDetail } from "@/pages/CertificateDetail";
import { Templates } from "@/pages/Templates";
import { AuditLog } from "@/pages/AuditLog";
import { Settings } from "@/pages/Settings";
import { ProxyHosts } from "@/pages/ProxyHosts";
import { ProxyHostDetail } from "@/pages/ProxyHostDetail";
import { SSLCertificates } from "@/pages/SSLCertificates";
import { SSLCertificateNew } from "@/pages/SSLCertificateNew";
import { AccessLists } from "@/pages/AccessLists";
import { AdminUsers } from "@/pages/AdminUsers";

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
              <Route path="/ssl-certificates" element={<SSLCertificates />} />
              <Route path="/ssl-certificates/new" element={<SSLCertificateNew />} />
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
