import { Menu } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AIButton } from "@/components/ai/AIButton";
import { AISidePanel } from "@/components/ai/AISidePanel";
import { CommandPalette } from "@/components/common/CommandPalette";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/services/api";
import { useAIStore } from "@/stores/ai";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import { useDockerStore } from "@/stores/docker";
import { useUIStore } from "@/stores/ui";
import { useUpdateStore } from "@/stores/update";
import { AI_SCOPE, isNodeIncompatible } from "@/types";
import { SidebarContent } from "./SidebarContent";

const SIDEBAR_WIDTH_KEY = "gateway-sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 260;

function readSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (parsed >= 200 && parsed <= 480) return parsed;
    }
  } catch {
    // ignore
  }
  return DEFAULT_SIDEBAR_WIDTH;
}

export function DashboardLayout() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, setUser, setLoading, logout } = useAuthStore();
  const {
    isMobile,
    setIsMobile,
    mobileMenuOpen,
    setMobileMenuOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
  } = useUIStore();

  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [hasNginxNodes, setHasNginxNodes] = useState(true); // default true to avoid flash

  const handleSidebarResize = useCallback((width: number) => {
    setSidebarWidth(width);
  }, []);

  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
  }, []);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    setSidebarWidth((w) => {
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
      } catch {
        // ignore
      }
      return w;
    });
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await api.getCurrentUser();
        if (user.isBlocked) {
          setUser(user);
          setLoading(false);
          navigate("/blocked");
          return;
        }
        setUser(user);
        // Prefetch data for all pages in background
        const hasAdminScopes = user.scopes?.some((s: string) => s.startsWith("admin:")) ?? false;
        api.prefetchAll(hasAdminScopes);
        // Preload node types for sidebar visibility + Docker command palette
        if (
          user.scopes?.some(
            (s: string) =>
              s.startsWith("nodes:") || s.startsWith("docker:") || s.startsWith("proxy:")
          )
        ) {
          api
            .listNodes({ limit: 100 })
            .then((r) => {
              const dockerNds = r.data.filter((n) => n.type === "docker" && !isNodeIncompatible(n));
              const nginxNds = r.data.filter((n) => n.type === "nginx" && !isNodeIncompatible(n));
              useDockerStore.getState().setDockerNodes(dockerNds);
              if (dockerNds.length > 0) useDockerStore.getState().fetchContainers();
              setHasNginxNodes(nginxNds.length > 0);
            })
            .catch(() => {});
        }
        // Fetch update status into global store
        if (user.scopes?.includes("admin:update")) useUpdateStore.getState().fetchStatus();
        // Check AI availability
        if (user.scopes?.includes(AI_SCOPE)) {
          api
            .getAIStatus()
            .then((s) => useAIStore.getState().setEnabled(s.enabled))
            .catch(() => {});
        }
      } catch {
        logout();
        navigate("/login");
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logout, navigate, setLoading, setUser]);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, [setIsMobile]);

  // Track recent pages for command palette
  const location = useLocation();
  useEffect(() => {
    const path = location.pathname;
    if (path === "/" || path === "/login" || path === "/callback" || path === "/blocked") return;

    // Build a human-readable label, resolving entity IDs to names
    const label = (() => {
      // Node detail: /nodes/:id or /nodes/:id/:tab
      const nodeMatch = path.match(/^\/nodes\/([0-9a-f-]{36})/);
      if (nodeMatch) {
        api
          .getNode(nodeMatch[1])
          .then((n) => {
            const resolvedName = n.displayName || n.hostname;
            const tab2 = path.split("/")[3];
            const resolvedLabel = tab2
              ? `Node: ${resolvedName} / ${tab2.charAt(0).toUpperCase() + tab2.slice(1).replace(/-/g, " ")}`
              : `Node: ${resolvedName}`;
            useUIStore.getState().addRecentPage(path, resolvedLabel);
          })
          .catch(() => {});
        const name = nodeMatch[1].slice(0, 8);
        const tab = path.split("/")[3];
        return tab
          ? `Node: ${name} / ${tab.charAt(0).toUpperCase() + tab.slice(1).replace(/-/g, " ")}`
          : `Node: ${name}`;
      }
      // Container detail: /docker/containers/:nodeId/:containerId
      const containerMatch = path.match(/^\/docker\/containers\/[^/]+\/([0-9a-f]+)/);
      if (containerMatch) {
        const c = useDockerStore.getState().containers.find((ct) => ct.id === containerMatch[1]);
        const name = c?.name || containerMatch[1].slice(0, 12);
        const tab = path.split("/")[5];
        return tab
          ? `Container: ${name} / ${tab.charAt(0).toUpperCase() + tab.slice(1)}`
          : `Container: ${name}`;
      }
      // Proxy host detail: /proxy-hosts/:id
      const proxyMatch = path.match(/^\/proxy-hosts\/([0-9a-f-]{36})/);
      if (proxyMatch) {
        api
          .getProxyHost(proxyMatch[1])
          .then((p) => {
            const resolvedName = p.domainNames?.[0] || proxyMatch![1].slice(0, 8);
            const tab2 = path.split("/")[3];
            const resolvedLabel = tab2
              ? `Proxy: ${resolvedName} / ${tab2.charAt(0).toUpperCase() + tab2.slice(1)}`
              : `Proxy: ${resolvedName}`;
            useUIStore.getState().addRecentPage(path, resolvedLabel);
          })
          .catch(() => {});
        const name = proxyMatch[1].slice(0, 8);
        const tab = path.split("/")[3];
        return tab
          ? `Proxy: ${name} / ${tab.charAt(0).toUpperCase() + tab.slice(1)}`
          : `Proxy: ${name}`;
      }
      // CA detail: /cas/:id
      const caMatch = path.match(/^\/cas\/([0-9a-f-]{36})/);
      if (caMatch) {
        const ca = useCAStore.getState().cas?.find((c) => c.id === caMatch[1]);
        return ca ? `CA: ${ca.commonName}` : `CA: ${caMatch[1].slice(0, 8)}`;
      }
      // Generic: prettify path segments
      const segments = path.split("/").filter(Boolean);
      return segments
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" / ")
        .replace(/-/g, " ");
    })();

    useUIStore.getState().addRecentPage(path, label);
  }, [location.pathname]);

  // Keyboard shortcuts
  useEffect(() => {
    // Double-Shift detection
    let lastShiftUp = 0;
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const now = Date.now();
        if (now - lastShiftUp < 400) {
          lastShiftUp = 0;
          setCommandPaletteOpen(true);
        } else {
          lastShiftUp = now;
        }
      }
    };
    window.addEventListener("keyup", handleKeyUp);

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
      if (mod && e.key === "j") {
        e.preventDefault();
        useUIStore.getState().toggleSidebar();
      }
      if (mod && e.key === "i") {
        e.preventDefault();
        const { hasScope: checkScope } = useAuthStore.getState();
        const aiEnabled = useAIStore.getState().isEnabled;
        if (checkScope(AI_SCOPE) && aiEnabled !== false) {
          useUIStore.getState().toggleAIPanel();
        }
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        navigate("/settings");
      }
      // Ctrl+H = new proxy host, Ctrl+S = new SSL cert, Ctrl+R = new root CA
      if (e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.key) {
          case "h":
            e.preventDefault();
            navigate("/proxy-hosts/new");
            break;
          case "s":
            e.preventDefault();
            navigate("/ssl-certificates");
            useUIStore.getState().openModal("createSSLCert");
            break;
          case "r":
            e.preventDefault();
            navigate("/cas");
            useUIStore.getState().openModal("createCA");
            break;
        }
      }
      // Cmd+number navigation
      if (mod && !e.altKey && !e.shiftKey) {
        const routes: Record<string, string> = {
          "1": "/",
          "2": "/proxy-hosts",
          "3": "/domains",
          "4": "/nginx-templates",
          "5": "/ssl-certificates",
          "6": "/cas",
          "7": "/certificates",
          "8": "/templates",
          "9": "/nodes",
          "0": "/access-lists",
        };
        if (e.key in routes) {
          e.preventDefault();
          navigate(routes[e.key]);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [commandPaletteOpen, setCommandPaletteOpen, navigate]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (isMobile) {
    return (
      <TooltipProvider>
        <div className="flex h-screen flex-col bg-background">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-2">
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <span className="ml-2 flex items-center gap-1.5 text-sm font-semibold">
                <img src="/android-chrome-192x192.png" alt="Gateway" className="h-5 w-5" />
                Gateway
              </span>
              {useAuthStore.getState().hasScope(AI_SCOPE) && <AIButton />}
            </div>
          </header>

          <div className="flex-1 overflow-hidden">
            <Outlet />
          </div>

          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetContent side="left" className="w-full p-0" hideCloseButton>
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <SidebarContent
                onNavigate={() => setMobileMenuOpen(false)}
                alwaysExpanded
                hasNginxNodes={hasNginxNodes}
              />
            </SheetContent>
          </Sheet>

          <AISidePanel isMobile />
          <Toaster position="bottom-center" />
          <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background dashboard-scrollbar">
        <SidebarContent
          sidebarWidth={sidebarWidth}
          onSidebarWidthChange={handleSidebarResize}
          isResizing={isResizing}
          onResizeStart={handleResizeStart}
          onResizeEnd={handleResizeEnd}
          hasNginxNodes={hasNginxNodes}
        />
        <main className="h-full flex-1 overflow-hidden">
          <Outlet />
        </main>
        <AISidePanel />
        <Toaster position="bottom-right" />
        <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
        <ConfirmDialog />
      </div>
    </TooltipProvider>
  );
}
