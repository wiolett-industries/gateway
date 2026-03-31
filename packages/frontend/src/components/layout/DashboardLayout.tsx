import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpCircle,
  Award,
  FileCode,
  FileText,
  Globe,
  Globe2,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  PanelLeft,
  PanelLeftClose,
  ScrollText,
  Search,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AIButton } from "@/components/ai/AIButton";
import { AISidePanel } from "@/components/ai/AISidePanel";
import { CommandPalette } from "@/components/common/CommandPalette";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { api } from "@/services/api";
import { useAIStore } from "@/stores/ai";
import { useAuthStore } from "@/stores/auth";
import { AI_SCOPE } from "@/types";
import { useUIStore } from "@/stores/ui";
import { useUpdateStore } from "@/stores/update";

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  scope?: string; // if set, item only shows when user has this scope
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navigationGroups: NavGroup[] = [
  {
    label: "Main",
    items: [{ name: "Dashboard", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "Reverse Proxy",
    items: [
      { name: "Proxy Hosts", href: "/proxy-hosts", icon: Globe, scope: "proxy:read" },
      { name: "Domains", href: "/domains", icon: Globe2, scope: "proxy:read" },
      { name: "Config Templates", href: "/nginx-templates", icon: FileCode, scope: "proxy:read" },
      { name: "SSL Certificates", href: "/ssl-certificates", icon: Lock, scope: "ssl:read" },
    ],
  },
  {
    label: "PKI",
    items: [
      { name: "Authorities", href: "/cas", icon: ShieldCheck, scope: "ca:read" },
      { name: "Certificates", href: "/certificates", icon: FileText, scope: "cert:read" },
      { name: "Templates", href: "/templates", icon: Award, scope: "template:read" },
    ],
  },
  {
    label: "Management",
    items: [
      { name: "Access Lists", href: "/access-lists", icon: ShieldAlert, scope: "access-list:read" },
      { name: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

const nginxNavItem: NavItem = { name: "Nginx", href: "/nginx", icon: Server, scope: "proxy:manage" };

const adminNavigation: NavItem[] = [
  { name: "Audit Log", href: "/audit", icon: ScrollText, scope: "admin:audit" },
  { name: "Users", href: "/admin/users", icon: Users, scope: "admin:users" },
  { name: "Groups", href: "/admin/groups", icon: ShieldCheck, scope: "admin:groups" },
];

// Flat list computed inside SidebarContent to include dynamic items

interface SidebarContentProps {
  onNavigate?: () => void;
  alwaysExpanded?: boolean;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
  isResizing?: boolean;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}

function SidebarContent({
  onNavigate,
  alwaysExpanded = false,
  sidebarWidth = 260,
  onSidebarWidthChange,
  isResizing = false,
  onResizeStart,
  onResizeEnd,
}: SidebarContentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, hasScope, logout } = useAuthStore();
  const { sidebarOpen, toggleSidebar, setCommandPaletteOpen: openPalette } = useUIStore();

  const [nginxAvailable, setNginxAvailable] = useState(false);
  const updateAvailable = useUpdateStore((s) => s.status?.updateAvailable ?? false);
  const showUpdateNotifications = useUIStore((s) => s.showUpdateNotifications);

  useEffect(() => {
    const check = () => api.checkNginxAvailable().then(setNginxAvailable);
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      logout();
    }
    navigate("/login");
  };

  const isExpanded = alwaysExpanded || sidebarOpen;

  // Build nav groups with conditional Nginx item and scope filtering
  const effectiveGroups = navigationGroups
    .map((group) => {
      let items = group.items;
      if (group.label === "Management" && nginxAvailable) {
        items = [nginxNavItem, ...items];
      }
      return {
        ...group,
        items: items.filter((item) => !item.scope || hasScope(item.scope)),
      };
    })
    .filter((group) => group.items.length > 0);

  const filteredAdminNav = adminNavigation.filter((item) => !item.scope || hasScope(item.scope));

  const allNavItems = [...effectiveGroups.flatMap((g) => g.items), ...filteredAdminNav];

  const AccountDropdownContent = () => (
    <>
      <div className="px-2 py-1.5">
        <p className="text-sm font-medium">{user?.name || "User"}</p>
        <p className="text-xs text-muted-foreground">{user?.email}</p>
        <p className="text-xs text-muted-foreground capitalize mt-0.5">{user?.groupName}</p>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => {
          navigate("/settings");
          onNavigate?.();
        }}
      >
        <Settings className="mr-2 h-4 w-4" />
        Settings
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={handleLogout}>
        <LogOut className="mr-2 h-4 w-4" />
        Log out
      </DropdownMenuItem>
    </>
  );

  return (
    <div
      style={{ width: alwaysExpanded ? "100%" : isExpanded ? sidebarWidth : 48 }}
      className={cn(
        "relative flex h-full shrink-0 flex-col bg-sidebar-background overflow-hidden",
        !alwaysExpanded && "border-r border-sidebar-border",
        !alwaysExpanded && !isResizing && "transition-[width] duration-200 ease-out"
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {!isExpanded ? (
          <motion.div
            key="collapsed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex h-full flex-col items-center py-3 gap-2"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSidebar}>
                  <PanelLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Open sidebar</TooltipContent>
            </Tooltip>

            {allNavItems.map((item) => (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-8 w-8",
                      location.pathname === item.href && "bg-sidebar-accent"
                    )}
                    onClick={() => navigate(item.href)}
                  >
                    <item.icon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{item.name}</TooltipContent>
              </Tooltip>
            ))}

            <div className="flex-1" />

            {hasScope(AI_SCOPE) && <AIButton iconOnly />}

            {updateAvailable && hasScope("admin:update") && showUpdateNotifications && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    style={{ backgroundColor: "rgb(234 179 8)", color: "#111" }}
                    onClick={() => navigate("/settings")}
                  >
                    <ArrowUpCircle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Update available</TooltipContent>
              </Tooltip>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={user?.avatarUrl ?? undefined} />
                    <AvatarFallback className="text-xs">
                      {getInitials(user?.name ?? null)}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" className="w-56">
                <AccountDropdownContent />
              </DropdownMenuContent>
            </DropdownMenu>
          </motion.div>
        ) : (
          <motion.div
            key="expanded"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex h-full w-full min-w-0 flex-col"
          >
            {!alwaysExpanded && onSidebarWidthChange && (
              <ResizeHandle
                side="left"
                onResize={onSidebarWidthChange}
                onResizeStart={onResizeStart}
                onResizeEnd={onResizeEnd}
                minWidth={200}
                maxWidth={480}
              />
            )}

            {/* Header */}
            <div
              className="flex items-center justify-between px-2"
              style={{ paddingTop: 10, paddingBottom: 10, paddingLeft: 10 }}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground/80 whitespace-nowrap pl-1">
                <img src="/android-chrome-192x192.png" alt="Gateway" className="h-5 w-5" />
                Gateway
              </span>

              <div className="flex items-center gap-0.5">
                {hasScope(AI_SCOPE) && <AIButton />}
                {alwaysExpanded ? (
                  <Button variant="ghost" size="icon" className="h-10 w-10" onClick={onNavigate}>
                    <X className="h-4 w-4" />
                  </Button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 md:h-7 md:w-7"
                        onClick={toggleSidebar}
                      >
                        <PanelLeftClose className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Close sidebar</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            {/* Search */}
            <div className="relative border-y border-border">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search..."
                readOnly
                onClick={() => openPalette(true)}
                style={{ height: 44 }}
                className="pl-9 text-sm border-0 focus-visible:ring-0 focus-visible:outline-none cursor-pointer"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs tracking-widest text-muted-foreground hidden md:inline">
                ⌘K
              </span>
            </div>

            {/* Navigation */}
            <ScrollArea className="flex-1 overflow-hidden min-w-0">
              {effectiveGroups.map((group, groupIndex) => (
                <div key={group.label}>
                  {groupIndex > 0 && <Separator />}
                  <nav className="space-y-0.5 px-2 py-2">
                    {groupIndex > 0 && (
                      <p className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {group.label}
                      </p>
                    )}
                    {group.items.map((item) => {
                      const isActive = location.pathname === item.href;
                      return (
                        <Link
                          key={item.href}
                          to={item.href}
                          onClick={onNavigate}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 text-sm transition-colors whitespace-nowrap overflow-hidden",
                            isActive
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          )}
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{item.name}</span>
                        </Link>
                      );
                    })}
                  </nav>
                </div>
              ))}

              {/* Admin navigation */}
              {filteredAdminNav.length > 0 && (
                <>
                  <Separator className="my-1" />
                  <nav className="space-y-0.5 p-2">
                    <p className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Administration
                    </p>
                    {filteredAdminNav.map((item) => {
                      const isActive = location.pathname === item.href;
                      return (
                        <Link
                          key={item.href}
                          to={item.href}
                          onClick={onNavigate}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 text-sm transition-colors whitespace-nowrap overflow-hidden",
                            isActive
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          )}
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{item.name}</span>
                        </Link>
                      );
                    })}
                  </nav>
                </>
              )}
            </ScrollArea>

            <Separator />

            {/* Update notification */}
            {updateAvailable && hasScope("admin:update") && showUpdateNotifications && (
              <>
                <div className="px-2 py-2">
                  <Link
                    to="/settings"
                    onClick={onNavigate}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors"
                    style={{ backgroundColor: "rgb(234 179 8)", color: "#111" }}
                  >
                    <ArrowUpCircle className="h-4 w-4 shrink-0" />
                    <span className="truncate">Update available</span>
                  </Link>
                </div>
                <Separator />
              </>
            )}

            {/* Account at bottom */}
            <div className="p-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="flex h-auto w-full items-center justify-start gap-2 px-1 py-1.5"
                  >
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarImage src={user?.avatarUrl ?? undefined} />
                      <AvatarFallback className="text-xs">
                        {getInitials(user?.name ?? null)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate text-sm font-medium">{user?.name || "User"}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="w-56">
                  <AccountDropdownContent />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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

  // Keyboard shortcuts
  useEffect(() => {
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
      // ⌘+number navigation — follows sidebar order
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
          "9": "/nginx",
          "0": "/access-lists",
        };
        if (e.key in routes) {
          e.preventDefault();
          navigate(routes[e.key]);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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
              <SidebarContent onNavigate={() => setMobileMenuOpen(false)} alwaysExpanded />
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
