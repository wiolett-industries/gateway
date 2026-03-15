import { AnimatePresence, motion } from "framer-motion";
import {
  Award,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeft,
  PanelLeftClose,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { CATree } from "@/components/ca/CATree";
import { CommandPalette } from "@/components/common/CommandPalette";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";

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

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Authorities", href: "/cas", icon: Shield },
  { name: "Certificates", href: "/certificates", icon: Award },
  { name: "Templates", href: "/templates", icon: FileText },
];

const adminNavigation = [
  { name: "Audit Log", href: "/audit", icon: ScrollText },
  { name: "Users", href: "/admin/users", icon: Users },
];

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
  const { user, hasRole, logout } = useAuthStore();
  const { cas, fetchCAs } = useCAStore();
  const { sidebarOpen, toggleSidebar } = useUIStore();

  useEffect(() => {
    fetchCAs();
  }, [fetchCAs]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      logout();
    }
    navigate("/login");
  };

  const isAdmin = hasRole("admin");
  const isExpanded = alwaysExpanded || sidebarOpen;

  const AccountDropdownContent = () => (
    <>
      <div className="px-2 py-1.5">
        <p className="text-sm font-medium">{user?.name || "User"}</p>
        <p className="text-xs text-muted-foreground">{user?.email}</p>
        <p className="text-xs text-muted-foreground capitalize mt-0.5">{user?.role}</p>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => { navigate("/settings"); onNavigate?.(); }}>
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

            {navigation.map((item) => (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-8 w-8", location.pathname === item.href && "bg-sidebar-accent")}
                    onClick={() => navigate(item.href)}
                  >
                    <item.icon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{item.name}</TooltipContent>
              </Tooltip>
            ))}

            <div className="flex-1" />

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
            <div className="flex items-center justify-between px-2" style={{ paddingTop: 10, paddingBottom: 10, paddingLeft: 10 }}>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground/80 whitespace-nowrap pl-1">
                <ShieldCheck className="h-4 w-4" />
                CA Manager
              </span>

              <div className="flex items-center gap-0.5">
                {alwaysExpanded ? (
                  <Button variant="ghost" size="icon" className="h-10 w-10" onClick={onNavigate}>
                    <X className="h-4 w-4" />
                  </Button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-10 w-10 md:h-7 md:w-7" onClick={toggleSidebar}>
                        <PanelLeftClose className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Close sidebar</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            <Separator />

            {/* Navigation */}
            <ScrollArea className="flex-1 overflow-hidden min-w-0">
              <nav className="space-y-0.5 p-2">
                {navigation.map((item) => {
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

              {/* CA Tree */}
              {cas && cas.length > 0 && (
                <>
                  <Separator className="my-1" />
                  <div className="px-2 pb-2">
                    <p className="px-3 py-1 text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wider whitespace-nowrap overflow-hidden">
                      Certificate Authorities
                    </p>
                    <CATree cas={cas} onSelect={(id) => { navigate(`/cas/${id}`); onNavigate?.(); }} />
                  </div>
                </>
              )}

              {/* Admin navigation */}
              {isAdmin && (
                <>
                  <Separator className="my-1" />
                  <nav className="space-y-0.5 p-2">
                    <p className="px-3 py-1 text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wider">
                      Administration
                    </p>
                    {adminNavigation.map((item) => {
                      const isActive = location.pathname === item.href;
                      return (
                        <Link
                          key={item.href}
                          to={item.href}
                          onClick={onNavigate}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 text-sm transition-colors",
                            isActive
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          )}
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          <span>{item.name}</span>
                        </Link>
                      );
                    })}
                  </nav>
                </>
              )}
            </ScrollArea>

            <Separator />

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

const SIDEBAR_WIDTH_KEY = "ca-manager-sidebar-width";
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
        setUser(user);
      } catch {
        logout();
        navigate("/login");
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [setUser, setLoading, logout, navigate]);

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
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

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
              <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => setMobileMenuOpen(true)}>
                <Menu className="h-5 w-5" />
              </Button>
              <span className="ml-2 flex items-center gap-1.5 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4" />
                CA Manager
              </span>
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
        <Toaster position="bottom-right" />
        <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
        <ConfirmDialog />
      </div>
    </TooltipProvider>
  );
}
