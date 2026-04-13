import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpCircle,
  Award,
  Bell,
  Box,
  FileText,
  Globe,
  Globe2,
  LayoutDashboard,
  Lock,
  LogOut,
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
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AIButton } from "@/components/ai/AIButton";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useDockerStore } from "@/stores/docker";
import { usePinnedContainersStore } from "@/stores/pinned-containers";
import { usePinnedNodesStore } from "@/stores/pinned-nodes";
import { usePinnedProxiesStore } from "@/stores/pinned-proxies";
import { useUIStore } from "@/stores/ui";
import { useUpdateStore } from "@/stores/update";
import type { Node, ProxyHost } from "@/types";
import { AI_SCOPE } from "@/types";

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
  scope?: string;
  matchTabs?: boolean;
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
      { name: "Proxy Hosts", href: "/proxy-hosts", icon: Globe, scope: "proxy:list" },
      { name: "Domains", href: "/domains", icon: Globe2, scope: "proxy:list" },
      { name: "SSL Certificates", href: "/ssl-certificates", icon: Lock, scope: "ssl:cert:list" },
    ],
  },
  {
    label: "PKI",
    items: [
      { name: "Authorities", href: "/cas", icon: ShieldCheck, scope: "pki:ca:list:root" },
      { name: "Certificates", href: "/certificates", icon: FileText, scope: "pki:cert:list" },
    ],
  },
  {
    label: "Management",
    items: [
      {
        name: "Docker",
        href: "/docker",
        icon: Box,
        scope: "docker:containers:list",
        matchTabs: true,
      },
      { name: "Templates", href: "/templates", icon: Award, matchTabs: true },
      { name: "Nodes", href: "/nodes", icon: Server, scope: "nodes:list" },
      { name: "Access Lists", href: "/access-lists", icon: ShieldAlert, scope: "acl:list" },
      { name: "Notifications", href: "/notifications", icon: Bell, scope: "notifications:view", matchTabs: true },
      { name: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

const adminNavigation: NavItem[] = [
  { name: "Audit Log", href: "/audit", icon: ScrollText, scope: "admin:audit" },
  { name: "Users", href: "/admin/users", icon: Users, scope: "admin:users" },
  { name: "Groups", href: "/admin/groups", icon: ShieldCheck, scope: "admin:groups" },
];

export interface SidebarContentProps {
  onNavigate?: () => void;
  alwaysExpanded?: boolean;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
  isResizing?: boolean;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  hasNginxNodes?: boolean;
}

export function SidebarContent({
  onNavigate,
  alwaysExpanded = false,
  sidebarWidth = 260,
  onSidebarWidthChange,
  isResizing = false,
  onResizeStart,
  onResizeEnd,
  hasNginxNodes = true,
}: SidebarContentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, hasScope, logout } = useAuthStore();
  const { sidebarOpen, toggleSidebar, setCommandPaletteOpen: openPalette } = useUIStore();

  const updateAvailable = useUpdateStore((s) => s.status?.updateAvailable ?? false);
  const showUpdateNotifications = useUIStore((s) => s.showUpdateNotifications);
  const sidebarPinnedIds = usePinnedNodesStore((s) => s.sidebarNodeIds);
  const pinnedRefreshTick = usePinnedNodesStore((s) => s.refreshTick);
  const [pinnedNodes, setPinnedNodes] = useState<Node[]>([]);

  const sidebarPinnedProxyIds = usePinnedProxiesStore((s) => s.sidebarProxyIds);
  const pinnedProxyRefreshTick = usePinnedProxiesStore((s) => s.refreshTick);
  const [pinnedProxies, setPinnedProxies] = useState<ProxyHost[]>([]);

  const sidebarPinnedContainerIds = usePinnedContainersStore((s) => s.sidebarContainerIds);
  const pinnedContainerMeta = usePinnedContainersStore((s) => s.containerMeta);

  useEffect(() => {
    if (sidebarPinnedIds.length === 0) {
      setPinnedNodes([]);
      return;
    }
    api
      .listNodes({ limit: 100 })
      .then((r) => {
        const allIds = r.data.map((n) => n.id);
        setPinnedNodes(r.data.filter((n) => sidebarPinnedIds.includes(n.id)));
        usePinnedNodesStore.getState().removeOrphans(allIds);
      })
      .catch(() => {});
  }, [sidebarPinnedIds, location.pathname, pinnedRefreshTick]);

  useEffect(() => {
    if (sidebarPinnedProxyIds.length === 0) {
      setPinnedProxies([]);
      return;
    }
    api
      .listProxyHosts({ limit: 100 })
      .then((r) => {
        const allIds = (r.data ?? []).map((p) => p.id);
        setPinnedProxies((r.data ?? []).filter((p) => sidebarPinnedProxyIds.includes(p.id)));
        usePinnedProxiesStore.getState().removeOrphans(allIds);
      })
      .catch(() => {});
  }, [sidebarPinnedProxyIds, location.pathname, pinnedProxyRefreshTick]);

  // Clean up orphaned pinned containers on mount
  useEffect(() => {
    if (sidebarPinnedContainerIds.length === 0) return;
    const meta = usePinnedContainersStore.getState().containerMeta;
    const entries = sidebarPinnedContainerIds
      .map((cid) => ({ cid, meta: meta[cid] }))
      .filter((e) => e.meta);
    const nodeIds = [...new Set(entries.map((e) => e.meta!.nodeId))];
    if (nodeIds.length === 0) return;

    Promise.all(nodeIds.map((nid) => api.listDockerContainers(nid).catch(() => [])))
      .then((results) => {
        const validIds = results.flat().map((c) => c.id);
        usePinnedContainersStore.getState().removeOrphans(validIds);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const dockerNodes = useDockerStore((s) => s.dockerNodes);
  const hasDockerNodes = dockerNodes.length > 0;

  // Build nav groups with scope + context filtering
  const effectiveGroups = navigationGroups
    .map((group) => {
      // Hide entire Reverse Proxy group when no nginx nodes
      if (group.label === "Reverse Proxy" && !hasNginxNodes) return { ...group, items: [] };
      return {
        ...group,
        items: group.items.filter((item) => {
          if (item.scope && !hasScope(item.scope)) return false;
          // Hide Docker when no docker nodes exist
          if (item.href === "/docker" && !hasDockerNodes) return false;
          // Templates: need at least one template scope
          if (item.href === "/templates" && !hasScope("pki:templates:list") && !hasScope("docker:templates:list")) return false;
          return true;
        }),
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

                  {/* Pinned items — right after Dashboard */}
                  {groupIndex === 1 &&
                    (pinnedNodes.length > 0 ||
                      pinnedProxies.length > 0 ||
                      sidebarPinnedContainerIds.length > 0) && (
                      <>
                        <nav className="space-y-0.5 px-2 py-2">
                          <p className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Pinned Items
                          </p>
                          {pinnedProxies.map((proxy) => {
                            const isActive =
                              location.pathname === `/proxy-hosts/${proxy.id}` ||
                              location.pathname.startsWith(`/proxy-hosts/${proxy.id}/`);
                            const hs = (proxy as any).effectiveHealthStatus ?? proxy.healthStatus;
                            return (
                              <Link
                                key={proxy.id}
                                to={`/proxy-hosts/${proxy.id}`}
                                onClick={onNavigate}
                                className={cn(
                                  "flex items-center gap-3 px-3 py-2 text-sm transition-colors whitespace-nowrap overflow-hidden",
                                  isActive
                                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                )}
                              >
                                <Globe className="h-4 w-4 shrink-0" />
                                <span className="truncate">{proxy.domainNames[0]}</span>
                                <span
                                  className={cn(
                                    "ml-auto h-2 w-2 rounded-full shrink-0",
                                    hs === "online"
                                      ? "bg-emerald-500"
                                      : hs === "offline" || hs === "degraded"
                                        ? "bg-red-400"
                                        : "bg-muted-foreground/40"
                                  )}
                                />
                              </Link>
                            );
                          })}
                          {pinnedNodes.map((node) => {
                            const isActive =
                              location.pathname === `/nodes/${node.id}` ||
                              location.pathname.startsWith(`/nodes/${node.id}/`);
                            return (
                              <Link
                                key={node.id}
                                to={`/nodes/${node.id}`}
                                onClick={onNavigate}
                                className={cn(
                                  "flex items-center gap-3 px-3 py-2 text-sm transition-colors whitespace-nowrap overflow-hidden",
                                  isActive
                                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                )}
                              >
                                <Server className="h-4 w-4 shrink-0" />
                                <span className="truncate">
                                  {node.displayName || node.hostname}
                                </span>
                                <span
                                  className={cn(
                                    "ml-auto h-2 w-2 rounded-full shrink-0",
                                    node.status === "online"
                                      ? "bg-emerald-500"
                                      : node.status === "error"
                                        ? "bg-red-400"
                                        : "bg-muted-foreground/40"
                                  )}
                                />
                              </Link>
                            );
                          })}
                          {sidebarPinnedContainerIds.map((cid) => {
                            const meta = pinnedContainerMeta[cid];
                            if (!meta) return null;
                            const containerPath = `/docker/containers/${meta.nodeId}/${cid}`;
                            const isActive =
                              location.pathname === containerPath ||
                              location.pathname.startsWith(containerPath + "/");
                            return (
                              <Link
                                key={cid}
                                to={`/docker/containers/${meta.nodeId}/${cid}`}
                                onClick={onNavigate}
                                className={cn(
                                  "flex items-center gap-3 px-3 py-2 text-sm transition-colors whitespace-nowrap overflow-hidden",
                                  isActive
                                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                )}
                              >
                                <Box className="h-4 w-4 shrink-0" />
                                <span className="truncate">{meta.name}</span>
                                <span
                                  className={cn(
                                    "ml-auto h-2 w-2 rounded-full shrink-0",
                                    meta.state === "running"
                                      ? "bg-emerald-500"
                                      : meta.state === "exited" || meta.state === "dead"
                                        ? "bg-red-400"
                                        : meta.state === "stopping" ||
                                            meta.state === "restarting" ||
                                            meta.state === "recreating" ||
                                            meta.state === "killing" ||
                                            meta.state === "updating"
                                          ? "bg-amber-400 animate-pulse"
                                          : "bg-muted-foreground/40"
                                  )}
                                />
                              </Link>
                            );
                          })}
                        </nav>
                        <Separator />
                      </>
                    )}
                  <nav className="space-y-0.5 px-2 py-2">
                    {groupIndex > 0 && (
                      <p className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {group.label}
                      </p>
                    )}
                    {group.items.map((item) => {
                      const isActive =
                        location.pathname === item.href ||
                        (item.matchTabs &&
                          location.pathname.startsWith(item.href + "/") &&
                          !location.pathname.slice(item.href.length + 1).includes("/"));
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
