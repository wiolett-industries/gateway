import { create } from "zustand";
import {
  type AIConversationSummary,
  deleteConversation,
  getConversation,
  listConversations,
  rollbackConversationToMessage,
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
  AIConversationRuntimeSnapshot,
  AIConversationStatus,
  AIMessage,
  AIRunToolCall,
  AIToolCall,
  ChatMessage,
  PageContext,
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
  activeRunId: string | null;
  lastContext: PageContext | null;
  pendingApprovalToolCallId: string | null;

  // Actions
  connect: () => Promise<boolean>;
  disconnect: () => void;
  sendMessage: (
    content: string,
    context?: PageContext,
    attachments?: AIMessage["attachments"],
    options?: SendMessageOptions
  ) => void;
  approveTool: (toolCallId: string) => void;
  rejectTool: (toolCallId: string) => void;
  answerQuestion: (toolCallId: string, answer: string) => void;
  stopStreaming: () => void;
  clearMessages: () => void;
  fetchRecentConversations: () => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  rollbackToMessage: (messageId: string) => Promise<AIMessage | null>;
  setEnabled: (enabled: boolean) => void;
  handleSlashCommand: (input: string) => Promise<boolean>;
  setMessages: (messages: AIMessage[]) => void;
}

let wsClient: AIWebSocketClient | null = null;

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

interface SendMessageOptions {
  startNewConversation?: boolean;
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
  activeRunId: null,
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
      const activeConversationId = get().activeConversationId;
      if (connected && activeConversationId) {
        wsClient?.send({ type: "conversation.subscribe", conversationId: activeConversationId });
      }
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
    attachments: AIMessage["attachments"] = [],
    options: SendMessageOptions = {}
  ) => {
    const state = get();
    const baseMessages = options.startNewConversation ? [] : state.messages;
    if (state.isStreaming || getConversationBlock(baseMessages)) return;
    if (options.startNewConversation && state.activeConversationId) {
      wsClient?.send({
        type: "conversation.unsubscribe",
        conversationId: state.activeConversationId,
      });
    }

    set({
      isStreaming: true,
      lastContext: context ?? null,
      pendingApprovalToolCallId: null,
      ...(options.startNewConversation
        ? { messages: [], savedName: null, activeConversationId: null, activeRunId: null }
        : {}),
    });

    const clientCommandId = generateId();
    wsClient?.send({
      type: "conversation.send_message",
      clientCommandId,
      content,
      attachments,
      context,
      conversationId: options.startNewConversation
        ? undefined
        : (state.activeConversationId ?? undefined),
    });
  },

  approveTool: (toolCallId: string) => {
    const state = get();
    if (!state.activeConversationId || !state.activeRunId) return;
    wsClient?.send({
      type: "approval.decide",
      conversationId: state.activeConversationId,
      runId: state.activeRunId,
      approvalId: toolCallId,
      decision: "approved",
      clientCommandId: generateId(),
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
    const state = get();
    if (!state.activeConversationId || !state.activeRunId) return;
    wsClient?.send({
      type: "approval.decide",
      conversationId: state.activeConversationId,
      runId: state.activeRunId,
      approvalId: toolCallId,
      decision: "rejected",
      clientCommandId: generateId(),
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
    const state = get();
    if (!state.activeConversationId || !state.activeRunId) return;

    set((state) => {
      return {
        messages: state.messages.map((msg) => ({
          ...msg,
          toolCalls: msg.toolCalls?.map((tc) => {
            if (tc.id === toolCallId) {
              return { ...tc, status: "completed" as const, result: { answer } };
            }
            return tc;
          }),
        })),
      };
    });

    wsClient?.send({
      type: "question.answer",
      conversationId: state.activeConversationId,
      runId: state.activeRunId,
      questionId: toolCallId,
      answer,
      clientCommandId: generateId(),
    });
    set({ pendingApprovalToolCallId: null });
  },

  stopStreaming: () => {
    const state = get();
    if (state.activeConversationId && state.activeRunId) {
      wsClient?.send({
        type: "run.stop",
        conversationId: state.activeConversationId,
        runId: state.activeRunId,
        clientCommandId: generateId(),
      });
    }
    set((state) => ({
      isStreaming: false,
      messages: state.messages.map((msg) =>
        msg.isStreaming ? { ...msg, isStreaming: false } : msg
      ),
    }));
  },

  clearMessages: () => {
    const activeConversationId = get().activeConversationId;
    if (activeConversationId) {
      wsClient?.send({ type: "conversation.unsubscribe", conversationId: activeConversationId });
    }
    set({
      messages: [],
      savedName: null,
      activeConversationId: null,
      activeRunId: null,
      lastContext: null,
    });
    void get().fetchRecentConversations();
  },

  fetchRecentConversations: async () => {
    if (!useAuthStore.getState().user) return;
    set((state) => ({
      isLoadingRecentConversations: state.recentConversations.length === 0,
    }));
    try {
      const conversations = await listConversations();
      set({ recentConversations: conversations, isLoadingRecentConversations: false });
    } catch {
      set({ isLoadingRecentConversations: false });
    }
  },

  loadConversation: async (conversationId: string) => {
    try {
      const previousConversationId = get().activeConversationId;
      if (previousConversationId && previousConversationId !== conversationId) {
        wsClient?.send({
          type: "conversation.unsubscribe",
          conversationId: previousConversationId,
        });
      }
      set({
        messages: [],
        savedName: null,
        activeConversationId: conversationId,
        activeRunId: null,
        lastContext: null,
        pendingApprovalToolCallId: null,
      });
      const conversation = await getConversation(conversationId);
      set({
        messages: normalizeConversationMessages(conversation.messages, conversation.id),
        savedName: conversation.title,
        activeConversationId: conversation.id,
        activeRunId: null,
        lastContext: conversation.lastContext,
      });
      wsClient?.send({ type: "conversation.subscribe", conversationId });
    } catch {
      const localMsg: AIMessage = {
        id: generateId(),
        role: "assistant",
        content: "Failed to load conversation.",
        createdAt: nowIso(),
        localOnly: true,
      };
      set({
        messages: [localMsg],
        savedName: null,
        activeConversationId: null,
        activeRunId: null,
        lastContext: null,
        pendingApprovalToolCallId: null,
      });
    }
  },

  deleteConversation: async (conversationId: string) => {
    try {
      await deleteConversation(conversationId);
      if (get().activeConversationId === conversationId) {
        wsClient?.send({ type: "conversation.unsubscribe", conversationId });
      }
      set((state) => ({
        recentConversations: state.recentConversations.filter(
          (conversation) => conversation.id !== conversationId
        ),
        ...(state.activeConversationId === conversationId
          ? {
              messages: [],
              savedName: null,
              activeConversationId: null,
              activeRunId: null,
              lastContext: null,
            }
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

  rollbackToMessage: async (messageId: string) => {
    const state = get();
    if (!state.activeConversationId || state.isStreaming || state.activeRunId) return null;
    const existing = state.messages.find((message) => message.id === messageId);
    if (!existing || existing.role !== "user") return null;

    const result = await rollbackConversationToMessage(state.activeConversationId, messageId);
    const messages = normalizeConversationMessages(
      result.conversation.messages,
      result.conversation.id
    );
    set({
      messages,
      savedName: result.conversation.title,
      activeConversationId: result.conversation.id,
      activeRunId: null,
      lastContext: result.conversation.lastContext,
      pendingApprovalToolCallId: null,
      isStreaming: false,
    });
    wsClient?.send({ type: "conversation.sync", conversationId: result.conversation.id });
    void get().fetchRecentConversations();
    return result.message;
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
      const activeConversationId = get().activeConversationId;
      if (activeConversationId) {
        wsClient?.send({ type: "conversation.unsubscribe", conversationId: activeConversationId });
      }
      set({
        messages: [],
        savedName: null,
        activeConversationId: null,
        activeRunId: null,
        lastContext: null,
      });
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

    return false;
  },
}));

export function resetAIStateForAuthChange() {
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
    activeRunId: null,
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
    case "command.ack":
      set({
        ...(msg.conversationId ? { activeConversationId: msg.conversationId } : {}),
        ...(msg.runId ? { activeRunId: msg.runId } : {}),
      });
      break;

    case "command.error":
      set((state) => ({
        isStreaming: false,
        messages: [
          ...state.messages,
          {
            id: generateId(),
            role: "assistant",
            content: `**Error:** ${msg.message}`,
            createdAt: nowIso(),
            localOnly: true,
          },
        ],
      }));
      break;

    case "conversation.snapshot":
      if (get().activeConversationId !== msg.conversationId) return;
      set(projectConversationSnapshot(msg.snapshot));
      void get().fetchRecentConversations();
      break;

    case "run.status_changed":
      if (get().activeConversationId !== msg.conversationId) return;
      set({
        activeRunId: msg.run?.id ?? null,
        isStreaming: isActiveRunStatus(msg.run?.status),
      });
      break;

    case "stores.invalidated":
      for (const storeName of msg.stores) invalidateStore(storeName);
      break;

    case "approval.updated":
    case "question.answered":
      break;
  }
}

function projectConversationSnapshot(snapshot: AIConversationRuntimeSnapshot): Partial<AIState> {
  const runtimeToolCalls = snapshot.runtime.toolCalls.map(runtimeToolCallToUI);
  const pendingQuestions =
    snapshot.runtime.pendingQuestions.length > 0
      ? snapshot.runtime.pendingQuestions
      : snapshot.runtime.pendingQuestion
        ? [snapshot.runtime.pendingQuestion]
        : [];
  const pendingQuestionToolCalls = pendingQuestions.map((question) => ({
    id: question.id,
    name: "ask_question",
    arguments: { question: question.question },
    status: "awaiting_approval" as const,
    result: question.answer ? { answer: question.answer } : undefined,
  }));
  const messages = attachRuntimeToolCallsToMessages(
    normalizeSnapshotMessages(snapshot),
    [...runtimeToolCalls, ...pendingQuestionToolCalls],
    Boolean(snapshot.runtime.activeRun),
    snapshot.runtime.activeRun?.id ?? null
  );

  return {
    messages,
    savedName: snapshot.conversation.title,
    activeConversationId: snapshot.conversation.id,
    activeRunId: snapshot.runtime.activeRun?.id ?? null,
    lastContext: snapshot.conversation.lastContext,
    pendingApprovalToolCallId:
      snapshot.runtime.pendingApprovals[0]?.id ?? pendingQuestions[0]?.id ?? null,
    isStreaming: isActiveRunStatus(snapshot.runtime.activeRun?.status),
  };
}

function normalizeSnapshotMessages(snapshot: AIConversationRuntimeSnapshot): AIMessage[] {
  return normalizeConversationMessages(snapshot.messages, snapshot.conversation.id);
}

function normalizeConversationMessages(messages: unknown[], conversationId: string): AIMessage[] {
  return sortMessagesBySequence(
    messages
      .map((message, index) => normalizeConversationMessage(message, conversationId, index))
      .filter((message): message is AIMessage => message !== null)
  );
}

function normalizeConversationMessage(
  value: unknown,
  conversationId: string,
  index: number
): AIMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  const role = message.role;
  if (role !== "user" && role !== "assistant") return null;
  const id =
    typeof message.id === "string" && message.id.length > 0
      ? message.id
      : `${conversationId}:message:${index}`;
  return {
    id,
    role,
    content: typeof message.content === "string" ? message.content : "",
    sequence: typeof message.sequence === "number" ? message.sequence : index,
    attachments: Array.isArray(message.attachments)
      ? (message.attachments as AIMessage["attachments"])
      : undefined,
    createdAt:
      typeof message.createdAt === "string" && message.createdAt.length > 0
        ? message.createdAt
        : undefined,
    toolCalls: Array.isArray(message.toolCalls)
      ? normalizeMessageToolCalls(message.toolCalls, id)
      : undefined,
    isStreaming: false,
  };
}

function normalizeMessageToolCalls(value: unknown[], messageId: string): AIToolCall[] {
  return value
    .map((toolCall, index) => normalizeMessageToolCall(toolCall, messageId, index))
    .filter((toolCall): toolCall is AIToolCall => toolCall !== null);
}

function normalizeMessageToolCall(
  value: unknown,
  messageId: string,
  index: number
): AIToolCall | null {
  if (!value || typeof value !== "object") return null;
  const toolCall = value as Record<string, unknown>;
  const id =
    typeof toolCall.id === "string" && toolCall.id.length > 0
      ? toolCall.id
      : `${messageId}:tool:${index}`;
  const name =
    typeof toolCall.name === "string" && toolCall.name.length > 0 ? toolCall.name : "tool";
  return {
    id,
    name,
    arguments:
      toolCall.arguments &&
      typeof toolCall.arguments === "object" &&
      !Array.isArray(toolCall.arguments)
        ? (toolCall.arguments as Record<string, unknown>)
        : {},
    status: normalizeToolCallStatus(toolCall.status),
    assistantMessageId:
      typeof toolCall.assistantMessageId === "string" ? toolCall.assistantMessageId : undefined,
    result: toolCall.result,
    error: typeof toolCall.error === "string" ? toolCall.error : undefined,
  };
}

function normalizeToolCallStatus(value: unknown): AIToolCall["status"] {
  if (
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "awaiting_approval" ||
    value === "rejected"
  ) {
    return value;
  }
  return "completed";
}

function runtimeToolCallToUI(toolCall: AIRunToolCall): AIToolCall {
  return {
    id: toolCall.id,
    name: toolCall.toolName,
    arguments: toolCall.toolArgs,
    status: runtimeToolStatusToUI(toolCall.status),
    assistantMessageId: toolCall.assistantMessageId,
    result: toolCall.result ?? undefined,
    error: toolCall.error ?? undefined,
  };
}

function runtimeToolStatusToUI(status: AIRunToolCall["status"]): AIToolCall["status"] {
  if (status === "pending_approval") return "awaiting_approval";
  if (status === "approved" || status === "running" || status === "created") return "running";
  if (status === "rejected") return "rejected";
  if (status === "failed" || status === "stopped") return "failed";
  return "completed";
}

function attachRuntimeToolCallsToMessages(
  messages: AIMessage[],
  toolCalls: AIToolCall[],
  active: boolean,
  activeRunId: string | null
): AIMessage[] {
  if (toolCalls.length === 0 && !active) return messages;
  const nextMessages = [...messages];
  const unassignedToolCalls: AIToolCall[] = [];

  for (const toolCall of toolCalls) {
    if (!toolCall.assistantMessageId) {
      unassignedToolCalls.push(toolCall);
      continue;
    }
    const targetIndex = nextMessages.findIndex(
      (message) => message.id === toolCall.assistantMessageId
    );
    if (targetIndex === -1 || nextMessages[targetIndex].role !== "assistant") {
      unassignedToolCalls.push(toolCall);
      continue;
    }
    nextMessages[targetIndex] = {
      ...nextMessages[targetIndex],
      toolCalls: mergeToolCalls(nextMessages[targetIndex].toolCalls ?? [], [toolCall]),
    };
  }

  let targetIndex =
    active && activeRunId ? findActiveRuntimeAssistantIndex(nextMessages, activeRunId) : -1;
  if (targetIndex === -1 && active && activeRunId) {
    const sequence = nextMessageSequence(nextMessages);
    nextMessages.push({
      id: `${activeRunId}:runtime`,
      role: "assistant",
      content: "",
      sequence,
      createdAt: nowIso(),
      isStreaming: active,
    });
    targetIndex = nextMessages.length - 1;
  }
  if (targetIndex === -1) {
    targetIndex = findLastAssistantIndex(nextMessages);
  }
  if (targetIndex === -1) {
    const sequence = nextMessageSequence(nextMessages);
    nextMessages.push({
      id: activeRunId ? `${activeRunId}:runtime` : generateId(),
      role: "assistant",
      content: "",
      sequence,
      createdAt: nowIso(),
      isStreaming: active,
    });
    targetIndex = nextMessages.length - 1;
  }

  nextMessages[targetIndex] = {
    ...nextMessages[targetIndex],
    isStreaming: active,
    toolCalls: mergeToolCalls(nextMessages[targetIndex].toolCalls ?? [], unassignedToolCalls),
  };
  return sortMessagesBySequence(nextMessages);
}

function findActiveRuntimeAssistantIndex(messages: AIMessage[], activeRunId: string): number {
  const runtimeIds = new Set([`${activeRunId}:draft`, `${activeRunId}:runtime`]);
  return messages.findIndex(
    (message) => message.role === "assistant" && runtimeIds.has(message.id)
  );
}

function mergeToolCalls(existing: AIToolCall[], incoming: AIToolCall[]): AIToolCall[] {
  const byId = new Map(existing.map((toolCall) => [toolCall.id, toolCall]));
  for (const toolCall of incoming) byId.set(toolCall.id, { ...byId.get(toolCall.id), ...toolCall });
  return [...byId.values()];
}

function findLastAssistantIndex(messages: AIMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") return index;
  }
  return -1;
}

function nextMessageSequence(messages: AIMessage[]): number {
  return (
    messages.reduce(
      (max, message, index) =>
        Math.max(max, typeof message.sequence === "number" ? message.sequence : index),
      -1
    ) + 1
  );
}

function sortMessagesBySequence(messages: AIMessage[]): AIMessage[] {
  return [...messages].sort((left, right) => {
    const leftSequence = typeof left.sequence === "number" ? left.sequence : messages.indexOf(left);
    const rightSequence =
      typeof right.sequence === "number" ? right.sequence : messages.indexOf(right);
    if (leftSequence !== rightSequence) return leftSequence - rightSequence;
    return messages.indexOf(left) - messages.indexOf(right);
  });
}

function isActiveRunStatus(status: string | null | undefined): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "waiting_for_approval" ||
    status === "waiting_for_answer"
  );
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
