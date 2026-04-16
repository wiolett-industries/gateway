import { useAppStatusStore } from "@/stores/app-status";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import { useCertificatesStore } from "@/stores/certificates";
import { useNodesStore } from "@/stores/nodes";
import { useSSLStore } from "@/stores/ssl";
import { useUIStore } from "@/stores/ui";

export function resetTestStores() {
  localStorage.clear();
  sessionStorage.clear();

  useAuthStore.setState({
    user: null,
    sessionId: null,
    isAuthenticated: false,
    isLoading: true,
  });

  useAppStatusStore.setState({
    maintenanceActive: false,
    gatewayUpdatingActive: false,
    gatewayUpdatingTargetVersion: null,
    rateLimitedUntil: null,
  });

  useUIStore.setState({
    theme: "system",
    resolvedTheme: "light",
    sidebarOpen: true,
    sidebarCollapsed: false,
    isMobile: false,
    mobileMenuOpen: false,
    showUpdateNotifications: true,
    showSystemCertificates: false,
    aiBypassCreateApprovals: false,
    aiBypassEditApprovals: false,
    aiBypassDeleteApprovals: false,
    commandPaletteOpen: false,
    aiPanelOpen: false,
    recentPages: [],
    modal: { type: null },
  });

  useNodesStore.setState({
    nodes: [],
    isLoading: false,
    error: null,
    filters: { search: "", status: "all", type: "all" },
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
    refreshTick: 0,
  });

  useCAStore.setState({
    cas: [],
    selectedCA: null,
    isLoading: false,
    error: null,
  });

  useCertificatesStore.setState({
    certificates: [],
    selectedCertificate: null,
    isLoading: false,
    error: null,
    filters: { search: "", status: "active", type: "all", caId: "all" },
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
  });

  useSSLStore.setState({
    certificates: [],
    selectedCert: null,
    isLoading: false,
    error: null,
    filters: { search: "", type: "all", status: "active" },
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
  });
}
