// ── AI Tool Call ──

export type ToolActionType = "create" | "edit" | "delete" | "other";

export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: "running" | "completed" | "failed" | "awaiting_approval" | "rejected";
  result?: unknown;
  error?: string;
}

// ── AI Message ──

export interface AIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: AIToolCall[];
  isStreaming?: boolean;
  localOnly?: boolean;
  rawToolCalls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}

// ── AI Configuration ──

export type WebSearchProvider = "tavily" | "brave" | "serper" | "searxng" | "exa";

export interface AIConfig {
  enabled: boolean;
  providerUrl: string;
  model: string;
  maxCompletionTokens: number;
  maxTokensField: "max_tokens" | "max_completion_tokens";
  reasoningEffort: "low" | "medium" | "high" | "none";
  customSystemPrompt: string;
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
  maxToolRounds: number;
  maxContextTokens: number;
  disabledTools: string[];
  webSearchEnabled: boolean;
  webSearchProvider: WebSearchProvider;
  webSearchBaseUrl: string;
  hasApiKey: boolean;
  apiKeyLast4: string;
  hasWebSearchKey: boolean;
}

// ── Page Context ──

export interface PageContext {
  route: string;
  resourceType?: string;
  resourceId?: string;
}

// ── Quick Action ──

export interface QuickAction {
  label: string;
  prompt: string;
}

// ── Chat Message (for API) ──

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

// ── WebSocket Messages ──

export type WSClientMessage =
  | { type: "chat"; requestId: string; messages: ChatMessage[]; context?: PageContext }
  | {
      type: "tool_approval";
      requestId: string;
      toolCallId: string;
      approved: boolean;
      answer?: string;
      answers?: Record<string, string>;
    }
  | { type: "cancel"; requestId: string }
  | { type: "ping" };

export type WSServerMessage =
  | { type: "auth_ok"; userId: string }
  | { type: "auth_error"; message: string }
  | { type: "text_delta"; requestId: string; content: string }
  | {
      type: "tool_call_start";
      requestId: string;
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: "tool_approval_required";
      requestId: string;
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      requestId: string;
      id: string;
      name: string;
      result: unknown;
      error?: string;
    }
  | { type: "invalidate_stores"; requestId: string; stores: string[] }
  | { type: "done"; requestId: string }
  | { type: "error"; requestId: string; message: string; code?: string }
  | { type: "rate_limited"; retryAfter: number }
  | { type: "pong" };

// ── Tool definition (from admin API) ──

export interface AIToolDef {
  name: string;
  description: string;
  destructive: boolean;
  requiredRole: string;
}
