import {
  Minimize2,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { confirm } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { useAIStore } from "@/stores/ai";
import { useUIStore } from "@/stores/ui";
import type { PageContext } from "@/types/ai";
import { AIComposer, type AIApprovalMode } from "./AIComposer";
import { AIMessage } from "./AIMessage";
import { QuestionBlock } from "./AIToolCallBlock";
import { QuickActionChips } from "./QuickActionChips";

const BOTTOM_SCROLL_THRESHOLD = 48;
const SLASH_COMMANDS = [
  { name: "new", description: "Start new conversation" },
  { name: "clear", description: "Clear conversation" },
  { name: "compact", description: "Compact saved context" },
  { name: "context", description: "Show token usage" },
];

function autoResizeTextarea(el: HTMLTextAreaElement, maxRows = 8) {
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

function userMessagesAfterLastCompact(messages: ReturnType<typeof useAIStore.getState>["messages"]): number {
  const lastCompactIndex = messages.reduce(
    (latest, message, index) => (message.compactMarker ? index : latest),
    -1
  );
  return messages.slice(lastCompactIndex + 1).filter((message) => message.role === "user").length;
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

export function AILitePanel() {
  const {
    messages,
    isStreaming,
    isConnected,
    isConnecting,
    connectionError,
    retryAfter,
    sendMessage,
    approveTool,
    rejectTool,
    answerQuestion,
    stopStreaming,
    handleSlashCommand,
    connect,
  } = useAIStore();
  const {
    setAILiteMode,
    aiBypassCreateApprovals,
    aiBypassEditApprovals,
    aiBypassDeleteApprovals,
    setAIBypassCreateApprovals,
    setAIBypassEditApprovals,
    setAIBypassDeleteApprovals,
  } = useUIStore();

  const [input, setInput] = useState("");
  const [slashResults, setSlashResults] = useState<typeof SLASH_COMMANDS>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const context = usePageContext();
  const canCompact = userMessagesAfterLastCompact(messages) > 3;
  const visibleSlashCommands = SLASH_COMMANDS.filter(
    (command) => command.name !== "compact" || canCompact
  );
  const approvalMode: AIApprovalMode = aiBypassDeleteApprovals
    ? "bypass-everything"
    : aiBypassCreateApprovals || aiBypassEditApprovals
      ? "bypass-write"
      : "normal";
  const approvalModeLabel =
    approvalMode === "bypass-everything"
      ? "AI mode: bypass everything"
      : approvalMode === "bypass-write"
        ? "AI mode: bypass edit and creation"
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
      setAIBypassCreateApprovals(mode !== "normal");
      setAIBypassEditApprovals(mode !== "normal");
      setAIBypassDeleteApprovals(mode === "bypass-everything");
    },
    [
      aiBypassDeleteApprovals,
      setAIBypassCreateApprovals,
      setAIBypassDeleteApprovals,
      setAIBypassEditApprovals,
    ]
  );

  useEffect(() => {
    void connect();
  }, [connect]);

  useEffect(() => {
    const timer = setTimeout(() => textareaRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, []);

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

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

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
  }, [context, handleSlashCommand, input, isStreaming, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
        void handleSlashCommand(`/${cmd.name}`);
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
      void handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    autoResizeTextarea(e.target);

    if (val.startsWith("/") && !val.includes(" ")) {
      const query = val.slice(1).toLowerCase();
      setSlashResults(visibleSlashCommands.filter((command) => command.name.startsWith(query)));
      setSlashIndex(0);
    } else {
      setSlashResults([]);
    }
  };

  const handleQuickAction = (prompt: string) => {
    sendMessage(prompt, context);
  };

  const { activeQuestion, questionIndex, questionsTotal } = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && msg.toolCalls) {
        const allQuestions = msg.toolCalls.filter((tc) => tc.name === "ask_question");
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
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-[49px] shrink-0 items-center justify-between border-b border-border px-4">
        <span className="text-sm font-semibold">AI Assistant</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setAILiteMode(false)}
          title="Exit full screen"
          aria-label="Exit full screen"
        >
          <Minimize2 className="h-4 w-4" />
        </Button>
      </div>

      {messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4">
          <div className="flex w-full max-w-3xl flex-col items-center gap-3">
            <Sparkles className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-center text-sm text-muted-foreground">
              Ask me anything about your infrastructure
            </p>
            <QuickActionChips onSelect={handleQuickAction} />
          </div>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollViewportRef}
            role="log"
            aria-label="AI messages"
            className="h-full overflow-y-auto [scrollbar-gutter:stable_both-edges] dashboard-scrollbar pt-4"
            onScroll={updateStickToBottom}
          >
            <div className="mx-auto w-full max-w-3xl space-y-4 px-4 pb-8">
              {messages.map((msg) => (
                <AIMessage
                key={msg.id}
                message={msg}
                assistantMaxWidthClass="max-w-[90%]"
                onApprove={approveTool}
                onReject={rejectTool}
                onAnswer={answerQuestion}
                />
              ))}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-background/50 to-transparent" />
        </div>
      )}

      {retryAfter !== null && (
        <div className="text-center text-xs text-muted-foreground">
          Rate limited — retrying in {retryAfter}s...
        </div>
      )}
      {!isConnected && (isConnecting || connectionError) && (
        <div className="text-center text-xs text-muted-foreground">
          {isConnecting ? "Connecting..." : connectionError}
        </div>
      )}

      {activeQuestion ? (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
          <div className="border border-border bg-background">
            {questionsTotal > 1 && (
              <div className="border-b border-border bg-muted/50 px-3 py-1 text-[11px] text-muted-foreground">
                Question {questionIndex} of {questionsTotal}
              </div>
            )}
            <QuestionBlock toolCall={activeQuestion} onAnswer={answerQuestion} />
          </div>
        </div>
      ) : (
        <div className="relative mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
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
            showDisclaimer
          />
        </div>
      )}
    </div>
  );
}
