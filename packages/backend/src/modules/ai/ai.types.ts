import type { UserRole } from '@/types.js';

// ── AI Configuration (stored in settings table) ──

export type WebSearchProvider = 'tavily' | 'brave' | 'serper' | 'searxng' | 'exa';

export type MaxTokensField = 'max_tokens' | 'max_completion_tokens';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'none';

export interface AIConfig {
  enabled: boolean;
  providerUrl: string;
  model: string;
  maxCompletionTokens: number;
  maxTokensField: MaxTokensField;
  reasoningEffort: ReasoningEffort;
  customSystemPrompt: string;
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
  maxToolRounds: number;
  disabledTools: string[];
  webSearchEnabled: boolean;
  webSearchProvider: WebSearchProvider;
  webSearchBaseUrl: string;
}

export interface EncryptedValue {
  encryptedKey: string;
  encryptedDek: string;
}

// ── Tool Definitions ──

export interface AIToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  destructive: boolean;
  category: string;
  requiredRole: UserRole;
  invalidateStores: string[];
}

// ── Page Context (from frontend) ──

export interface PageContext {
  route: string;
  resourceType?: string;
  resourceId?: string;
}

// ── Chat Messages (OpenAI-compatible) ──

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

// ── WebSocket Protocol ──

export type WSClientMessage =
  | { type: 'chat'; requestId: string; messages: ChatMessage[]; context?: PageContext }
  | {
      type: 'tool_approval';
      requestId: string;
      toolCallId: string;
      approved: boolean;
      answer?: string;
      answers?: Record<string, string>;
    }
  | { type: 'cancel'; requestId: string }
  | { type: 'ping' };

export type WSServerMessage =
  | { type: 'auth_ok'; userId: string }
  | { type: 'auth_error'; message: string }
  | { type: 'text_delta'; requestId: string; content: string }
  | { type: 'tool_call_start'; requestId: string; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_approval_required'; requestId: string; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; requestId: string; id: string; name: string; result: unknown; error?: string }
  | { type: 'invalidate_stores'; requestId: string; stores: string[] }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; message: string; code?: string }
  | { type: 'rate_limited'; retryAfter: number }
  | { type: 'pong' };

// ── AI Question (ask_question tool) ──

export interface AIQuestionOption {
  label: string;
  description?: string;
}

export interface AIQuestion {
  questionId: string;
  question: string;
  options?: AIQuestionOption[];
  allowFreeText: boolean;
}

// ── Tool Execution Result ──

export interface ToolExecutionResult {
  result?: unknown;
  error?: string;
  invalidateStores: string[];
}
