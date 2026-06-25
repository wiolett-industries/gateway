import { create } from "zustand";
import {
  type AIConversationSummary,
  compactConversation,
  deleteConversation,
  getConversation,
  listConversations,
  saveConversation,
} from "@/services/ai-conversations";
import { AIWebSocketClient } from "@/services/ai-websocket";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useCAStore } from "@/stores/ca";
import { useCertificatesStore } from "@/stores/certificates";
import { useDockerStore } from "@/stores/docker";
import { useFolderStore } from "@/stores/folders";
import { useNodesStore } from "@/stores/nodes";
import { useProxyStore } from "@/stores/proxy";
import { useSSLStore } from "@/stores/ssl";
import { useUIStore } from "@/stores/ui";
import type {
  AIConfig,
  AIConversationStatus,
  AIMessage,
  AIToolCall,
  ChatMessage,
  PageContext,
  ToolActionType,
  WSServerMessage,
} from "@/types/ai";

const DEFAULT_CONTEXT_TOKEN_LIMIT = 56000;
const DEFAULT_REASONING_EFFORT: AIConfig["reasoningEffort"] = "none";

async function resolveContextSettings(): Promise<{
  limit: number;
  source: "settings" | "fallback";
  reasoningEffort: AIConfig["reasoningEffort"];
}> {
  const cached = api.getCached<AIConfig>("settings:ai-config");
  if (cached?.maxContextTokens) {
    return {
      limit: cached.maxContextTokens,
      source: "settings",
      reasoningEffort: cached.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    };
  }

  try {
    const config = (await api.getAIConfig()) as unknown as AIConfig;
    api.setCache("settings:ai-config", config);
    if (config.maxContextTokens) {
      return {
        limit: config.maxContextTokens,
        source: "settings",
        reasoningEffort: config.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
      };
    }
  } catch {
    // Fall through to the legacy estimate when settings are unavailable.
  }

  return {
    limit: DEFAULT_CONTEXT_TOKEN_LIMIT,
    source: "fallback",
    reasoningEffort: DEFAULT_REASONING_EFFORT,
  };
}

const CREATE_OPERATIONS = new Set([
  "create",
  "clone",
  "upload",
  "issue_from_csr",
  "insert_row",
  "add_column",
  "create_secret",
  "create_update",
  "activate",
  "mkdir",
  "upload_init",
]);
const READ_OPERATIONS = new Set([
  "list",
  "read",
  "get",
  "get_config",
  "get_gateway_release_notes",
  "get_gateway_status",
  "get_history",
  "get_stats",
  "check",
  "check_daemon_updates",
  "check_gateway",
  "search",
  "facets",
  "metadata",
  "preview",
  "health_history",
  "list_schemas",
  "list_tables",
  "table_metadata",
  "browse_rows",
  "scan_keys",
  "get_key",
  "get_env",
  "list_files",
  "list_daemon_updates",
  "read_file",
  "list_secrets",
  "get_webhook",
  "get_health_check",
  "chain",
  "export",
  "reveal_credentials",
  "test",
  "test_direct",
]);
const EDIT_OPERATIONS = new Set([
  "update",
  "update_config",
  "update_daemon",
  "update_scopes",
  "run",
  "renew",
  "verify_dns",
  "check_dns",
  "connect",
  "disconnect",
  "resolve",
  "promote",
  "write_file",
  "update_env",
  "update_secret",
  "upsert_webhook",
  "regenerate_webhook_token",
  "upsert_health_check",
  "test_health_check",
  "perform_gateway_update",
  "update_row",
  "update_column_type",
  "set_key",
  "expire_key",
  "execute_command",
  "move",
  "move_folder",
  "move_resources",
  "reorder_folders",
  "reorder_resources",
  "upload_abort",
  "upload_chunk",
  "upload_complete",
  "write",
]);
const DELETE_OPERATIONS = new Set([
  "delete",
  "delete_by_title",
  "clear",
  "delete_secret",
  "delete_webhook",
  "delete_row",
  "delete_column",
  "delete_key",
  "revoke",
]);
const READ_TOOL_NAMES = new Set([
  "discover_tools",
  "fetch",
  "find_resource",
  "get_ai_settings",
  "get_current_context",
  "get_gateway_settings",
  "get_license_status",
  "get_sandbox_runtime_status",
  "internal_documentation",
  "list_ai_tools",
  "list_sandbox_jobs",
  "read_artifact",
  "read_process_output",
  "wait",
  "web_search",
]);
const CREATE_TOOL_NAMES = new Set([
  "duplicate_docker_container",
  "link_internal_cert",
  "send_artifact",
]);
const EDIT_TOOL_NAMES = new Set([
  "deploy_docker_deployment",
  "download_artifact",
  "execute_postgres_sql",
  "execute_redis_command",
  "kill_docker_deployment",
  "move_hosts_to_folder",
  "rename_docker_container",
  "rename_node",
  "rollback_docker_deployment",
  "set_user_blocked",
  "set_redis_key",
  "switch_docker_deployment_slot",
  "test_webhook",
  "toggle_proxy_raw_mode",
  "update_ai_settings",
  "update_gateway_settings",
]);
const DELETE_TOOL_NAMES = new Set([
  "execute_script",
  "kill_process",
  "prune_docker_images",
  "run_process",
  "write_process_stdin",
]);

function getOperationActionType(operation: string): ToolActionType {
  if (READ_OPERATIONS.has(operation)) return "read";
  if (CREATE_OPERATIONS.has(operation)) return "create";
  if (EDIT_OPERATIONS.has(operation)) return "edit";
  if (DELETE_OPERATIONS.has(operation)) return "delete";
  return "other";
}

function getToolActionType(toolName: string, args?: Record<string, unknown>): ToolActionType {
  if (toolName === "ask_question") return "other";
  const operation = typeof args?.operation === "string" ? args.operation : "";
  if (toolName.startsWith("manage_") && operation) {
    return getOperationActionType(operation);
  }
  if (READ_TOOL_NAMES.has(toolName)) return "read";
  if (CREATE_TOOL_NAMES.has(toolName)) return "create";
  if (EDIT_TOOL_NAMES.has(toolName)) return "edit";
  if (DELETE_TOOL_NAMES.has(toolName)) return "delete";
  if (
    toolName.startsWith("list_") ||
    toolName.startsWith("get_") ||
    toolName.startsWith("query_") ||
    toolName.startsWith("browse_")
  ) {
    return "read";
  }
  if (toolName === "pull_docker_image") return "create";
  if (
    toolName.startsWith("create_") ||
    toolName.startsWith("issue_") ||
    toolName.startsWith("request_")
  )
    return "create";
  if (
    toolName.startsWith("update_") ||
    toolName.startsWith("revoke_") ||
    toolName.startsWith("start_") ||
    toolName.startsWith("stop_") ||
    toolName.startsWith("restart_")
  )
    return "edit";
  if (toolName.startsWith("delete_") || toolName.startsWith("remove_")) return "delete";
  return "edit";
}

function shouldAutoApprove(toolName: string, args?: Record<string, unknown>): boolean {
  const ui = useUIStore.getState();
  if (ui.aiAlwaysAskApprovals) return false;
  const action = getToolActionType(toolName, args);
  if (action === "read") return true;
  if (action === "create" && ui.aiBypassCreateApprovals) return true;
  if (action === "edit" && ui.aiBypassEditApprovals) return true;
  if (action === "delete" && ui.aiBypassDeleteApprovals) return true;
  return false;
}

function invalidateStore(storeName: string): void {
  switch (storeName) {
    case "ca":
      api.invalidateCache("req:/api/cas");
      api.invalidateCache("cas:list:");
      api.invalidateCache("req:/api/monitoring/dashboard");
      api.invalidateCache("dashboard:stats:");
      useCAStore.getState().fetchCAs();
      break;
    case "certificates":
      api.invalidateCache("req:/api/certificates");
      api.invalidateCache("certificates:list:");
      api.invalidateCache("req:/api/monitoring/dashboard");
      api.invalidateCache("dashboard:stats:");
      useCertificatesStore.getState().fetchCertificates();
      break;
    case "ssl":
      api.invalidateCache("req:/api/ssl-certificates");
      api.invalidateCache("ssl:list:");
      api.invalidateCache("req:/api/monitoring/dashboard");
      api.invalidateCache("dashboard:stats:");
      useSSLStore.getState().fetchCertificates();
      break;
    case "proxy":
      api.invalidateCache("req:/api/proxy-hosts");
      api.invalidateCache("req:/api/proxy-host-folders/grouped");
      api.invalidateCache("proxy:grouped");
      api.invalidateCache("req:/api/domains");
      api.invalidateCache("domains:list");
      api.invalidateCache("req:/api/monitoring/dashboard");
      api.invalidateCache("req:/api/monitoring/health-status");
      api.invalidateCache("dashboard:stats:");
      api.invalidateCache("dashboard:health");
      useProxyStore.getState().fetchProxyHosts();
      useFolderStore.getState().fetchGroupedHosts();
      break;
    case "templates":
      api.invalidateCache("req:/api/templates");
      api.invalidateCache("templates");
      break;
    case "domains":
      api.invalidateCache("req:/api/domains");
      api.invalidateCache("domains");
      break;
    case "accessLists":
      api.invalidateCache("req:/api/access-lists");
      api.invalidateCache("access-lists:list");
      break;
    case "nodes":
      api.invalidateCache("req:/api/nodes");
      api.invalidateCache("req:/api/monitoring/dashboard");
      api.invalidateCache("dashboard:stats:");
      useNodesStore.getState().fetchNodes();
      break;
    case "groups":
      api.invalidateCache("req:/api/admin/groups");
      api.invalidateCache("req:/api/admin/users");
      api.invalidateCache("admin:users");
      break;
    case "users":
      api.invalidateCache("req:/api/admin/users");
      api.invalidateCache("admin:users");
      break;
    case "containers":
      useDockerStore.getState().invalidate("containers");
      break;
    case "images":
      useDockerStore.getState().invalidate("images");
      break;
    case "volumes":
      useDockerStore.getState().invalidate("volumes");
      break;
    case "networks":
      useDockerStore.getState().invalidate("networks");
      break;
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function compactToolResultForModel(toolName: string, value: unknown): unknown {
  if (value == null) return value;
  if (toolName === "get_docker_container_logs")
    return compactLogLikeResult(value, "Docker container logs");
  if (toolName === "send_artifact" && typeof value === "object" && value !== null) {
    const { artifactId, filename, mediaType, sizeBytes, sourcePath, downloadUrl } = value as Record<
      string,
      unknown
    >;
    return { artifactId, filename, mediaType, sizeBytes, sourcePath, downloadUrl };
  }
  if (
    (toolName === "fetch" || toolName === "read_artifact") &&
    typeof value === "object" &&
    value !== null &&
    typeof (value as { content?: unknown }).content === "string" &&
    (value as { content: string }).content.length > 4000
  ) {
    const content = (value as { content: string }).content;
    return {
      ...(value as Record<string, unknown>),
      content: undefined,
      contentPreview: content.slice(0, 2000),
      contentOmitted: true,
    };
  }
  if (
    toolName === "manage_logging" &&
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { rows?: unknown }).rows)
  ) {
    return compactLogLikeResult(
      (value as { rows: unknown[] }).rows,
      "Structured log search results"
    );
  }
  if (typeof value === "string" && value.length > 4000) {
    return compactLogText(value, "Large text tool output");
  }
  if (Array.isArray(value) && value.length > 25) {
    return {
      summary: `Large array tool output omitted from model context (${value.length} items).`,
      count: value.length,
      sample: [...value.slice(0, 5), ...value.slice(-5)],
      fullOutputOmitted: true,
    };
  }
  return value;
}

function compactLogLikeResult(value: unknown, label: string): unknown {
  if (typeof value === "string") return compactLogText(value, label);
  if (!Array.isArray(value)) return value;
  return {
    summary: `${label} omitted from model context (${value.length} entries).`,
    count: value.length,
    sample: [...value.slice(0, 3), ...value.slice(-5)],
    fullOutputOmitted: true,
  };
}

function compactLogText(value: string, label: string): unknown {
  const lines = value.split(/\r?\n/).filter(Boolean);
  return {
    summary: `${label} omitted from model context (${lines.length} lines, ${value.length} chars).`,
    lineCount: lines.length,
    sample: [...lines.slice(0, 3), ...lines.slice(-5)],
    fullOutputOmitted: true,
  };
}

interface AIState {
  messages: AIMessage[];
  recentConversations: AIConversationSummary[];
  isLoadingRecentConversations: boolean;
  isStreaming: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  isEnabled: boolean | null;
  retryAfter: number | null;
  savedName: string | null;
  activeConversationId: string | null;
  lastContext: PageContext | null;
  pendingApprovalToolCallId: string | null;

  // Actions
  connect: () => Promise<boolean>;
  disconnect: () => void;
  sendMessage: (
    content: string,
    context?: PageContext,
    attachments?: AIMessage["attachments"]
  ) => void;
  approveTool: (toolCallId: string) => void;
  rejectTool: (toolCallId: string) => void;
  answerQuestion: (toolCallId: string, answer: string) => void;
  stopStreaming: () => void;
  clearMessages: () => void;
  fetchRecentConversations: () => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  clearOldestConversationContext: () => void;
  rollbackToMessage: (messageId: string) => AIMessage | null;
  setEnabled: (enabled: boolean) => void;
  handleSlashCommand: (input: string) => Promise<boolean>;
  setMessages: (messages: AIMessage[]) => void;
}

let wsClient: AIWebSocketClient | null = null;
let currentRequestId: string | null = null;
let retryTimer: ReturnType<typeof setInterval> | null = null;

function titleFromContent(content: string): string {
  const title = content.trim().replace(/\s+/g, " ").slice(0, 48);
  return title || "New conversation";
}

function userMessagesAfterLastCompact(messages: AIMessage[]): number {
  const lastCompactIndex = messages.reduce(
    (latest, message, index) => (message.compactMarker ? index : latest),
    -1
  );
  return messages.slice(lastCompactIndex + 1).filter((message) => message.role === "user").length;
}

export interface AIConversationBlock {
  status: Exclude<AIConversationStatus, "active">;
  reason: string;
}

export function getConversationBlock(messages: AIMessage[]): AIConversationBlock | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.conversationStatus) {
      return {
        status: message.conversationStatus,
        reason: message.blockReason || "This conversation cannot continue.",
      };
    }
  }
  return null;
}

function createConversationStatusMarker(
  status: Exclude<AIConversationStatus, "active">,
  reason: string
): AIMessage {
  return {
    id: generateId(),
    role: "assistant",
    content: "",
    createdAt: nowIso(),
    conversationStatus: status,
    blockReason: reason,
  };
}

async function ensureActiveConversation(
  content: string,
  messages: AIMessage[],
  context?: PageContext
): Promise<string | null> {
  const state = useAIStore.getState();
  if (state.activeConversationId) return state.activeConversationId;

  const title = state.savedName ?? titleFromContent(content);
  try {
    const saved = await saveConversation(
      title,
      messages.filter((message) => !message.localOnly),
      context ?? state.lastContext
    );
    useAIStore.setState({
      activeConversationId: saved.id,
      savedName: saved.title,
      lastContext: saved.lastContext ?? context ?? state.lastContext,
    });
    void useAIStore.getState().fetchRecentConversations();
    return saved.id;
  } catch {
    return null;
  }
}

async function persistActiveConversationSnapshot(): Promise<void> {
  const state = useAIStore.getState();
  const conversationId = state.activeConversationId;
  if (!conversationId) return;

  const messages = state.messages.filter((message) => !message.localOnly);

  try {
    const saved = await compactConversation(conversationId, messages, state.lastContext);
    if (useAIStore.getState().activeConversationId === conversationId) {
      useAIStore.setState({
        savedName: saved.title,
        lastContext: saved.lastContext,
      });
    }
    void useAIStore.getState().fetchRecentConversations();
  } catch {
    // Keep the live chat intact; a later message or explicit compact can retry persistence.
  }
}

function buildChatMessages(messages: AIMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.localOnly || msg.conversationStatus) continue;
    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content, attachments: msg.attachments });
    } else if (msg.role === "assistant") {
      const chatMsg: ChatMessage = { role: "assistant", content: msg.content || null };

      // Build tool_calls from rawToolCalls or reconstruct from toolCalls
      if (msg.rawToolCalls?.length) {
        chatMsg.tool_calls = msg.rawToolCalls as ChatMessage["tool_calls"];
      } else if (msg.toolCalls?.length) {
        chatMsg.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
      }

      result.push(chatMsg);

      // Add tool results after the assistant message
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (tc.status === "completed" || tc.status === "failed" || tc.status === "rejected") {
            const content = tc.error
              ? JSON.stringify({ error: tc.error })
              : tc.result !== undefined
                ? JSON.stringify(compactToolResultForModel(tc.name, tc.result))
                : "{}";
            result.push({
              role: "tool",
              tool_call_id: tc.id,
              content,
              name: tc.name,
            });
          }
        }
      }
    }
  }
  return result;
}

export interface AIContextUsage {
  messageCount: number;
  estimatedTokens: number;
  limit: number;
  percent: number;
  chatTokens: number;
  overheadTokens: number;
  source: "settings" | "fallback";
  reasoningEffort: AIConfig["reasoningEffort"];
}

export async function getAIContextUsage(messages: AIMessage[]): Promise<AIContextUsage> {
  const chatMessages = buildChatMessages(messages);
  const charCount = chatMessages.reduce((sum, message) => sum + (message.content?.length || 0), 0);
  const chatTokens = Math.ceil(charCount / 4);
  const overheadTokens = 3000;
  const estimatedTokens = chatTokens + overheadTokens;
  const { limit, source, reasoningEffort } = await resolveContextSettings();

  return {
    messageCount: chatMessages.length,
    estimatedTokens,
    limit,
    percent: Math.round((estimatedTokens / limit) * 100),
    chatTokens,
    overheadTokens,
    source,
    reasoningEffort,
  };
}

export const useAIStore = create<AIState>()((set, get) => ({
  messages: [],
  recentConversations: [],
  isLoadingRecentConversations: false,
  isStreaming: false,
  isConnected: false,
  isConnecting: false,
  connectionError: null,
  isEnabled: null,
  retryAfter: null,
  savedName: null,
  activeConversationId: null,
  lastContext: null,
  pendingApprovalToolCallId: null,

  connect: async () => {
    const auth = useAuthStore.getState();
    if (!auth.user && auth.isLoading) {
      set({ isConnecting: true, connectionError: null });
      return false;
    }
    if (!auth.user) {
      set({ isConnecting: false, connectionError: "Not authenticated" });
      return false;
    }
    if (wsClient?.isConnected) {
      set({ isConnected: true, isConnecting: false, connectionError: null });
      return true;
    }
    if (wsClient && get().isConnecting) {
      return false;
    }
    if (wsClient) {
      wsClient.disconnect();
      wsClient = null;
    }

    wsClient = new AIWebSocketClient();
    set({ isConnecting: true, connectionError: null });
    wsClient.onMessage((msg: WSServerMessage) => {
      handleWSMessage(msg, set, get);
    });
    wsClient.onStatusChange((connected) => {
      set({
        isConnected: connected,
        isConnecting: false,
        connectionError: connected ? null : get().connectionError,
      });
      if (!connected) set({ isStreaming: false });
    });
    wsClient.onConnectionError((message) => {
      set({ connectionError: message, isConnecting: false });
    });

    const ok = await wsClient.connect();
    if (!ok) {
      set((state) => ({
        isConnecting: false,
        isConnected: false,
        connectionError:
          state.connectionError ??
          (useAuthStore.getState().isLoading ? null : "AI connection failed"),
      }));
    }
    return ok;
  },

  disconnect: () => {
    wsClient?.disconnect();
    wsClient = null;
    set({ isConnected: false, isConnecting: false, connectionError: null, isStreaming: false });
  },

  sendMessage: (
    content: string,
    context?: PageContext,
    attachments: AIMessage["attachments"] = []
  ) => {
    const { messages } = get();
    if (getConversationBlock(messages)) return;

    const userMsg: AIMessage = {
      id: generateId(),
      role: "user",
      content,
      attachments,
      createdAt: nowIso(),
    };

    const assistantMsg: AIMessage = {
      id: generateId(),
      role: "assistant",
      content: "",
      createdAt: nowIso(),
      isStreaming: true,
    };

    set({
      messages: [...messages, userMsg, assistantMsg],
      isStreaming: true,
      lastContext: context ?? null,
    });

    const requestId = generateId();
    currentRequestId = requestId;

    const chatMessages = buildChatMessages([...messages, userMsg]);

    void ensureActiveConversation(content, [...messages, userMsg], context).then(
      (conversationId) => {
        wsClient?.send({
          type: "chat",
          requestId,
          messages: chatMessages,
          context,
          conversationId: conversationId ?? undefined,
        });
      }
    );
  },

  approveTool: (toolCallId: string) => {
    if (!currentRequestId) return;
    wsClient?.send({
      type: "tool_approval",
      requestId: currentRequestId,
      toolCallId,
      approved: true,
    });

    // Update tool status
    set((state) => ({
      messages: state.messages.map((msg) => ({
        ...msg,
        toolCalls: msg.toolCalls?.map((tc) =>
          tc.id === toolCallId ? { ...tc, status: "running" as const } : tc
        ),
      })),
    }));
  },

  rejectTool: (toolCallId: string) => {
    if (!currentRequestId) return;
    wsClient?.send({
      type: "tool_approval",
      requestId: currentRequestId,
      toolCallId,
      approved: false,
    });

    set((state) => ({
      messages: state.messages.map((msg) => ({
        ...msg,
        toolCalls: msg.toolCalls?.map((tc) =>
          tc.id === toolCallId ? { ...tc, status: "rejected" as const } : tc
        ),
      })),
    }));
  },

  answerQuestion: (toolCallId: string, answer: string) => {
    if (!currentRequestId) return;

    // Mark this question as answered + promote next question to awaiting_approval
    set((state) => {
      let promoted = false;
      return {
        messages: state.messages.map((msg) => ({
          ...msg,
          toolCalls: msg.toolCalls?.map((tc) => {
            if (tc.id === toolCallId) {
              return { ...tc, status: "completed" as const, result: { answer } };
            }
            // Promote the next running ask_question to awaiting_approval
            if (!promoted && tc.name === "ask_question" && tc.status === "running") {
              promoted = true;
              return { ...tc, status: "awaiting_approval" as const };
            }
            return tc;
          }),
        })),
      };
    });

    // Check if there are more unanswered questions in the same batch
    // (questions that are still "running" — not yet promoted/answered)
    const { messages: msgs } = get();
    const msg = msgs.find((m) => m.toolCalls?.some((tc) => tc.id === toolCallId));
    const pendingQuestions =
      msg?.toolCalls?.filter(
        (tc) =>
          tc.name === "ask_question" &&
          (tc.status === "running" || tc.status === "awaiting_approval")
      ) || [];

    if (pendingQuestions.length === 0) {
      // All questions in this batch answered — send all answers
      const allQuestions = msg?.toolCalls?.filter((tc) => tc.name === "ask_question") || [];
      const answers: Record<string, string> = {};
      for (const tc of allQuestions) {
        const ans = (tc.result as { answer?: string })?.answer;
        if (ans) answers[tc.id] = ans;
      }
      // Use the toolCallId that the backend is actually pending on
      const backendPendingId = get().pendingApprovalToolCallId || toolCallId;
      wsClient?.send({
        type: "tool_approval",
        requestId: currentRequestId,
        toolCallId: backendPendingId,
        approved: true,
        answers,
      });
      set({ pendingApprovalToolCallId: null });
    }
  },

  stopStreaming: () => {
    if (currentRequestId) {
      wsClient?.send({ type: "cancel", requestId: currentRequestId });
    }
    set((state) => ({
      isStreaming: false,
      messages: state.messages.map((msg) =>
        msg.isStreaming ? { ...msg, isStreaming: false } : msg
      ),
    }));
  },

  clearMessages: () => {
    set({ messages: [], savedName: null, activeConversationId: null, lastContext: null });
    void get().fetchRecentConversations();
  },

  clearOldestConversationContext: () => {
    const state = get();
    const persistedMessages = state.messages.filter(
      (message) => !message.localOnly && !message.conversationStatus
    );
    if (persistedMessages.length === 0) {
      set({ messages: [], savedName: null, activeConversationId: null, lastContext: null });
      return;
    }
    const dropCount = Math.max(1, Math.floor(persistedMessages.length * 0.4));
    const compactMarker: AIMessage = {
      id: generateId(),
      role: "assistant",
      content: "Oldest context was cleared. You can continue this chat.",
      createdAt: nowIso(),
      localOnly: true,
      compactMarker: true,
    };
    set({ messages: [...persistedMessages.slice(dropCount), compactMarker] });
    void persistActiveConversationSnapshot();
  },

  fetchRecentConversations: async () => {
    if (!useAuthStore.getState().user) return;
    set({ isLoadingRecentConversations: true });
    try {
      const conversations = await listConversations(5);
      set({ recentConversations: conversations, isLoadingRecentConversations: false });
    } catch {
      set({ isLoadingRecentConversations: false });
    }
  },

  loadConversation: async (conversationId: string) => {
    try {
      const conversation = await getConversation(conversationId);
      set({
        messages: conversation.messages,
        savedName: conversation.title,
        activeConversationId: conversation.id,
        lastContext: conversation.lastContext,
      });
    } catch {
      const localMsg: AIMessage = {
        id: generateId(),
        role: "assistant",
        content: "Failed to load conversation.",
        createdAt: nowIso(),
        localOnly: true,
      };
      set((state) => ({ messages: [...state.messages, localMsg] }));
    }
  },

  deleteConversation: async (conversationId: string) => {
    try {
      await deleteConversation(conversationId);
      set((state) => ({
        recentConversations: state.recentConversations.filter(
          (conversation) => conversation.id !== conversationId
        ),
        ...(state.activeConversationId === conversationId
          ? { messages: [], savedName: null, activeConversationId: null, lastContext: null }
          : {}),
      }));
      void get().fetchRecentConversations();
    } catch {
      const localMsg: AIMessage = {
        id: generateId(),
        role: "assistant",
        content: "Failed to delete conversation.",
        createdAt: nowIso(),
        localOnly: true,
      };
      set((state) => ({ messages: [...state.messages, localMsg] }));
    }
  },

  setEnabled: (enabled: boolean) => {
    set({ isEnabled: enabled });
  },

  setMessages: (messages: AIMessage[]) => {
    set({ messages });
  },

  rollbackToMessage: (messageId: string) => {
    const state = get();
    const index = state.messages.findIndex((message) => message.id === messageId);
    const message = index >= 0 ? state.messages[index] : null;
    if (!message || message.role !== "user") return null;

    if (currentRequestId) {
      wsClient?.send({ type: "cancel", requestId: currentRequestId });
      currentRequestId = null;
    }

    set({
      messages: state.messages.slice(0, index),
      isStreaming: false,
      pendingApprovalToolCallId: null,
    });
    void persistActiveConversationSnapshot();
    return message;
  },

  handleSlashCommand: async (input: string): Promise<boolean> => {
    if (get().isStreaming) return true;
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    if (cmd === "/clear" || cmd === "/new") {
      set({ messages: [], savedName: null, activeConversationId: null, lastContext: null });
      void get().fetchRecentConversations();
      return true;
    }

    if (cmd === "/context") {
      const { messages } = get();
      const usage = await getAIContextUsage(messages);
      const sourceNote =
        usage.source === "fallback" ? "\n- Limit source: fallback (AI settings unavailable)" : "";

      const localMsg: AIMessage = {
        id: generateId(),
        role: "assistant",
        content: `**Context Usage**\n- Messages: ${usage.messageCount}\n- Estimated tokens: ${usage.estimatedTokens.toLocaleString()} / ${usage.limit.toLocaleString()} (${usage.percent}%)\n- Chat: ~${usage.chatTokens.toLocaleString()} tokens\n- System overhead: ~${usage.overheadTokens.toLocaleString()} tokens\n- Reasoning: ${usage.reasoningEffort}${sourceNote}`,
        createdAt: nowIso(),
        localOnly: true,
      };
      set((state) => ({ messages: [...state.messages, localMsg] }));
      return true;
    }

    if (cmd === "/compact") {
      const state = get();
      if (userMessagesAfterLastCompact(state.messages) <= 3) return true;
      const messages = state.messages.filter((m) => !m.localOnly);
      if (messages.length === 0) {
        const localMsg: AIMessage = {
          id: generateId(),
          role: "assistant",
          content: "Nothing to compact yet.",
          createdAt: nowIso(),
          localOnly: true,
        };
        set((current) => ({ messages: [...current.messages, localMsg] }));
        return true;
      }

      try {
        const conversation = state.activeConversationId
          ? await compactConversation(state.activeConversationId, messages, state.lastContext)
          : await saveConversation(
              state.savedName ??
                titleFromContent(
                  messages.find((m) => m.role === "user")?.content ?? "New conversation"
                ),
              messages,
              state.lastContext
            );
        const localMsg: AIMessage = {
          id: generateId(),
          role: "assistant",
          content: `Compacted **${conversation.title}**. Full tool outputs are kept for the latest 10 tool calls.`,
          createdAt: nowIso(),
          localOnly: true,
          compactMarker: true,
        };
        set({
          messages: [...conversation.messages, localMsg],
          savedName: conversation.title,
          activeConversationId: conversation.id,
          lastContext: conversation.lastContext,
        });
        void get().fetchRecentConversations();
      } catch {
        const localMsg: AIMessage = {
          id: generateId(),
          role: "assistant",
          content: "Failed to compact conversation.",
          createdAt: nowIso(),
          localOnly: true,
        };
        set((current) => ({ messages: [...current.messages, localMsg] }));
      }
      return true;
    }

    return false;
  },
}));

export function resetAIStateForAuthChange() {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
  currentRequestId = null;
  wsClient?.disconnect();
  wsClient = null;
  useAIStore.setState({
    messages: [],
    recentConversations: [],
    isLoadingRecentConversations: false,
    isStreaming: false,
    isConnected: false,
    isConnecting: false,
    connectionError: null,
    retryAfter: null,
    savedName: null,
    activeConversationId: null,
    lastContext: null,
    pendingApprovalToolCallId: null,
  });
}

function handleWSMessage(
  msg: WSServerMessage,
  set: (partial: Partial<AIState> | ((state: AIState) => Partial<AIState>)) => void,
  get: () => AIState
) {
  switch (msg.type) {
    case "text_delta":
      set((state) => ({
        messages: appendTextDeltaToStreamingAssistant(state.messages, msg.content),
      }));
      break;

    case "tool_call_start": {
      const toolCall: AIToolCall = {
        id: msg.id,
        name: msg.name,
        arguments: msg.arguments,
        status: "running",
      };
      set((state) => ({
        messages: appendToolCallToStreamingAssistant(state.messages, toolCall),
      }));
      break;
    }

    case "tool_approval_required":
      if (shouldAutoApprove(msg.name, msg.arguments)) {
        if (currentRequestId) {
          wsClient?.send({
            type: "tool_approval",
            requestId: currentRequestId,
            toolCallId: msg.id,
            approved: true,
          });
        }
      } else {
        set((state) => ({
          pendingApprovalToolCallId: msg.id,
          messages: state.messages.map((m) =>
            m.isStreaming && m.role === "assistant"
              ? {
                  ...m,
                  toolCalls: (m.toolCalls || []).map((tc) =>
                    tc.id === msg.id ? { ...tc, status: "awaiting_approval" as const } : tc
                  ),
                }
              : m
          ),
        }));
      }
      break;

    case "tool_result":
      set((state) => ({
        messages: state.messages.map((m) =>
          m.role === "assistant" && m.toolCalls?.some((tc) => tc.id === msg.id)
            ? {
                ...m,
                toolCalls: m.toolCalls!.map((tc) =>
                  tc.id === msg.id
                    ? {
                        ...tc,
                        status: msg.error ? ("failed" as const) : ("completed" as const),
                        result: msg.result,
                        error: msg.error,
                      }
                    : tc
                ),
              }
            : m
        ),
      }));
      break;

    case "invalidate_stores":
      for (const store of msg.stores) {
        invalidateStore(store);
      }
      break;

    case "conversation_ended":
      set((state) => ({
        messages: [...state.messages, createConversationStatusMarker("ended", msg.reason)],
      }));
      break;

    case "context_blocked":
      set((state) => ({
        messages: [
          ...state.messages,
          createConversationStatusMarker("context_blocked", msg.reason),
        ],
      }));
      break;

    case "done": {
      set((state) => ({
        isStreaming: false,
        messages: state.messages.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
      }));
      void persistActiveConversationSnapshot();
      currentRequestId = null;
      break;
    }

    case "error":
      set((state) => ({
        messages: state.messages.map((m) =>
          m.isStreaming && m.role === "assistant"
            ? { ...m, content: `${m.content + (m.content ? "\n\n" : "")}**Error:** ${msg.message}` }
            : m
        ),
      }));
      break;

    case "rate_limited":
      set({ retryAfter: msg.retryAfter });
      if (retryTimer) clearInterval(retryTimer);
      retryTimer = setInterval(() => {
        const current = get().retryAfter;
        if (current && current > 1) {
          set({ retryAfter: current - 1 });
        } else {
          set({ retryAfter: null });
          if (retryTimer) clearInterval(retryTimer);
          retryTimer = null;
        }
      }, 1000);
      break;
  }
}

function appendTextDeltaToStreamingAssistant(messages: AIMessage[], content: string): AIMessage[] {
  const lastStreamingIndex = findLastStreamingAssistantIndex(messages);
  if (lastStreamingIndex === -1) {
    return [
      ...messages,
      {
        id: generateId(),
        role: "assistant",
        content,
        createdAt: nowIso(),
        isStreaming: true,
      },
    ];
  }

  return messages.map((message, index) =>
    index === lastStreamingIndex ? { ...message, content: message.content + content } : message
  );
}

function appendToolCallToStreamingAssistant(
  messages: AIMessage[],
  toolCall: AIToolCall
): AIMessage[] {
  const lastStreamingIndex = findLastStreamingAssistantIndex(messages);
  if (lastStreamingIndex === -1) {
    return [
      ...messages,
      {
        id: generateId(),
        role: "assistant",
        content: "",
        createdAt: nowIso(),
        isStreaming: true,
        toolCalls: [toolCall],
      },
    ];
  }

  const current = messages[lastStreamingIndex];
  if (current.content.length > 0) {
    return [
      ...messages.slice(0, lastStreamingIndex),
      { ...current, isStreaming: false },
      ...messages.slice(lastStreamingIndex + 1),
      {
        id: generateId(),
        role: "assistant",
        content: "",
        createdAt: nowIso(),
        isStreaming: true,
        toolCalls: [toolCall],
      },
    ];
  }

  return messages.map((message, index) =>
    index === lastStreamingIndex
      ? { ...message, toolCalls: [...(message.toolCalls || []), toolCall] }
      : message
  );
}

function findLastStreamingAssistantIndex(messages: AIMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.isStreaming) return index;
  }
  return -1;
}

// Auto-manage WS lifecycle based on visible AI surfaces.
// This runs outside React — no component mount/unmount issues.
let prevAIActive = false;
useUIStore.subscribe((state) => {
  const active = state.aiPanelOpen || state.aiLiteMode;
  if (active !== prevAIActive) {
    prevAIActive = active;
    if (active) {
      useAIStore.getState().connect();
    } else {
      useAIStore.getState().disconnect();
    }
  }
});

let prevAuthUserId: string | null = useAuthStore.getState().user?.id ?? null;
let prevAuthLoading = useAuthStore.getState().isLoading;
useAuthStore.subscribe((state) => {
  const nextUserId = state.user?.id ?? null;
  const authChanged = prevAuthUserId !== nextUserId || prevAuthLoading !== state.isLoading;
  prevAuthUserId = nextUserId;
  prevAuthLoading = state.isLoading;

  const aiActive = useUIStore.getState().aiPanelOpen || useUIStore.getState().aiLiteMode;
  if (!authChanged || !aiActive) return;
  if (state.user) {
    void useAIStore.getState().connect();
  } else if (!state.isLoading) {
    useAIStore.setState({ isConnecting: false, connectionError: "Not authenticated" });
  }
});
