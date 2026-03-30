import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AIToolCallBlock } from "./AIToolCallBlock";
import type { AIMessage as AIMessageType } from "@/types/ai";

interface AIMessageProps {
  message: AIMessageType;
  onApprove?: (toolCallId: string) => void;
  onReject?: (toolCallId: string) => void;
  onAnswer?: (toolCallId: string, answer: string) => void;
}

export function AIMessage({ message, onApprove, onReject, onAnswer }: AIMessageProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-primary px-3 py-2 text-sm text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.localOnly) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[90%] bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {message.content}
          </Markdown>
        </div>
      </div>
    );
  }

  const hasContent = !!message.content;
  const hasToolCalls = !!message.toolCalls?.length;
  const allToolsDone = hasToolCalls && message.toolCalls!.every(
    (tc) => tc.status === "completed" || tc.status === "failed" || tc.status === "rejected"
  );
  const hasError = message.content?.includes("**Error:**");

  const hasActiveQuestion = hasToolCalls && message.toolCalls!.some(
    (tc) => tc.name === "ask_question" && tc.status === "awaiting_approval"
  );

  // Show thinking when:
  // 1. Streaming with nothing yet (initial)
  // 2. Streaming after all tools completed, waiting for next response
  const isThinking = message.isStreaming && !hasError && !hasActiveQuestion && (
    (!hasContent && !hasToolCalls) ||
    (allToolsDone && !hasContent)
  );
  const isRetrying = message.isStreaming && hasError;

  return (
    <div className="max-w-[95%]">
      <div className="text-sm">
        {/* Tool calls rendered first */}
        {hasToolCalls && (
          <div className="space-y-1">
            {message.toolCalls!.map((tc) => (
              <AIToolCallBlock
                key={tc.id}
                toolCall={tc}
                onApprove={onApprove}
                onReject={onReject}
                onAnswer={onAnswer}
              />
            ))}
          </div>
        )}

        {/* Text content */}
        {hasContent && (
          <div className="prose prose-sm dark:prose-invert !max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-pre:my-0 prose-table:my-0 prose-code:text-xs prose-pre:text-xs prose-pre:rounded-none prose-code:rounded-none [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0">
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {message.content}
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

function ThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
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
      return <code className={className} {...props}>{children}</code>;
    }
    return (
      <code className="bg-muted px-1 py-0.5 text-xs" {...props}>
        {children}
      </code>
    );
  },
  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto bg-muted/50 border border-border">
      <table className="min-w-full text-xs [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:px-2 [&_td]:py-1.5 [&_td]:border-t [&_td]:border-border" {...props}>{children}</table>
    </div>
  ),
  a: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a className="text-primary underline" target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  ),
};
