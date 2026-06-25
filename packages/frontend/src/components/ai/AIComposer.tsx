import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Send, Shield, ShieldAlert, ShieldCheck, Square } from "lucide-react";
import type { ChangeEvent, ElementType, KeyboardEvent, RefObject } from "react";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type AIContextUsage, getAIContextUsage } from "@/stores/ai";
import type { AIMessage as AIMessageType } from "@/types/ai";

export type AIApprovalMode =
  | "always-ask"
  | "normal"
  | "bypass-non-destructive"
  | "bypass-everything";

export interface AISlashCommand {
  name: string;
  description: string;
}

interface AIComposerProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  onSlashCommandSelect: (command: AISlashCommand) => void;
  slashResults: AISlashCommand[];
  slashIndex: number;
  messages: AIMessageType[];
  isStreaming: boolean;
  isConnected: boolean;
  retryAfter?: number | null;
  approvalMode: AIApprovalMode;
  approvalModeLabel: string;
  setApprovalMode: (mode: AIApprovalMode) => void | Promise<void>;
  maxRows?: number;
  className?: string;
  surfaceClassName?: string;
  showDisclaimer?: boolean;
}

const APPROVAL_MODE_META: Record<
  AIApprovalMode,
  { label: string; menuLabel: string; icon: ElementType }
> = {
  "always-ask": { label: "Always ask", menuLabel: "Always ask", icon: Shield },
  normal: { label: "Normal", menuLabel: "Normal", icon: Shield },
  "bypass-non-destructive": {
    label: "Bypass non-destructive",
    menuLabel: "Bypass non-destructive",
    icon: ShieldCheck,
  },
  "bypass-everything": {
    label: "Full access",
    menuLabel: "Bypass everything",
    icon: ShieldAlert,
  },
};

function ContextRing({ usage }: { usage: AIContextUsage | null }) {
  const percent = Math.max(0, Math.min(100, usage?.percent ?? 0));
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (circumference * percent) / 100;

  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center text-muted-foreground focus-visible:outline-none"
          aria-label="Context usage"
        >
          <svg className="h-4 w-4 -rotate-90" viewBox="0 0 20 20" aria-hidden="true">
            <circle
              cx="10"
              cy="10"
              r={radius}
              fill="none"
              strokeWidth="3"
              className="stroke-border"
            />
            <circle
              cx="10"
              cy="10"
              r={radius}
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className="stroke-muted-foreground transition-[stroke-dashoffset]"
            />
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" className="w-64 p-3 text-xs">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Context</span>
            <span className="font-mono">
              {usage
                ? `${usage.estimatedTokens.toLocaleString()} / ${usage.limit.toLocaleString()}`
                : "Loading..."}
            </span>
          </div>
          {usage && (
            <>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Used</span>
                <span>{usage.percent}%</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Messages</span>
                <span>{usage.messageCount}</span>
              </div>
            </>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function AIComposer({
  textareaRef,
  input,
  onInputChange,
  onKeyDown,
  onSend,
  onStop,
  onSlashCommandSelect,
  slashResults,
  slashIndex,
  messages,
  isStreaming,
  isConnected,
  retryAfter,
  approvalMode,
  approvalModeLabel,
  setApprovalMode,
  className,
  surfaceClassName,
  showDisclaimer = false,
}: AIComposerProps) {
  const modeMeta = APPROVAL_MODE_META[approvalMode];
  const ModeIcon = modeMeta.icon;
  const disabled = !isConnected || !!retryAfter;
  const [usage, setUsage] = useState<AIContextUsage | null>(null);
  const [textareaFocused, setTextareaFocused] = useState(false);

  useEffect(() => {
    let active = true;
    void getAIContextUsage(messages).then((nextUsage) => {
      if (active) setUsage(nextUsage);
    });
    return () => {
      active = false;
    };
  }, [messages]);

  return (
    <div className={cn("relative", className)}>
      <AnimatePresence>
        {slashResults.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute left-0 right-0 z-10 border border-border bg-background shadow-md"
            style={{ bottom: "calc(100% + 8px)" }}
          >
            {slashResults.map((command, index) => (
              <button
                key={command.name}
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  index === slashIndex ? "bg-muted" : "hover:bg-muted/50"
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  if (isStreaming) return;
                  onSlashCommandSelect(command);
                }}
              >
                <span className="font-mono text-muted-foreground">/{command.name}</span>
                <span className="ml-auto shrink-0 text-muted-foreground/60">
                  {command.description}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={cn(
          "flex flex-col border bg-muted/30 transition-colors",
          textareaFocused ? "border-ring ring-1 ring-inset ring-ring" : "border-border",
          surfaceClassName
        )}
      >
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          onFocus={() => setTextareaFocused(true)}
          onBlur={() => setTextareaFocused(false)}
          placeholder={isStreaming ? "AI is responding..." : "Ask anything... (/ commands)"}
          disabled={disabled}
          rows={1}
          className="block min-h-[42px] resize-none border-0 bg-transparent px-3 pb-1.5 pt-3 pr-3 leading-5 focus-visible:ring-0"
        />
        <div className="-mt-1 flex min-h-10 items-center justify-between gap-2 px-2 pb-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-8 max-w-[15rem] items-center gap-2 px-1.5 text-sm transition-colors focus-visible:outline-none",
                  approvalMode === "bypass-everything"
                    ? "text-amber-600 hover:text-amber-500 focus-visible:text-amber-500 dark:text-amber-400 dark:hover:text-amber-300 dark:focus-visible:text-amber-300"
                    : "text-muted-foreground hover:text-foreground focus-visible:text-foreground"
                )}
                title={approvalModeLabel}
                aria-label={approvalModeLabel}
              >
                <ModeIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">{modeMeta.label}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-60">
              {(Object.keys(APPROVAL_MODE_META) as AIApprovalMode[]).map((mode) => {
                const item = APPROVAL_MODE_META[mode];
                const ItemIcon = item.icon;
                return (
                  <DropdownMenuItem key={mode} onClick={() => void setApprovalMode(mode)}>
                    <ItemIcon className="h-4 w-4" />
                    <span>{item.menuLabel}</span>
                    {approvalMode === mode && <Check className="ml-auto h-4 w-4" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex items-center">
            <ContextRing usage={usage} />
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
              onClick={isStreaming ? onStop : onSend}
              disabled={!isStreaming && (!input.trim() || !isConnected || !!retryAfter)}
              aria-label={isStreaming ? "Stop response" : "Send message"}
            >
              {isStreaming ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
      {showDisclaimer && (
        <p className="pt-2 text-center text-[11px] text-muted-foreground">
          AI can make mistakes. Check important information.
        </p>
      )}
    </div>
  );
}
