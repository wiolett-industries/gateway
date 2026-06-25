import { AnimatePresence, motion } from "framer-motion";
import { Expand, MessageSquare, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { confirm } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAIStore } from "@/stores/ai";
import { useUIStore } from "@/stores/ui";
import type { PageContext } from "@/types/ai";
import { type AIApprovalMode, AIComposer } from "./AIComposer";
import { AIMessage } from "./AIMessage";
import { QuestionBlock } from "./AIToolCallBlock";
import { confirmAILiteMode } from "./confirm-lite-mode";
import { QuickActionChips } from "./QuickActionChips";

function autoResizeTextarea(el: HTMLTextAreaElement, maxRows = 6) {
  const style = getComputedStyle(el);
  const lineHeight = parseInt(style.lineHeight, 10) || 20;
  const paddingTop = parseInt(style.paddingTop, 10) || 0;
  const paddingBottom = parseInt(style.paddingBottom, 10) || 0;
  const borderTop = parseInt(style.borderTopWidth, 10) || 0;
  const borderBottom = parseInt(style.borderBottomWidth, 10) || 0;
  const extra = paddingTop + paddingBottom + borderTop + borderBottom;
  const minHeight = lineHeight * (el.rows || 1) + extra;
  const maxHeight = lineHeight * maxRows + extra;
  el.style.height = "auto";
  const targetHeight = Math.max(minHeight, Math.min(el.scrollHeight, maxHeight));
  el.style.overflow = el.scrollHeight > maxHeight ? "auto" : "hidden";
  el.style.height = `${targetHeight}px`;
}

const PANEL_WIDTH_KEY = "gateway-ai-panel-width";
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 300;
const MAX_WIDTH = 560;
const BOTTOM_SCROLL_THRESHOLD = 48;

function readPanelWidth(): number {
  try {
    const stored = localStorage.getItem(PANEL_WIDTH_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) return parsed;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_WIDTH;
}

function usePageContext(): PageContext {
  const location = useLocation();
  const params = useParams();

  const route = location.pathname;
  let resourceType: string | undefined;
  let resourceId: string | undefined;

  if (params.id) {
    resourceId = params.id;
    if (route.startsWith("/cas/")) resourceType = "ca";
    else if (route.startsWith("/certificates/")) resourceType = "certificate";
    else if (route.startsWith("/proxy-hosts/")) resourceType = "proxy-host";
  }

  return { route, resourceType, resourceId };
}

const SLASH_COMMANDS = [
  { name: "new", description: "Start new conversation" },
  { name: "clear", description: "Clear conversation" },
  { name: "compact", description: "Compact saved context" },
  { name: "context", description: "Show token usage" },
];

function userMessagesAfterLastCompact(
  messages: ReturnType<typeof useAIStore.getState>["messages"]
): number {
  const lastCompactIndex = messages.reduce(
    (latest, message, index) => (message.compactMarker ? index : latest),
    -1
  );
  return messages.slice(lastCompactIndex + 1).filter((message) => message.role === "user").length;
}

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

async function confirmBypassEverythingMode(): Promise<boolean> {
  return confirm({
    title: "Enable AI bypass delete approvals?",
    description:
      "The AI assistant will create, modify, and delete resources without asking for your confirmation.",
    confirmLabel: "Enable",
    variant: "destructive",
  });
}

interface AIChatSurfaceProps {
  active?: boolean;
  onClose?: () => void;
  onEnterLiteMode?: () => void;
}

export function AIChatSurface({ active = true, onClose, onEnterLiteMode }: AIChatSurfaceProps) {
  const {
    messages,
    isStreaming,
    isConnected,
    isConnecting,
    connectionError,
    recentConversations,
    isLoadingRecentConversations,
    retryAfter,
    sendMessage,
    approveTool,
    rejectTool,
    answerQuestion,
    stopStreaming,
    handleSlashCommand,
    fetchRecentConversations,
    loadConversation,
    deleteConversation,
    connect,
  } = useAIStore();

  const [input, setInput] = useState("");
  const [slashResults, setSlashResults] = useState<typeof SLASH_COMMANDS>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const context = usePageContext();
  const {
    aiAlwaysAskApprovals,
    aiBypassCreateApprovals,
    aiBypassEditApprovals,
    aiBypassDeleteApprovals,
    setAIAlwaysAskApprovals,
    setAIBypassCreateApprovals,
    setAIBypassEditApprovals,
    setAIBypassDeleteApprovals,
  } = useUIStore();
  const canCompact = userMessagesAfterLastCompact(messages) > 3;
  const visibleSlashCommands = SLASH_COMMANDS.filter(
    (command) => command.name !== "compact" || canCompact
  );
  const approvalMode: AIApprovalMode = aiAlwaysAskApprovals
    ? "always-ask"
    : aiBypassDeleteApprovals
      ? "bypass-everything"
      : aiBypassCreateApprovals || aiBypassEditApprovals
        ? "bypass-non-destructive"
        : "normal";
  const approvalModeLabel =
    approvalMode === "always-ask"
      ? "AI mode: always ask"
      : approvalMode === "bypass-everything"
        ? "AI mode: bypass everything"
        : approvalMode === "bypass-non-destructive"
          ? "AI mode: bypass non-destructive"
          : "AI mode: normal";

  const setApprovalMode = useCallback(
    async (mode: AIApprovalMode) => {
      if (
        mode === "bypass-everything" &&
        !aiBypassDeleteApprovals &&
        !(await confirmBypassEverythingMode())
      ) {
        return;
      }
      setAIAlwaysAskApprovals(mode === "always-ask");
      setAIBypassCreateApprovals(mode === "bypass-non-destructive" || mode === "bypass-everything");
      setAIBypassEditApprovals(mode === "bypass-non-destructive" || mode === "bypass-everything");
      setAIBypassDeleteApprovals(mode === "bypass-everything");
    },
    [
      setAIAlwaysAskApprovals,
      aiBypassDeleteApprovals,
      setAIBypassCreateApprovals,
      setAIBypassDeleteApprovals,
      setAIBypassEditApprovals,
    ]
  );

  useEffect(() => {
    if (!active) return;
    void connect();
  }, [active, connect]);

  const updateStickToBottom = useCallback(() => {
    const node = scrollViewportRef.current;
    if (!node) {
      shouldStickToBottomRef.current = true;
      return;
    }
    shouldStickToBottomRef.current =
      node.scrollHeight - node.scrollTop - node.clientHeight < BOTTOM_SCROLL_THRESHOLD;
  }, []);

  const scrollSignature = messages
    .map((message) =>
      [
        message.id,
        message.content.length,
        message.isStreaming ? "streaming" : "idle",
        (message.toolCalls ?? [])
          .map((toolCall) => `${toolCall.id}:${toolCall.status}:${toolCall.error ?? ""}`)
          .join(","),
      ].join(":")
    )
    .join("|");

  useLayoutEffect(() => {
    if (!scrollSignature) return;
    const node = scrollViewportRef.current;
    if (!node || !shouldStickToBottomRef.current) return;
    node.scrollTop = node.scrollHeight;
    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollSignature]);

  useEffect(() => {
    const timer = setTimeout(() => textareaRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (messages.length === 0) void fetchRecentConversations();
  }, [fetchRecentConversations, messages.length]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    if (isStreaming) return;

    if (text.startsWith("/")) {
      const handled = await handleSlashCommand(text);
      if (handled) {
        setInput("");
        setSlashResults([]);
        return;
      }
    }

    setInput("");
    setSlashResults([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    sendMessage(text, context);
  }, [input, context, isStreaming, sendMessage, handleSlashCommand]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Slash command navigation
    if (slashResults.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashResults.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashResults.length) % slashResults.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        if (isStreaming) return;
        const cmd = slashResults[slashIndex];
        handleSlashCommand(`/${cmd.name}`);
        setInput("");
        setSlashResults([]);
        return;
      }
      if (e.key === "Escape") {
        setSlashResults([]);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming) handleSend();
    }
  };

  const handleQuickAction = (prompt: string) => {
    sendMessage(prompt, context);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    autoResizeTextarea(e.target);

    // Slash command detection
    if (val.startsWith("/") && !val.includes(" ")) {
      const query = val.slice(1).toLowerCase();
      const matches = visibleSlashCommands.filter((c) => c.name.startsWith(query));
      setSlashResults(matches);
      setSlashIndex(0);
    } else {
      setSlashResults([]);
    }
  };

  // Find next unanswered question and count progress
  const { activeQuestion, questionIndex, questionsTotal } = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && msg.toolCalls) {
        const allQuestions = msg.toolCalls.filter((tc) => tc.name === "ask_question");
        if (allQuestions.length === 0) continue;
        const nextUnanswered = allQuestions.find(
          (tc) => tc.status === "awaiting_approval" || tc.status === "running"
        );
        if (nextUnanswered) {
          const answeredCount = allQuestions.filter(
            (tc) => tc.status === "completed" || tc.status === "failed" || tc.status === "rejected"
          ).length;
          return {
            activeQuestion: nextUnanswered,
            questionIndex: answeredCount + 1,
            questionsTotal: allQuestions.length,
          };
        }
      }
    }
    return { activeQuestion: null, questionIndex: 0, questionsTotal: 0 };
  })();

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-[49px] shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-sm font-semibold">AI Assistant</span>
        <div className="flex items-center gap-1">
          {onEnterLiteMode && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onEnterLiteMode}
              title="Full screen"
              aria-label="Full screen"
            >
              <Expand className="h-4 w-4" />
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      {messages.length === 0 ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-3">
          <Sparkles className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground text-center">
            Ask me anything about your infrastructure
          </p>
          <QuickActionChips onSelect={handleQuickAction} />
          {(isLoadingRecentConversations || recentConversations.length > 0) && (
            <div className="mt-4 w-full max-w-[340px] border border-border">
              <div className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Recent
              </div>
              {isLoadingRecentConversations ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">Loading...</div>
              ) : (
                recentConversations.map((conversation) => (
                  <div
                    key={conversation.id}
                    className="group flex items-center border-b border-border last:border-b-0 hover:bg-muted/50 focus-within:bg-muted/50"
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
                      onClick={() => void loadConversation(conversation.id)}
                    >
                      <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-foreground">
                          {conversation.title}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {conversation.messageCount} messages
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatConversationDate(conversation.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${conversation.title}`}
                      className="mr-0 flex h-6 w-0 shrink-0 translate-x-1 items-center justify-center overflow-hidden text-muted-foreground opacity-0 transition-[width,margin,opacity,transform,color] duration-150 hover:text-destructive group-hover:mr-2 group-hover:w-6 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:mr-2 group-focus-within:w-6 group-focus-within:translate-x-0 group-focus-within:opacity-100"
                      onClick={() => void deleteConversation(conversation.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      ) : (
        <div
          ref={scrollViewportRef}
          role="log"
          aria-label="AI messages"
          className="flex-1 min-h-0 overflow-y-auto dashboard-scrollbar px-3 pt-3"
          onScroll={updateStickToBottom}
        >
          <div className="space-y-3">
            {messages.map((msg) => (
              <AIMessage
                key={msg.id}
                message={msg}
                onApprove={approveTool}
                onReject={rejectTool}
                onAnswer={answerQuestion}
              />
            ))}
            <div className="pb-4" />
          </div>
        </div>
      )}

      {/* Rate limit indicator */}
      {retryAfter !== null && (
        <div className="text-xs text-muted-foreground text-center py-1.5 border-t border-border">
          Rate limited — retrying in {retryAfter}s...
        </div>
      )}

      {/* Connection status */}
      {!isConnected && (isConnecting || connectionError) && (
        <div className="text-xs text-muted-foreground text-center py-1.5 border-t border-border">
          {isConnecting ? "Connecting..." : connectionError}
        </div>
      )}

      {/* Bottom area: question UI or input */}
      {activeQuestion ? (
        <div className="shrink-0 border-t border-border">
          {questionsTotal > 1 && (
            <div className="px-3 py-1 text-[11px] text-muted-foreground bg-muted/50 border-b border-border">
              Question {questionIndex} of {questionsTotal}
            </div>
          )}
          <QuestionBlock toolCall={activeQuestion} onAnswer={answerQuestion} />
        </div>
      ) : (
        <div className="relative shrink-0">
          <AIComposer
            textareaRef={textareaRef}
            input={input}
            onInputChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onSend={() => void handleSend()}
            onStop={stopStreaming}
            onSlashCommandSelect={(command) => {
              void handleSlashCommand(`/${command.name}`);
              setInput("");
              setSlashResults([]);
            }}
            slashResults={slashResults}
            slashIndex={slashIndex}
            messages={messages}
            isStreaming={isStreaming}
            isConnected={isConnected}
            retryAfter={retryAfter}
            approvalMode={approvalMode}
            approvalModeLabel={approvalModeLabel}
            setApprovalMode={setApprovalMode}
            surfaceClassName="border-x-0 border-b-0 focus-within:ring-0"
          />
        </div>
      )}
    </div>
  );
}

interface AISidePanelProps {
  isMobile?: boolean;
}

export function AISidePanel({ isMobile = false }: AISidePanelProps) {
  const { aiPanelOpen, setAIPanelOpen, setAILiteMode } = useUIStore();
  const navigate = useNavigate();
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);
  const [isResizing, setIsResizing] = useState(false);

  const handleClose = () => setAIPanelOpen(false);
  const handleEnterLiteMode = async () => {
    const confirmed = await confirmAILiteMode();
    if (!confirmed) return;
    setAILiteMode(true);
    setAIPanelOpen(false);
    navigate("/");
  };

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    setPanelWidth((w) => {
      try {
        localStorage.setItem(PANEL_WIDTH_KEY, String(w));
      } catch {
        /* ignore */
      }
      return w;
    });
  }, []);

  if (isMobile) {
    return (
      <Sheet open={aiPanelOpen} onOpenChange={setAIPanelOpen}>
        <SheetContent side="right" className="w-full p-0" hideCloseButton>
          <SheetHeader className="sr-only">
            <SheetTitle>AI Assistant</SheetTitle>
          </SheetHeader>
          <AIChatSurface active={aiPanelOpen} onClose={handleClose} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {aiPanelOpen && (
        <motion.div
          key="ai-panel"
          initial={{ width: 0 }}
          animate={{ width: panelWidth }}
          exit={{ width: 0 }}
          transition={isResizing ? { duration: 0 } : { duration: 0.15, ease: "easeOut" }}
          className="relative h-full shrink-0 overflow-visible"
        >
          <ResizeHandle
            side="right"
            onResize={setPanelWidth}
            onResizeStart={() => setIsResizing(true)}
            onResizeEnd={handleResizeEnd}
            minWidth={MIN_WIDTH}
            maxWidth={MAX_WIDTH}
          />
          <div className="h-full overflow-hidden border-l border-border">
            {/* Inner content pinned to panelWidth so it never reflows */}
            <div style={{ width: panelWidth }} className="h-full flex flex-col bg-background">
              <AIChatSurface onClose={handleClose} onEnterLiteMode={handleEnterLiteMode} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
