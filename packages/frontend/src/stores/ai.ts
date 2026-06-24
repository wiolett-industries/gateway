import { create } from "zustand";
import {
  compactConversation,
  deleteConversation,
  getConversation,
  listConversations,
  saveConversation,
  type AIConversationSummary,
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
  AIMessage,
  AIToolCall,
  ChatMessage,
  PageContext,
  ToolActionType,
  WSServerMessage,
} from "@/types/ai";

const CREATE_OPERATIONS = new Set([
  "create",
  "clone",
  "upload",
  "issue_from_csr",
  "insert_row",
  "add_column",
  "create_secret",
  "create_update",
]);
const EDIT_OPERATIONS = new Set([
  "update",
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
  "update_row",
  "update_column_type",
  "set_key",
  "expire_key",
  "execute_command",
]);
const DELETE_OPERATIONS = new Set([
  "delete",
  "delete_secret",
  "delete_webhook",
  "delete_row",
  "delete_column",
  "delete_key",
]);

function getOperationActionType(operation: string): ToolActionType {
  if (CREATE_OPERATIONS.has(operation)) return "create";
  if (EDIT_OPERATIONS.has(operation)) return "edit";
  if (DELETE_OPERATIONS.has(operation)) return "delete";
  return "other";
}

function getToolActionType(toolName: string, args?: Record<string, unknown>): ToolActionType {
  const operation = typeof args?.operation === "string" ? args.operation : "";
  if (toolName.startsWith("manage_") && operation) {
    return getOperationActionType(operation);
  }
  if (
    toolName.startsWith("create_") ||
    toolName.startsWith("issue_") ||
    toolName.startsWith("request_") ||
    toolName === "link_internal_cert"
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
  return "other";
}

function shouldAutoApprove(toolName: string, args?: Record<string, unknown>): boolean {
  const ui = useUIStore.getState();
  const action = getToolActionType(toolName, args);
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

function compactToolResultForModel(toolName: string, value: unknown): unknown {
  if (value == null) return value;
  if (toolName === "get_docker_container_logs")
    return compactLogLikeResult(value, "Docker container logs");
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
  sendMessage: (content: string, context?: PageContext) => void;
  approveTool: (toolCallId: string) => void;
  rejectTool: (toolCallId: string) => void;
  answerQuestion: (toolCallId: string, answer: string) => void;
  stopStreaming: () => void;
  clearMessages: () => void;
  fetchRecentConversations: () => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
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

function buildChatMessages(messages: AIMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.localOnly) continue;
    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
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
      set({ isConnected: connected, isConnecting: false, connectionError: connected ? null : get().connectionError });
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
        connectionError: state.connectionError ?? (useAuthStore.getState().isLoading ? null : "AI connection failed"),
      }));
    }
    return ok;
  },

  disconnect: () => {
    wsClient?.disconnect();
    wsClient = null;
    set({ isConnected: false, isConnecting: false, connectionError: null, isStreaming: false });
  },

  sendMessage: (content: string, context?: PageContext) => {
    const { messages } = get();

    const userMsg: AIMessage = {
      id: generateId(),
      role: "user",
      content,
    };

    const assistantMsg: AIMessage = {
      id: generateId(),
      role: "assistant",
      content: "",
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
      const chatMessages = buildChatMessages(messages);
      const charCount = chatMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
      const tokenEstimate = Math.ceil(charCount / 4);
      const overhead = 3000;
      const total = tokenEstimate + overhead;
      const limit = 56000;

      const localMsg: AIMessage = {
        id: generateId(),
        role: "assistant",
        content: `**Context Usage**\n- Messages: ${chatMessages.length}\n- Estimated tokens: ${total.toLocaleString()} / ${limit.toLocaleString()} (${Math.round((total / limit) * 100)}%)\n- Chat: ~${tokenEstimate.toLocaleString()} tokens\n- System overhead: ~${overhead.toLocaleString()} tokens`,
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
          localOnly: true,
        };
        set((current) => ({ messages: [...current.messages, localMsg] }));
        return true;
      }

      try {
        const conversation = state.activeConversationId
          ? await compactConversation(state.activeConversationId, messages, state.lastContext)
          : await saveConversation(
              state.savedName ?? titleFromContent(messages.find((m) => m.role === "user")?.content ?? "New conversation"),
              messages,
              state.lastContext
            );
        const localMsg: AIMessage = {
          id: generateId(),
          role: "assistant",
          content: `Compacted **${conversation.title}**. Full tool outputs are kept for the latest 10 tool calls.`,
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
        messages: state.messages.map((m) =>
          m.isStreaming && m.role === "assistant" ? { ...m, content: m.content + msg.content } : m
        ),
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
        messages: state.messages.map((m) =>
          m.isStreaming && m.role === "assistant"
            ? { ...m, toolCalls: [...(m.toolCalls || []), toolCall] }
            : m
        ),
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

    case "done": {
      set((state) => ({
        isStreaming: false,
        messages: state.messages.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
      }));
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

// Auto-manage WS lifecycle based on AI panel open state.
// This runs outside React — no component mount/unmount issues.
let prevAIPanelOpen = false;
useUIStore.subscribe((state) => {
  const open = state.aiPanelOpen;
  if (open !== prevAIPanelOpen) {
    prevAIPanelOpen = open;
    if (open) {
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

  if (!authChanged || !useUIStore.getState().aiPanelOpen) return;
  if (state.user) {
    void useAIStore.getState().connect();
  } else if (!state.isLoading) {
    useAIStore.setState({ isConnecting: false, connectionError: "Not authenticated" });
  }
});
