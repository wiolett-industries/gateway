// ── AI Tool Call ──

export type ToolActionType = "read" | "create" | "edit" | "delete" | "other";

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
  compactMarker?: boolean;
  rawToolCalls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}

// ── AI Configuration ──

export type WebSearchProvider = "tavily" | "brave" | "serper" | "searxng" | "exa";
export type AIEndpointMode = "auto" | "chat_completions" | "responses";

export interface AIConfig {
  enabled: boolean;
  providerUrl: string;
  endpointMode: AIEndpointMode;
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
  sandboxEnabled: boolean;
  sandboxDefaultTier: "low" | "medium" | "high";
  hasApiKey: boolean;
  apiKeyLast4: string;
  hasWebSearchKey: boolean;
  webSearchApiKeyLast4: string;
}

export interface AISandboxStatus {
  state: "stopped" | "starting" | "running" | "unavailable";
  socketPath?: string;
  pid?: number;
  lastError?: string;
}

export interface AISandboxJob {
  id: string;
  userId: string;
  conversationId: string | null;
  kind: "script" | "process";
  runtime: "alpine" | "node" | "python";
  resourceTier: "low" | "medium" | "high";
  requestedTtlSeconds: number;
  effectiveTtlSeconds: number;
  requiredScopes: string[];
  status: "queued" | "running" | "exited" | "killed" | "timeout" | "failed" | "revoked" | "expired";
  containerId: string | null;
  exitCode: number | null;
  outputBytes: number;
  revocationReason: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  updatedAt: string;
}

export interface AISandboxOutput {
  processId: string;
  output: string;
  outputBytes: number;
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
  | {
      type: "chat";
      requestId: string;
      messages: ChatMessage[];
      context?: PageContext;
      conversationId?: string;
    }
  | {
      type: "tool_approval";
      requestId: string;
      toolCallId: string;
      approved: boolean;
      conversationId?: string;
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
