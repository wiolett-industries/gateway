import { AnimatePresence, motion } from "framer-motion";
import {
  LogOut,
  Lock,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  Pin,
  PinOff,
  Plus,
  Settings,
  Shield,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, getInitials } from "@/lib/utils";
import type { AIConversationSummary } from "@/services/ai-conversations";
import { api } from "@/services/api";
import { useAIStore } from "@/stores/ai";
import { useAuthStore } from "@/stores/auth";
import { useUIStore } from "@/stores/ui";

function formatConversationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    const diffMs = Math.max(0, now.getTime() - date.getTime());
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return "now";
    if (diffMinutes < 60) return `${diffMinutes} min ago`;
    return `${Math.floor(diffMinutes / 60)} h ago`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface AILiteSidebarProps {
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
  isResizing?: boolean;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}

export function AILiteSidebar({
  sidebarWidth = 260,
  onSidebarWidthChange,
  isResizing = false,
  onResizeStart,
  onResizeEnd,
}: AILiteSidebarProps) {
  const navigate = useNavigate();
  const { user, hasAnyScope, logout } = useAuthStore();
  const {
    sidebarOpen,
    toggleSidebar,
    pinnedAIConversationIds,
    togglePinnedAIConversation,
    showAILiteModeCTA,
    setAILiteMode,
  } = useUIStore();
  const {
    activeConversationId,
    recentConversations,
    isLoadingRecentConversations,
    clearMessages,
    deleteConversation,
    fetchRecentConversations,
    loadConversation,
  } = useAIStore();
  const canAccessAdministration = hasAnyScope("admin:audit", "admin:users", "admin:groups");
  const isExpanded = sidebarOpen;
  const pinnedConversationSet = new Set(pinnedAIConversationIds);
  const pinnedConversations = pinnedAIConversationIds
    .map((id) => recentConversations.find((conversation) => conversation.id === id))
    .filter((conversation): conversation is AIConversationSummary => Boolean(conversation));
  const chatConversations = recentConversations.filter(
    (conversation) => !pinnedConversationSet.has(conversation.id)
  );

  useEffect(() => {
    void fetchRecentConversations();
  }, [fetchRecentConversations]);

  const handleNewChat = () => {
    clearMessages();
    navigate("/");
  };

  const handleLoadConversation = async (conversationId: string) => {
    await loadConversation(conversationId);
    navigate("/");
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // Local auth state still needs to clear if the server session is already gone.
    } finally {
      logout();
      navigate("/login");
    }
  };

  const handleSwitchToDefaultMode = () => {
    setAILiteMode(false);
  };

  return (
    <aside
      style={{ width: isExpanded ? sidebarWidth : 48 }}
      className={cn(
        "relative flex h-full shrink-0 flex-col overflow-visible border-r border-sidebar-border bg-sidebar-background",
        !isResizing && "transition-[width] duration-200 ease-out"
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
            className="flex h-full flex-col items-center gap-2 py-3"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSidebar}>
                  <PanelLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Open sidebar</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleNewChat}>
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">New chat</TooltipContent>
            </Tooltip>

            <div className="flex-1" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={user?.avatarUrl ?? undefined} />
                    <AvatarFallback className="text-xs">
                      {getInitials(user?.name || user?.email || "?")}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" className="w-56">
                <AccountDropdownContent
                  canAccessAdministration={canAccessAdministration}
                  handleLogout={handleLogout}
                />
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
            {onSidebarWidthChange && (
              <ResizeHandle
                side="left"
                onResize={onSidebarWidthChange}
                onResizeStart={onResizeStart}
                onResizeEnd={onResizeEnd}
                minWidth={200}
                maxWidth={480}
              />
            )}

            <div
              className="flex items-center justify-between px-2"
              style={{ paddingTop: 10, paddingBottom: 10, paddingLeft: 10 }}
            >
              <span className="flex items-center gap-1.5 whitespace-nowrap pl-1 text-sm font-semibold text-foreground/80">
                <img src="/android-chrome-192x192.png" alt="Gateway" className="h-5 w-5" />
                Gateway AI
              </span>
              <div className="flex items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 md:h-7 md:w-7"
                      onClick={handleNewChat}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>New chat</TooltipContent>
                </Tooltip>
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
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col border-t border-border">
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto dashboard-scrollbar">
                {isLoadingRecentConversations ? (
                  <div className="px-3 py-3 text-xs text-muted-foreground">Loading...</div>
                ) : (
                  <>
                    {pinnedConversations.length > 0 && (
                      <nav className="space-y-0.5 px-2 py-2">
                        <p className="px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Pinned
                        </p>
                        {pinnedConversations.map((conversation) => (
                          <ConversationMenuItem
                            key={conversation.id}
                            conversation={conversation}
                            active={activeConversationId === conversation.id}
                            pinned
                            disableLayoutAnimation={isResizing}
                            onLoad={() => void handleLoadConversation(conversation.id)}
                            onTogglePin={() => togglePinnedAIConversation(conversation.id)}
                            onDelete={() => void deleteConversation(conversation.id)}
                          />
                        ))}
                      </nav>
                    )}

                    <nav className="space-y-0.5 px-2 py-2">
                      <p className="px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Chats
                      </p>
                      {recentConversations.length === 0 ? (
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 overflow-hidden whitespace-nowrap bg-sidebar-accent px-3 py-2 text-left text-sm font-medium text-sidebar-accent-foreground"
                          onClick={handleNewChat}
                        >
                          <MessageSquare className="h-4 w-4 shrink-0" />
                          <span className="truncate">New chat</span>
                        </button>
                      ) : (
                        chatConversations.map((conversation) => (
                          <ConversationMenuItem
                            key={conversation.id}
                            conversation={conversation}
                            active={activeConversationId === conversation.id}
                            pinned={false}
                            disableLayoutAnimation={isResizing}
                            onLoad={() => void handleLoadConversation(conversation.id)}
                            onTogglePin={() => togglePinnedAIConversation(conversation.id)}
                            onDelete={() => void deleteConversation(conversation.id)}
                          />
                        ))
                      )}
                    </nav>
                  </>
                )}
              </div>
            </div>

            <div className="border-t border-border">
              {showAILiteModeCTA && (
                <>
                  <div className="px-2 py-2">
                    <button
                      type="button"
                      onClick={handleSwitchToDefaultMode}
                      className="flex w-full items-center gap-2 bg-sidebar-accent px-3 py-2 text-left text-sm font-medium text-sidebar-accent-foreground/80 transition-colors hover:bg-muted hover:text-sidebar-accent-foreground"
                    >
                      <PanelLeft className="h-4 w-4 shrink-0" />
                      <span className="truncate">Switch to default mode</span>
                    </button>
                  </div>
                  <Separator />
                </>
              )}
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
                          {getInitials(user?.name || user?.email || "?")}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate text-sm font-medium">{user?.name || "User"}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="top" className="w-56">
                    <AccountDropdownContent
                      canAccessAdministration={canAccessAdministration}
                      handleLogout={handleLogout}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}

function ConversationMenuItem({
  conversation,
  active,
  pinned,
  disableLayoutAnimation,
  onLoad,
  onTogglePin,
  onDelete,
}: {
  conversation: AIConversationSummary;
  active: boolean;
  pinned: boolean;
  disableLayoutAnimation?: boolean;
  onLoad: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "group flex max-w-full items-center overflow-hidden whitespace-nowrap transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden px-3 py-2 pr-1 text-left text-sm"
        onClick={onLoad}
      >
        {conversation.status === "active" ? (
          <MessageSquare className="h-4 w-4 shrink-0" />
        ) : (
          <Lock className="h-4 w-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
      </button>
      <motion.div
        layout={!disableLayoutAnimation}
        className="mr-2 flex h-6 shrink-0 items-center justify-end overflow-hidden"
        transition={{ duration: 0.16, ease: "easeOut" }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {isHovered ? (
            <motion.div
              key="actions"
              layout={!disableLayoutAnimation}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12, ease: "easeOut" }}
              className="flex items-center gap-0.5"
            >
              <button
                type="button"
                aria-label={`${pinned ? "Unpin" : "Pin"} ${conversation.title}`}
                className="flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-sidebar-accent-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  onTogglePin();
                }}
              >
                {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                aria-label={`Delete ${conversation.title}`}
                className="flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-destructive"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ) : (
            <motion.span
              key="time"
              layout={!disableLayoutAnimation}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12, ease: "easeOut" }}
              className="text-xs text-muted-foreground"
            >
              {formatConversationDate(conversation.updatedAt)}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function AccountDropdownContent({
  canAccessAdministration,
  handleLogout,
}: {
  canAccessAdministration: boolean;
  handleLogout: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  return (
    <>
      <div className="px-2 py-1.5">
        <p className="text-sm font-medium">{user?.name || "User"}</p>
        <p className="text-xs text-muted-foreground">{user?.email}</p>
        <p className="mt-0.5 text-xs capitalize text-muted-foreground">{user?.groupName}</p>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => navigate("/settings")}>
        <Settings className="mr-2 h-4 w-4" />
        Settings
      </DropdownMenuItem>
      {canAccessAdministration && (
        <DropdownMenuItem onClick={() => navigate("/administration")}>
          <Shield className="mr-2 h-4 w-4" />
          Administration
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={handleLogout}>
        <LogOut className="mr-2 h-4 w-4" />
        Log out
      </DropdownMenuItem>
    </>
  );
}
