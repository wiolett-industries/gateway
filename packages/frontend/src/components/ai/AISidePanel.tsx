import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Send, Sparkles, Square, X } from "lucide-react";
import { useLocation, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAIStore } from "@/stores/ai";
import { useUIStore } from "@/stores/ui";
import { AIMessage } from "./AIMessage";
import { QuestionBlock } from "./AIToolCallBlock";
import { QuickActionChips } from "./QuickActionChips";
import type { PageContext } from "@/types/ai";

function autoResizeTextarea(el: HTMLTextAreaElement, maxRows = 6) {
  const style = getComputedStyle(el);
  const lineHeight = parseInt(style.lineHeight) || 20;
  const paddingTop = parseInt(style.paddingTop) || 0;
  const paddingBottom = parseInt(style.paddingBottom) || 0;
  const borderTop = parseInt(style.borderTopWidth) || 0;
  const borderBottom = parseInt(style.borderBottomWidth) || 0;
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

function readPanelWidth(): number {
  try {
    const stored = localStorage.getItem(PANEL_WIDTH_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) return parsed;
    }
  } catch { /* ignore */ }
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
  { name: "clear", description: "Clear conversation" },
  { name: "context", description: "Show token usage" },
  { name: "save", description: "Save conversation" },
  { name: "restore", description: "Restore conversation" },
  { name: "drop", description: "Delete saved conversation" },
];

function PanelContent({ onClose }: { onClose: () => void }) {
  const {
    messages, isStreaming, isConnected, retryAfter,
    sendMessage, approveTool, rejectTool, answerQuestion, stopStreaming, handleSlashCommand,
  } = useAIStore();

  const [input, setInput] = useState("");
  const [slashResults, setSlashResults] = useState<typeof SLASH_COMMANDS>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const context = usePageContext();

  // WS lifecycle managed by store subscription to aiPanelOpen — no connect/disconnect here

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const timer = setTimeout(() => textareaRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;

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
  }, [input, context, sendMessage, handleSlashCommand]);

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
        const cmd = slashResults[slashIndex];
        if (cmd.name === "clear" || cmd.name === "context") {
          handleSlashCommand(`/${cmd.name}`);
          setInput("");
          setSlashResults([]);
        } else {
          setInput(`/${cmd.name} `);
          setSlashResults([]);
        }
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
      const matches = SLASH_COMMANDS.filter((c) => c.name.startsWith(query));
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
        const nextUnanswered = allQuestions.find((tc) => tc.status === "awaiting_approval" || tc.status === "running");
        if (nextUnanswered) {
          const answeredCount = allQuestions.filter((tc) => tc.status === "completed" || tc.status === "failed" || tc.status === "rejected").length;
          return { activeQuestion: nextUnanswered, questionIndex: answeredCount + 1, questionsTotal: allQuestions.length };
        }
      }
    }
    return { activeQuestion: null, questionIndex: 0, questionsTotal: 0 };
  })();

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">AI Assistant</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      {messages.length === 0 ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-3">
          <Sparkles className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground text-center">
            Ask me anything about your infrastructure
          </p>
          <QuickActionChips onSelect={handleQuickAction} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto dashboard-scrollbar px-3 pt-3">
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
            <div ref={messagesEndRef} className="pb-4" />
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
      {!isConnected && (
        <div className="text-xs text-muted-foreground text-center py-1.5 border-t border-border">
          Connecting...
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
        <div className="shrink-0 border-t border-border relative">
          {/* Slash command popup */}
          <AnimatePresence>
            {slashResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.12 }}
                className="absolute left-0 right-0 border-t border-border bg-background shadow-md z-10"
                style={{ bottom: "calc(100% + 1px)" }}
              >
                {slashResults.map((cmd, i) => (
                  <button
                    key={cmd.name}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${i === slashIndex ? "bg-muted" : "hover:bg-muted/50"}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (cmd.name === "clear" || cmd.name === "context") {
                        handleSlashCommand(`/${cmd.name}`);
                        setInput("");
                        setSlashResults([]);
                      } else {
                        setInput(`/${cmd.name} `);
                        setSlashResults([]);
                      }
                    }}
                  >
                    <span className="font-mono text-muted-foreground">/{cmd.name}</span>
                    <span className="text-muted-foreground/60 ml-auto shrink-0">{cmd.description}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="relative flex">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={isStreaming ? "AI is responding..." : "Ask anything... (/ commands)"}
              disabled={!isConnected || !!retryAfter}
              rows={1}
              className="block w-full resize-none bg-background px-3 py-2.5 pr-10 text-sm leading-5 placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
            />
            <button
              className="absolute right-1.5 p-1.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
              style={{ bottom: "calc(50% - 14px)" }}
              onClick={isStreaming ? stopStreaming : handleSend}
              disabled={!isStreaming && (!input.trim() || !isConnected || !!retryAfter)}
            >
              {isStreaming ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface AISidePanelProps {
  isMobile?: boolean;
}

export function AISidePanel({ isMobile = false }: AISidePanelProps) {
  const { aiPanelOpen, setAIPanelOpen } = useUIStore();
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);
  const [, setIsResizing] = useState(false);

  const handleClose = () => setAIPanelOpen(false);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    setPanelWidth((w) => {
      try { localStorage.setItem(PANEL_WIDTH_KEY, String(w)); } catch { /* ignore */ }
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
          <PanelContent onClose={handleClose} />
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
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="relative h-full shrink-0 overflow-hidden border-l border-border"
        >
          {/* Inner content pinned to panelWidth so it never reflows */}
          <div
            style={{ width: panelWidth }}
            className="h-full flex flex-col bg-background"
          >
            <ResizeHandle
              side="right"
              onResize={setPanelWidth}
              onResizeStart={() => setIsResizing(true)}
              onResizeEnd={handleResizeEnd}
              minWidth={MIN_WIDTH}
              maxWidth={MAX_WIDTH}
            />
            <PanelContent onClose={handleClose} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
