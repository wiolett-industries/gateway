import {
  BookOpen,
  Box,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Globe,
  HelpCircle,
  Loader2,
  Lock,
  Search,
  Send,
  Shield,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AIToolCall } from "@/types/ai";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  list_cas: ShieldCheck,
  get_ca: ShieldCheck,
  create_root_ca: ShieldCheck,
  create_intermediate_ca: ShieldCheck,
  delete_ca: ShieldCheck,
  list_certificates: FileText,
  get_certificate: FileText,
  issue_certificate: FileText,
  revoke_certificate: FileText,
  list_templates: FileText,
  create_template: FileText,
  delete_template: FileText,
  list_proxy_hosts: Globe,
  get_proxy_host: Globe,
  create_proxy_host: Globe,
  update_proxy_host: Globe,
  delete_proxy_host: Globe,
  list_ssl_certificates: Lock,
  request_acme_cert: Lock,
  link_internal_cert: Lock,
  list_domains: Globe,
  create_domain: Globe,
  delete_domain: Globe,
  list_access_lists: Shield,
  create_access_list: Shield,
  delete_access_list: Shield,
  list_users: Users,
  update_user_role: Users,
  get_audit_log: Users,
  get_dashboard_stats: Users,
  list_docker_containers: Box,
  get_docker_container: Box,
  start_docker_container: Box,
  stop_docker_container: Box,
  restart_docker_container: Box,
  remove_docker_container: Box,
  get_docker_container_logs: Box,
  list_docker_images: Box,
  pull_docker_image: Box,
  list_docker_volumes: Box,
  list_docker_networks: Box,
  web_search: Search,
  internal_documentation: BookOpen,
  ask_question: HelpCircle,
  wait: Clock,
  fetch: Globe,
  download_artifact: Download,
  read_artifact: FileText,
  send_artifact: Download,
};

interface AIToolCallBlockProps {
  toolCall: AIToolCall;
  onApprove?: (toolCallId: string) => void;
  onReject?: (toolCallId: string) => void;
  onAnswer?: (toolCallId: string, answer: string) => void;
}

export function AIToolCallBlock({ toolCall, onApprove, onReject }: AIToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const safeToolCall =
    toolCall && typeof toolCall === "object" ? toolCall : ({} as Partial<AIToolCall>);
  const toolName =
    typeof safeToolCall.name === "string" && safeToolCall.name ? safeToolCall.name : "unknown_tool";
  const toolArguments =
    safeToolCall.arguments &&
    typeof safeToolCall.arguments === "object" &&
    !Array.isArray(safeToolCall.arguments)
      ? safeToolCall.arguments
      : {};
  const toolStatus = safeToolCall.status ?? "failed";
  const Icon =
    toolStatus === "running"
      ? Loader2
      : toolStatus === "failed"
        ? X
        : CATEGORY_ICONS[toolName] || ShieldCheck;

  const statusIcon = () => {
    switch (toolStatus) {
      case "running":
        return null;
      case "completed":
        return null;
      case "failed":
        return null;
      case "awaiting_approval":
        return null;
      case "rejected":
        return <X className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const isSkipped =
    safeToolCall.result &&
    typeof safeToolCall.result === "object" &&
    "skipped" in (safeToolCall.result as Record<string, unknown>);
  const toolLabel =
    toolName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) +
    (isSkipped ? " (skipped)" : "");

  const hasArgs = Object.keys(toolArguments).length > 0;
  const shouldHideResult = toolName === "send_artifact";
  const hasResult = safeToolCall.result !== undefined && !isSkipped && !shouldHideResult;
  const hasError = !!safeToolCall.error;
  const hasContent = hasArgs || hasResult || hasError || toolStatus === "rejected";
  const isExpandedChevronVisible = expanded || toolStatus === "running" || toolStatus === "failed";

  return (
    <div className="my-0.5 text-sm">
      <button
        onClick={hasContent ? () => setExpanded(!expanded) : undefined}
        className={`group flex items-center gap-2 py-0.5 text-left text-muted-foreground transition-colors ${hasContent ? "cursor-pointer hover:text-foreground focus-visible:text-foreground focus-visible:outline-none" : "cursor-default"}`}
      >
        <Icon
          className={`h-3.5 w-3.5 shrink-0 ${
            toolStatus === "running"
              ? "animate-spin text-primary"
              : toolStatus === "failed"
                ? "text-destructive"
                : "opacity-70"
          }`}
        />
        <span className={`truncate ${isSkipped ? "text-muted-foreground" : ""}`}>{toolLabel}</span>
        {hasContent &&
          (expanded ? (
            <ChevronDown className="-ml-1 h-3 w-3 shrink-0 opacity-70 transition-opacity" />
          ) : (
            <ChevronRight
              className={`-ml-1 h-3 w-3 shrink-0 transition-opacity ${
                isExpandedChevronVisible
                  ? "opacity-70"
                  : "opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70"
              }`}
            />
          ))}
        {!isSkipped && statusIcon()}
      </button>

      {toolStatus === "awaiting_approval" && toolName !== "ask_question" && (
        <div className="flex items-center gap-2 border border-border bg-yellow-500/5 px-2.5 py-2">
          <span className="flex-1 text-yellow-600 dark:text-yellow-400 text-xs">
            This action requires your approval
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              if (typeof safeToolCall.id === "string") onReject?.(safeToolCall.id);
            }}
          >
            Reject
          </Button>
          <Button
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              if (typeof safeToolCall.id === "string") onApprove?.(safeToolCall.id);
            }}
          >
            Approve
          </Button>
        </div>
      )}

      {/* Animated expand/collapse */}
      <div
        className="grid transition-[grid-template-rows] duration-150 ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          {hasArgs && (
            <pre className="overflow-x-auto whitespace-pre-wrap border border-border bg-muted px-2.5 py-1.5 text-[11px]">
              {JSON.stringify(toolArguments, null, 2)}
            </pre>
          )}
          {hasResult && (
            <pre className="max-h-48 overflow-x-auto whitespace-pre-wrap border border-t-0 border-border bg-muted/50 px-2.5 py-1.5 text-[11px]">
              {typeof safeToolCall.result === "string"
                ? safeToolCall.result
                : JSON.stringify(safeToolCall.result, null, 2)}
            </pre>
          )}
          {hasError && (
            <p
              className={`border border-border px-2.5 py-1.5 text-destructive ${
                hasArgs || hasResult ? "border-t-0" : ""
              }`}
            >
              {safeToolCall.error}
            </p>
          )}
          {toolStatus === "rejected" && (
            <p className="border border-border px-2.5 py-1.5 italic text-muted-foreground">
              Rejected by user
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function QuestionBlock({
  toolCall,
  onAnswer,
}: {
  toolCall: AIToolCall;
  onAnswer?: (id: string, answer: string) => void;
}) {
  const [answerText, setAnswerText] = useState("");
  const safeToolCall =
    toolCall && typeof toolCall === "object" ? toolCall : ({} as Partial<AIToolCall>);
  const args = (
    safeToolCall.arguments &&
    typeof safeToolCall.arguments === "object" &&
    !Array.isArray(safeToolCall.arguments)
      ? safeToolCall.arguments
      : {}
  ) as {
    question?: string;
    options?: Array<{ label: string; description?: string }>;
    allowFreeText?: boolean;
  };
  const question = args.question || "Please provide more information";
  const options = args.options || [];
  const allowFreeText =
    args.allowFreeText !== undefined ? args.allowFreeText : options.length === 0;
  const status = safeToolCall.status ?? "failed";
  const isAnswered = status === "completed" || status === "failed";

  const handleSubmit = (text: string) => {
    if (!text.trim()) return;
    if (typeof safeToolCall.id === "string") onAnswer?.(safeToolCall.id, text.trim());
  };

  // Already answered
  if (isAnswered) {
    const answer = (safeToolCall.result as { answer?: string })?.answer;
    return (
      <div className="border border-border bg-muted/30 my-1.5 px-3 py-2">
        <p className="text-sm text-muted-foreground">{question}</p>
        {answer && <p className="text-sm mt-1">→ {answer}</p>}
      </div>
    );
  }

  // Not yet active (e.g. still processing on backend)
  if (status !== "awaiting_approval" && status !== "running") {
    return (
      <div className="border border-border bg-muted/30 my-1.5 px-3 py-2">
        <p className="text-sm text-muted-foreground">{question}</p>
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground mt-1" />
      </div>
    );
  }

  return (
    <div className="bg-primary/5">
      <div className="px-3 py-2 border-b border-border">
        <p className="text-sm font-medium">{question}</p>
      </div>

      {options.length > 0 && (
        <div>
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => handleSubmit(opt.label)}
              className="w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors border-b border-border last:border-b-0"
            >
              <span>{opt.label}</span>
              {opt.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {(allowFreeText || options.length === 0) && (
        <div className="border-t border-border px-3 py-2">
          <div className="relative flex">
            <input
              type="text"
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit(answerText);
              }}
              placeholder={options.length > 0 ? "Or type your answer..." : "Type your answer..."}
              className="w-full bg-background border border-input px-2.5 py-1.5 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
            <button
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={!answerText.trim()}
              onClick={() => handleSubmit(answerText)}
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
