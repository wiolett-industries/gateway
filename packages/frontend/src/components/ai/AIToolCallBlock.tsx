import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Loader2,
  Send,
  ShieldCheck,
  Globe,
  Lock,
  Users,
  X,
  Search,
  FileText,
  Shield,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AIToolCall } from "@/types/ai";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  list_cas: ShieldCheck, get_ca: ShieldCheck, create_root_ca: ShieldCheck,
  create_intermediate_ca: ShieldCheck, delete_ca: ShieldCheck,
  list_certificates: FileText, get_certificate: FileText, issue_certificate: FileText,
  revoke_certificate: FileText, list_templates: FileText, create_template: FileText,
  delete_template: FileText,
  list_proxy_hosts: Globe, get_proxy_host: Globe, create_proxy_host: Globe,
  update_proxy_host: Globe, delete_proxy_host: Globe,
  list_ssl_certificates: Lock, request_acme_cert: Lock, link_internal_cert: Lock,
  list_domains: Globe, create_domain: Globe, delete_domain: Globe,
  list_access_lists: Shield, create_access_list: Shield, delete_access_list: Shield,
  list_users: Users, update_user_role: Users, get_audit_log: Users,
  get_dashboard_stats: Users,
  web_search: Search,
  internal_documentation: BookOpen,
  ask_question: HelpCircle,
};

interface AIToolCallBlockProps {
  toolCall: AIToolCall;
  onApprove?: (toolCallId: string) => void;
  onReject?: (toolCallId: string) => void;
  onAnswer?: (toolCallId: string, answer: string) => void;
}

export function AIToolCallBlock({ toolCall, onApprove, onReject }: AIToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = CATEGORY_ICONS[toolCall.name] || ShieldCheck;

  const statusIcon = () => {
    switch (toolCall.status) {
      case "running":
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
      case "completed":
        return <Check className="h-3.5 w-3.5 text-green-500" />;
      case "failed":
        return <X className="h-3.5 w-3.5 text-destructive" />;
      case "awaiting_approval":
        return <div className="h-3.5 w-3.5 bg-yellow-500 animate-pulse" />;
      case "rejected":
        return <X className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const isSkipped = toolCall.result && typeof toolCall.result === "object" && "skipped" in (toolCall.result as Record<string, unknown>);
  const toolLabel = toolCall.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) + (isSkipped ? " (skipped)" : "");

  const hasArgs = Object.keys(toolCall.arguments).length > 0;
  const hasResult = toolCall.result !== undefined && !isSkipped;
  const hasError = !!toolCall.error;
  const hasContent = hasArgs || hasResult || hasError || toolCall.status === "rejected";

  return (
    <div className="border border-border bg-muted/30 text-xs my-1.5">
      <button
        onClick={hasContent ? () => setExpanded(!expanded) : undefined}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${hasContent ? "hover:bg-muted/50 cursor-pointer" : "cursor-default"}`}
      >
        {hasContent ? (
          expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className={`flex-1 truncate font-medium ${isSkipped ? "text-muted-foreground" : ""}`}>{toolLabel}</span>
        {!isSkipped && statusIcon()}
      </button>

      {toolCall.status === "awaiting_approval" && toolCall.name !== "ask_question" && (
        <div className="flex items-center gap-2 px-2.5 py-2 border-t border-border bg-yellow-500/5">
          <span className="flex-1 text-yellow-600 dark:text-yellow-400 text-xs">
            This action requires your approval
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={(e) => { e.stopPropagation(); onReject?.(toolCall.id); }}
          >
            Reject
          </Button>
          <Button
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={(e) => { e.stopPropagation(); onApprove?.(toolCall.id); }}
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
            <pre className="text-[11px] bg-muted px-2.5 py-1.5 overflow-x-auto whitespace-pre-wrap border-t border-border">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          )}
          {hasResult && (
            <pre className="text-[11px] bg-muted/50 px-2.5 py-1.5 overflow-x-auto whitespace-pre-wrap max-h-48 border-t border-border">
              {typeof toolCall.result === "string" ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}
            </pre>
          )}
          {hasError && (
            <p className="text-destructive px-2.5 py-1.5 border-t border-border">{toolCall.error}</p>
          )}
          {toolCall.status === "rejected" && (
            <p className="text-muted-foreground italic px-2.5 py-1.5 border-t border-border">Rejected by user</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function QuestionBlock({ toolCall, onAnswer }: { toolCall: AIToolCall; onAnswer?: (id: string, answer: string) => void }) {
  const [answerText, setAnswerText] = useState("");
  const args = toolCall.arguments as { question?: string; options?: Array<{ label: string; description?: string }>; allowFreeText?: boolean };
  const question = args.question || "Please provide more information";
  const options = args.options || [];
  const allowFreeText = args.allowFreeText !== undefined ? args.allowFreeText : options.length === 0;
  const isAnswered = toolCall.status === "completed" || toolCall.status === "failed";

  const handleSubmit = (text: string) => {
    if (!text.trim()) return;
    onAnswer?.(toolCall.id, text.trim());
  };

  // Already answered
  if (isAnswered) {
    const answer = (toolCall.result as { answer?: string })?.answer;
    return (
      <div className="border border-border bg-muted/30 my-1.5 px-3 py-2">
        <p className="text-sm text-muted-foreground">{question}</p>
        {answer && <p className="text-sm mt-1">→ {answer}</p>}
      </div>
    );
  }

  // Not yet active (e.g. still processing on backend)
  if (toolCall.status !== "awaiting_approval" && toolCall.status !== "running") {
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
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(answerText); }}
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
