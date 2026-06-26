import { Minimize2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type AIApprovalMode, formatAIApprovalModeLabel } from "@/lib/ai-approval-mode";
import {
  confirmBypassEverythingMode,
  updateAIApprovalModeOptimistically,
} from "@/lib/ai-user-preferences";
import { api } from "@/services/api";
import { getConversationBlock, useAIStore } from "@/stores/ai";
import { useUIStore } from "@/stores/ui";
import type {
  AIComposerAttachment,
  AIComposerLocalImageAttachment,
  AIConfig,
  AIMessageAttachment,
  PageContext,
} from "@/types/ai";
import { AIComposer } from "./AIComposer";
import { AIConversationBlockedBlock } from "./AIConversationBlockedBlock";
import { AIMessage } from "./AIMessage";
import { QuestionBlock } from "./AIToolCallBlock";
import { QuickActionChips } from "./QuickActionChips";
import {
  composerAttachmentToFile,
  filesToComposerAttachments,
  getComposerAttachmentId,
  getComposerAttachmentPreviewUrl,
  useAIComposerAttachmentsDraft,
  useAIComposerDraft,
} from "./useAIComposerDraft";

const BOTTOM_SCROLL_THRESHOLD = 48;
const SLASH_COMMANDS = [
  { name: "new", description: "Start new conversation" },
  { name: "clear", description: "Clear conversation" },
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

async function uploadComposerAttachments(
  attachments: AIComposerAttachment[],
  conversationId: string | null
): Promise<AIMessageAttachment[]> {
  const uploaded: AIMessageAttachment[] = [];
  for (const attachment of attachments) {
    if ("artifactId" in attachment) {
      uploaded.push(attachment);
      continue;
    }
    uploaded.push(await uploadLocalComposerAttachment(attachment, conversationId));
  }
  return uploaded;
}

async function uploadLocalComposerAttachment(
  attachment: AIComposerLocalImageAttachment,
  conversationId: string | null
): Promise<AIMessageAttachment> {
  const file = await composerAttachmentToFile(attachment);
  return api.uploadAIChatArtifact(file, conversationId);
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

export function AILitePanel() {
  const {
    messages,
    isStreaming,
    isConnected,
    isConnecting,
    connectionError,
    retryAfter,
    activeConversationId,
    sendMessage,
    approveTool,
    rejectTool,
    answerQuestion,
    stopStreaming,
    clearMessages,
    handleSlashCommand,
    connect,
  } = useAIStore();
  const { setAILiteMode, aiApprovalMode: approvalMode } = useUIStore();

  const [input, setInput] = useAIComposerDraft(activeConversationId);
  const [attachments, setAttachments] = useAIComposerAttachmentsDraft(activeConversationId);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [canAttachImages, setCanAttachImages] = useState(false);
  const [slashResults, setSlashResults] = useState<typeof SLASH_COMMANDS>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const context = usePageContext();
  const approvalModeLabel = formatAIApprovalModeLabel(approvalMode);
  const conversationBlock = getConversationBlock(messages);

  const setApprovalMode = useCallback(
    async (mode: AIApprovalMode) => {
      if (
        mode === "bypass-everything" &&
        approvalMode !== "bypass-everything" &&
        !(await confirmBypassEverythingMode())
      ) {
        return;
      }
      try {
        await updateAIApprovalModeOptimistically(mode, approvalMode);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update AI mode");
      }
    },
    [approvalMode]
  );

  useEffect(() => {
    void connect();
  }, [connect]);

  useEffect(() => {
    const cached = api.getCached<AIConfig>("settings:ai-config");
    if (cached) setCanAttachImages(Boolean(cached.supportsImages));
    let cancelled = false;
    void api
      .getAIConfig()
      .then((config) => {
        if (!cancelled) setCanAttachImages(Boolean((config as unknown as AIConfig).supportsImages));
      })
      .catch(() => {
        if (!cancelled) setCanAttachImages(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => textareaRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: input changes must re-measure restored composer drafts.
  useLayoutEffect(() => {
    if (textareaRef.current) autoResizeTextarea(textareaRef.current);
  }, [input]);

  const previewAttachment = useCallback((attachment: AIComposerAttachment) => {
    if ("artifactId" in attachment) {
      const params = new URLSearchParams({ filename: attachment.filename });
      params.set("mediaType", attachment.mediaType);
      window.open(
        `/ai/artifact/${encodeURIComponent(attachment.artifactId)}?${params.toString()}`,
        `artifact-${attachment.artifactId}`,
        "width=900,height=600,menubar=no,toolbar=no"
      );
      return;
    }
    window.open(getComposerAttachmentPreviewUrl(attachment), "_blank", "noopener,noreferrer");
  }, []);

  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      if (!canAttachImages || files.length === 0) return;
      try {
        const nextAttachments = await filesToComposerAttachments(files);
        setAttachments([...attachments, ...nextAttachments]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to attach image");
      }
    },
    [attachments, canAttachImages, setAttachments]
  );

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
    if ((!text && attachments.length === 0) || isStreaming) return;

    if (attachments.length === 0 && text.startsWith("/")) {
      const handled = await handleSlashCommand(text);
      if (handled) {
        setInput("");
        setAttachments([]);
        setSlashResults([]);
        return;
      }
    }

    setUploadingAttachments(true);
    try {
      const uploadedAttachments = await uploadComposerAttachments(
        attachments,
        activeConversationId
      );
      setInput("");
      setAttachments([]);
      setSlashResults([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      sendMessage(text, context, uploadedAttachments);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to attach image");
    } finally {
      setUploadingAttachments(false);
    }
  }, [
    activeConversationId,
    attachments,
    context,
    handleSlashCommand,
    input,
    isStreaming,
    sendMessage,
    setAttachments,
    setInput,
  ]);

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
      setSlashResults(SLASH_COMMANDS.filter((command) => command.name.startsWith(query)));
      setSlashIndex(0);
    } else {
      setSlashResults([]);
    }
  };

  const handleQuickAction = (prompt: string) => {
    sendMessage(prompt, context, [], { startNewConversation: messages.length === 0 });
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
              {messages.map((msg, index) => (
                <AIMessage
                  key={msg.id || `${msg.role}-${index}`}
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
      ) : conversationBlock ? (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
          <div className="border border-border bg-background">
            <AIConversationBlockedBlock
              block={conversationBlock}
              onNewChat={clearMessages}
              showTopBorder={false}
            />
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
              setAttachments([]);
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
            attachments={attachments}
            canAttachImages={canAttachImages}
            uploadingAttachments={uploadingAttachments}
            onAttachFiles={handleAttachFiles}
            onRemoveAttachment={(artifactId) =>
              setAttachments(
                attachments.filter(
                  (attachment) => getComposerAttachmentId(attachment) !== artifactId
                )
              )
            }
            onPreviewAttachment={previewAttachment}
            showDisclaimer
          />
        </div>
      )}
    </div>
  );
}
