import { ChevronDown, ChevronRight, TerminalSquare } from "lucide-react";
import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AIMessage as AIMessageType, AIToolCall } from "@/types/ai";
import { AIToolCallBlock } from "./AIToolCallBlock";

interface AIMessageProps {
  message: AIMessageType;
  assistantMaxWidthClass?: string;
  onApprove?: (toolCallId: string) => void;
  onReject?: (toolCallId: string) => void;
  onAnswer?: (toolCallId: string, answer: string) => void;
}

type ToolCallRenderItem =
  | { type: "single"; toolCall: AIToolCall }
  | { type: "finished-group"; toolCalls: AIToolCall[] };

function isGroupableFinishedToolCall(toolCall: AIToolCall): boolean {
  return toolCall.status === "completed" || toolCall.status === "failed";
}

function buildToolCallRenderItems(toolCalls: AIToolCall[]): ToolCallRenderItem[] {
  const items: ToolCallRenderItem[] = [];
  let finishedRun: AIToolCall[] = [];

  const flushFinishedRun = () => {
    if (finishedRun.length === 1) {
      items.push({ type: "single", toolCall: finishedRun[0] });
    } else if (finishedRun.length > 1) {
      items.push({ type: "finished-group", toolCalls: finishedRun });
    }
    finishedRun = [];
  };

  for (const toolCall of toolCalls) {
    if (isGroupableFinishedToolCall(toolCall)) {
      finishedRun.push(toolCall);
      continue;
    }

    flushFinishedRun();
    items.push({ type: "single", toolCall });
  }

  flushFinishedRun();
  return items;
}

export function AIMessage({
  message,
  assistantMaxWidthClass = "max-w-[95%]",
  onApprove,
  onReject,
  onAnswer,
}: AIMessageProps) {
  const content = typeof message.content === "string" ? message.content : "";
  const toolCallItems = message.toolCalls ? buildToolCallRenderItems(message.toolCalls) : [];

  if (message.role === "user") {
    // Strip hidden system instructions (e.g. from command palette "Ask AI")
    const displayContent = content
      .replace(/<system-instruction>[\s\S]*?<\/system-instruction>\s*/g, "")
      .trim();
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-primary px-3 py-2 text-sm text-primary-foreground break-words">
          {displayContent}
        </div>
      </div>
    );
  }

  if (message.localOnly) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[90%] bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {content}
          </Markdown>
        </div>
      </div>
    );
  }

  const hasContent = !!content;
  const hasToolCalls = !!message.toolCalls?.length;
  const allToolsDone =
    hasToolCalls &&
    message.toolCalls!.every(
      (tc) => tc.status === "completed" || tc.status === "failed" || tc.status === "rejected"
    );
  const hasError = content.includes("**Error:**");

  const hasActiveQuestion =
    hasToolCalls &&
    message.toolCalls!.some(
      (tc) => tc.name === "ask_question" && tc.status === "awaiting_approval"
    );

  // Show thinking when:
  // 1. Streaming with nothing yet (initial)
  // 2. Streaming after all tools completed, waiting for next response
  const isThinking =
    message.isStreaming &&
    !hasError &&
    !hasActiveQuestion &&
    ((!hasContent && !hasToolCalls) || (allToolsDone && !hasContent));
  const isRetrying = message.isStreaming && hasError;

  return (
    <div className={assistantMaxWidthClass}>
      <div className="text-sm">
        {/* Tool calls rendered first */}
        {hasToolCalls && (
          <div className="space-y-0.5">
            {toolCallItems.map((item) =>
              item.type === "single" ? (
                <AIToolCallBlock
                  key={item.toolCall.id}
                  toolCall={item.toolCall}
                  onApprove={onApprove}
                  onReject={onReject}
                  onAnswer={onAnswer}
                />
              ) : (
                <FinishedToolCallsGroup
                  key={item.toolCalls.map((tc) => tc.id).join(":")}
                  toolCalls={item.toolCalls}
                />
              )
            )}
          </div>
        )}

        {/* Text content */}
        {hasContent && (
          <div className="prose prose-sm dark:prose-invert !max-w-none break-words prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-pre:my-2 prose-table:my-0 prose-code:text-xs prose-pre:text-xs prose-pre:rounded-none prose-code:rounded-none prose-code:before:content-none prose-code:after:content-none [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0">
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content}
            </Markdown>
          </div>
        )}

        {/* Streaming cursor after text */}
        {message.isStreaming && hasContent && !hasError && (
          <span className="inline-block h-3.5 w-1 animate-pulse bg-foreground/50 ml-0.5" />
        )}

        {/* Status indicators */}
        {isThinking && <ThinkingIndicator label="Thinking" />}
        {isRetrying && <ThinkingIndicator label="Retrying" />}
        {hasActiveQuestion && <ThinkingIndicator label="Waiting for response" />}
      </div>
    </div>
  );
}

function FinishedToolCallsGroup({ toolCalls }: { toolCalls: AIToolCall[] }) {
  const [expanded, setExpanded] = useState(false);
  const failedCount = toolCalls.filter((toolCall) => toolCall.status === "failed").length;
  const groupLabel =
    failedCount > 0
      ? `Called ${toolCalls.length} tools, ${failedCount} failed`
      : `Called ${toolCalls.length} tools`;

  return (
    <div className="my-0.5 text-sm">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group flex cursor-pointer items-center gap-2 py-0.5 text-left text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
      >
        <TerminalSquare className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="truncate">{groupLabel}</span>
        {expanded ? (
          <ChevronDown className="-ml-1 h-3 w-3 shrink-0 opacity-70 transition-opacity" />
        ) : (
          <ChevronRight className="-ml-1 h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70" />
        )}
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-150 ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="py-1">
            {toolCalls.map((toolCall) => (
              <AIToolCallBlock key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 py-1 text-sm text-muted-foreground">
      <span className="thinking-shimmer">{label}</span>
      <style>{`
        .thinking-shimmer {
          background: linear-gradient(
            90deg,
            currentColor 0%,
            currentColor 40%,
            var(--color-foreground) 50%,
            currentColor 60%,
            currentColor 100%
          );
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 1.5s linear infinite;
        }
        @keyframes shimmer {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
    </div>
  );
}

const markdownComponents = {
  pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => (
    <pre className="overflow-x-auto bg-muted p-2" {...props}>
      {children}
    </pre>
  ),
  code: ({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="break-words bg-muted px-1 py-0.5 text-xs" {...props}>
        {children}
      </code>
    );
  },
  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto bg-muted/50 border border-border">
      <table
        className="min-w-full text-xs [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:px-2 [&_td]:py-1.5 [&_td]:border-t [&_td]:border-border"
        {...props}
      >
        {children}
      </table>
    </div>
  ),
  a: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a className="text-primary underline" target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  ),
};
