import { create } from "zustand";
import {
  type AIConversationFolder,
  type AIConversationSummary,
  createConversationFolder,
  deleteConversation,
  deleteConversationFolder,
  getConversation,
  listConversationFolders,
  listConversations,
  moveConversationsToFolder,
  renameConversation,
  reorderConversationFolders,
  rollbackConversationToMessage,
  updateConversationFolder,
} from "@/services/ai-conversations";
import { AIWebSocketClient } from "@/services/ai-websocket";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
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
const CONTEXT_ESTIMATE_CACHE_TTL_MS = 30_000;

interface AIContextOverheadEstimate {
  systemTokens: number;
  toolsTokens: number;
  overheadTokens: number;
  limit: number;
  source: "server" | "settings" | "fallback";
  reasoningEffort: AIConfig["reasoningEffort"];
  toolCount: number;
  systemBreakdown: Array<{
    label: string;
    chars: number;
    tokens: number;
  }>;
  toolBreakdown: Array<{
    label: string;
    chars: number;
    tokens: number;
  }>;
}

let contextEstimateCache: {
  key: string;
  expiresAt: number;
  estimate: AIContextOverheadEstimate;
} | null = null;

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
      break;
    case "certificates":
      api.invalidateCache("req:/api/certificates");
      api.invalidateCache("certificates:list:");
      api.invalidateCache("req:/api/monitoring/dashboard");
      api.invalidateCache("dashboard:stats:");
      break;
    case "ssl":
      api.invalidateCache("req:/api/ssl-certificates");
      api.invalidateCache("ssl:list:");
      api.invalidateCache("req:/api/monitoring/dashboard");
      api.invalidateCache("dashboard:stats:");
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
      api.invalidateCache("req:/api/docker");
      break;
    case "images":
      api.invalidateCache("req:/api/docker");
      break;
    case "volumes":
      api.invalidateCache("req:/api/docker");
      break;
    case "networks":
      api.invalidateCache("req:/api/docker");
      break;
  }
}

interface AIState {
  messages: AIMessage[];
  recentConversations: AIConversationSummary[];
  conversationFolders: AIConversationFolder[];
  isLoadingRecentConversations: boolean;
  isLoadingConversationFolders: boolean;
  isStreaming: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  isEnabled: boolean | null;
  retryAfter: number | null;
  savedName: string | null;
  activeConversationId: string | null;
  sidebarActiveConversationId: string | null;
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
  fetchConversationFolders: () => Promise<void>;
  createConversationFolder: (input: {
    name: string;
    description?: string;
  }) => Promise<AIConversationFolder | null>;
  updateConversationFolder: (
    id: string,
    input: { name?: string; description?: string }
  ) => Promise<AIConversationFolder | null>;
  deleteConversationFolder: (id: string) => Promise<void>;
  reorderConversationFolders: (folderIds: string[]) => Promise<void>;
  moveConversationsToFolder: (conversationIds: string[], folderId: string | null) => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  rollbackToMessage: (messageId: string) => Promise<AIMessage | null>;
  setEnabled: (enabled: boolean) => void;
  handleSlashCommand: (input: string) => Promise<boolean>;
  setMessages: (messages: AIMessage[]) => void;
}

let wsClient: AIWebSocketClient | null = null;
let conversationLoadGeneration = 0;
const pendingToolCommands = new Map<
  string,
  {
    toolCallId: string;
    previousStatus: AIToolCall["status"];
    previousResult?: unknown;
    decision: "approval" | "question";
  }
>();

declare global {
  interface Window {
    gatewayDev?: {
      showApprovalBlock?: () => void;
      hideApprovalBlock?: () => void;
      [key: string]: unknown;
    };
  }
}

function updateToolCallById(
  messages: AIMessage[],
  toolCallId: string,
  update: (toolCall: AIToolCall) => AIToolCall
): AIMessage[] {
  return messages.map((msg) => ({
    ...msg,
    toolCalls: msg.toolCalls?.map((tc) => (tc.id === toolCallId ? update(tc) : tc)),
  }));
}

function appendLocalAssistantError(messages: AIMessage[], content: string): AIMessage[] {
  return [
    ...messages,
    {
      id: generateId(),
      role: "assistant",
      content,
      createdAt: nowIso(),
      localOnly: true,
    },
  ];
}

function sendWSMessage(msg: Parameters<AIWebSocketClient["send"]>[0]): void {
  if (!wsClient) throw new Error("AI connection is not open");
  wsClient.send(msg);
}

function trySendWSMessage(msg: Parameters<AIWebSocketClient["send"]>[0]): boolean {
  try {
    sendWSMessage(msg);
    return true;
  } catch {
    return false;
  }
}
const assistantDraftVersions = new Map<string, number>();

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

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateChatMessagesTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.content === "string") total += estimateTextTokens(message.content);
    if (message.attachments?.length) {
      for (const attachment of message.attachments) {
        total += Math.ceil(attachment.sizeBytes / 3);
      }
    }
    if (message.tool_calls?.length) {
      for (const toolCall of message.tool_calls) {
        total += estimateTextTokens(toolCall.function.arguments || "");
        total += 20;
      }
    }
    total += 4;
  }
  return total;
}

function contextEstimateCacheKey(context?: PageContext, conversationId?: string | null): string {
  return JSON.stringify({
    conversationId: conversationId ?? null,
    route: context?.route ?? null,
    resourceType: context?.resourceType ?? null,
    resourceId: context?.resourceId ?? null,
  });
}

async function resolveContextOverhead(
  context?: PageContext,
  conversationId?: string | null
): Promise<AIContextOverheadEstimate> {
  const key = contextEstimateCacheKey(context, conversationId);
  const now = Date.now();
  if (contextEstimateCache?.key === key && contextEstimateCache.expiresAt > now) {
    return contextEstimateCache.estimate;
  }

  try {
    const estimate = await api.getAIContextEstimate({ context, conversationId });
    const result: AIContextOverheadEstimate = {
      systemTokens: estimate.systemTokens,
      toolsTokens: estimate.toolsTokens,
      overheadTokens: estimate.totalOverhead,
      limit: estimate.limit,
      source: "server",
      reasoningEffort: estimate.reasoningEffort,
      toolCount: estimate.toolCount,
      systemBreakdown: estimate.systemBreakdown ?? [],
      toolBreakdown: estimate.toolBreakdown ?? [],
    };
    contextEstimateCache = {
      key,
      expiresAt: now + CONTEXT_ESTIMATE_CACHE_TTL_MS,
      estimate: result,
    };
    return result;
  } catch {
    const { limit, source, reasoningEffort } = await resolveContextSettings();
    const result: AIContextOverheadEstimate = {
      systemTokens: 0,
      toolsTokens: 0,
      overheadTokens: 0,
      limit,
      source,
      reasoningEffort,
      toolCount: 0,
      systemBreakdown: [],
      toolBreakdown: [],
    };
    contextEstimateCache = {
      key,
      expiresAt: now + CONTEXT_ESTIMATE_CACHE_TTL_MS,
      estimate: result,
    };
    return result;
  }
}

export interface AIContextUsage {
  messageCount: number;
  estimatedTokens: number;
  limit: number;
  percent: number;
  chatTokens: number;
  systemTokens: number;
  toolsTokens: number;
  overheadTokens: number;
  toolCount: number;
  systemBreakdown: Array<{
    label: string;
    chars: number;
    tokens: number;
  }>;
  toolBreakdown: Array<{
    label: string;
    chars: number;
    tokens: number;
  }>;
  source: "server" | "settings" | "fallback";
  reasoningEffort: AIConfig["reasoningEffort"];
}

interface SendMessageOptions {
  startNewConversation?: boolean;
}

export async function getAIContextUsage(
  messages: AIMessage[],
  context?: PageContext,
  conversationId?: string | null
): Promise<AIContextUsage> {
  const chatMessages = buildChatMessages(messages);
  const chatTokens = estimateChatMessagesTokens(chatMessages);
  const overhead = await resolveContextOverhead(context, conversationId);
  const overheadTokens = overhead.overheadTokens;
  const estimatedTokens = chatTokens + overheadTokens;

  return {
    messageCount: chatMessages.length,
    estimatedTokens,
    limit: overhead.limit,
    percent: Math.round((estimatedTokens / overhead.limit) * 100),
    chatTokens,
    systemTokens: overhead.systemTokens,
    toolsTokens: overhead.toolsTokens,
    overheadTokens,
    toolCount: overhead.toolCount,
    systemBreakdown: overhead.systemBreakdown,
    toolBreakdown: overhead.toolBreakdown,
    source: overhead.source,
    reasoningEffort: overhead.reasoningEffort,
  };
}

export const useAIStore = create<AIState>()((set, get) => ({
  messages: [],
  recentConversations: [],
  conversationFolders: [],
  isLoadingRecentConversations: false,
  isLoadingConversationFolders: false,
  isStreaming: false,
  isConnected: false,
  isConnecting: false,
  connectionError: null,
  isEnabled: null,
  retryAfter: null,
  savedName: null,
  activeConversationId: null,
  sidebarActiveConversationId: null,
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
        trySendWSMessage({ type: "conversation.subscribe", conversationId: activeConversationId });
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
    if ((!options.startNewConversation && state.isStreaming) || getConversationBlock(baseMessages))
      return;
    if (options.startNewConversation && state.activeConversationId) {
      trySendWSMessage({
        type: "conversation.unsubscribe",
        conversationId: state.activeConversationId,
      });
    }
    if (options.startNewConversation) conversationLoadGeneration += 1;

    set({
      isStreaming: true,
      lastContext: context ?? null,
      pendingApprovalToolCallId: null,
      ...(options.startNewConversation
        ? {
            messages: [],
            savedName: null,
            activeConversationId: null,
            sidebarActiveConversationId: null,
            activeRunId: null,
          }
        : {}),
    });

    const clientCommandId = generateId();
    try {
      sendWSMessage({
        type: "conversation.send_message",
        clientCommandId,
        content,
        attachments,
        context,
        conversationId: options.startNewConversation
          ? undefined
          : (state.activeConversationId ?? undefined),
      });
    } catch (error) {
      set((state) => ({
        isStreaming: false,
        messages: appendLocalAssistantError(
          state.messages,
          `**Error:** ${error instanceof Error ? error.message : "Failed to send message"}`
        ),
      }));
    }
  },

  approveTool: (toolCallId: string) => {
    const state = get();
    if (!state.activeConversationId || !state.activeRunId) return;
    const previous = state.messages
      .flatMap((message) => message.toolCalls ?? [])
      .find((toolCall) => toolCall.id === toolCallId);
    const clientCommandId = generateId();

    set((state) => ({
      messages: updateToolCallById(state.messages, toolCallId, (tc) => ({
        ...tc,
        status: "running",
        approvalPolicy: "requires_approval",
        error: undefined,
      })),
    }));
    pendingToolCommands.set(clientCommandId, {
      toolCallId,
      previousStatus: previous?.status ?? "awaiting_approval",
      previousResult: previous?.result,
      decision: "approval",
    });
    try {
      sendWSMessage({
        type: "approval.decide",
        conversationId: state.activeConversationId,
        runId: state.activeRunId,
        approvalId: toolCallId,
        decision: "approved",
        clientCommandId,
      });
    } catch (error) {
      pendingToolCommands.delete(clientCommandId);
      set((state) => ({
        messages: updateToolCallById(state.messages, toolCallId, (tc) => ({
          ...tc,
          status: "awaiting_approval",
          result: previous?.result,
          error: error instanceof Error ? error.message : "Failed to send approval",
        })),
      }));
    }
  },

  rejectTool: (toolCallId: string) => {
    const state = get();
    if (!state.activeConversationId || !state.activeRunId) return;
    const previous = state.messages
      .flatMap((message) => message.toolCalls ?? [])
      .find((toolCall) => toolCall.id === toolCallId);
    const clientCommandId = generateId();

    set((state) => ({
      messages: updateToolCallById(state.messages, toolCallId, (tc) => ({
        ...tc,
        status: "rejected",
        error: undefined,
      })),
    }));
    pendingToolCommands.set(clientCommandId, {
      toolCallId,
      previousStatus: previous?.status ?? "awaiting_approval",
      previousResult: previous?.result,
      decision: "approval",
    });
    try {
      sendWSMessage({
        type: "approval.decide",
        conversationId: state.activeConversationId,
        runId: state.activeRunId,
        approvalId: toolCallId,
        decision: "rejected",
        clientCommandId,
      });
    } catch (error) {
      pendingToolCommands.delete(clientCommandId);
      set((state) => ({
        messages: updateToolCallById(state.messages, toolCallId, (tc) => ({
          ...tc,
          status: "awaiting_approval",
          result: previous?.result,
          error: error instanceof Error ? error.message : "Failed to send rejection",
        })),
      }));
    }
  },

  answerQuestion: (toolCallId: string, answer: string) => {
    const state = get();
    if (!state.activeConversationId || !state.activeRunId) return;

    const previous = state.messages
      .flatMap((message) => message.toolCalls ?? [])
      .find((toolCall) => toolCall.id === toolCallId);
    const clientCommandId = generateId();

    set((state) => ({
      messages: updateToolCallById(state.messages, toolCallId, (tc) => ({
        ...tc,
        status: "running",
        result: { answer },
        error: undefined,
      })),
      pendingApprovalToolCallId: null,
    }));
    pendingToolCommands.set(clientCommandId, {
      toolCallId,
      previousStatus: previous?.status ?? "awaiting_approval",
      previousResult: previous?.result,
      decision: "question",
    });
    try {
      sendWSMessage({
        type: "question.answer",
        conversationId: state.activeConversationId,
        runId: state.activeRunId,
        questionId: toolCallId,
        answer,
        clientCommandId,
      });
    } catch (error) {
      pendingToolCommands.delete(clientCommandId);
      set((state) => ({
        messages: updateToolCallById(state.messages, toolCallId, (tc) => ({
          ...tc,
          status: "awaiting_approval",
          result: previous?.result,
          error: error instanceof Error ? error.message : "Failed to send answer",
        })),
        pendingApprovalToolCallId: toolCallId,
      }));
    }
  },

  stopStreaming: () => {
    const state = get();
    if (state.activeConversationId && state.activeRunId) {
      trySendWSMessage({
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
    conversationLoadGeneration += 1;
    const activeConversationId = get().activeConversationId;
    if (activeConversationId) {
      trySendWSMessage({ type: "conversation.unsubscribe", conversationId: activeConversationId });
    }
    set({
      messages: [],
      savedName: null,
      activeConversationId: null,
      sidebarActiveConversationId: null,
      activeRunId: null,
      lastContext: null,
    });
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

  fetchConversationFolders: async () => {
    if (!useAuthStore.getState().user) return;
    set((state) => ({
      isLoadingConversationFolders: state.conversationFolders.length === 0,
    }));
    try {
      const folders = await listConversationFolders();
      set({
        conversationFolders: sortConversationFolders(folders),
        isLoadingConversationFolders: false,
      });
    } catch {
      set({ isLoadingConversationFolders: false });
    }
  },

  createConversationFolder: async (input) => {
    const created = await createConversationFolder(input);
    set((state) => ({
      conversationFolders: sortConversationFolders([...state.conversationFolders, created]),
    }));
    return created;
  },

  updateConversationFolder: async (id, input) => {
    const previousFolders = get().conversationFolders;
    set((state) => ({
      conversationFolders: state.conversationFolders.map((folder) =>
        folder.id === id
          ? {
              ...folder,
              ...input,
              updatedAt: nowIso(),
            }
          : folder
      ),
    }));
    try {
      const updated = await updateConversationFolder(id, input);
      set((state) => ({
        conversationFolders: sortConversationFolders(
          state.conversationFolders.map((folder) => (folder.id === id ? updated : folder))
        ),
      }));
      return updated;
    } catch (error) {
      set({ conversationFolders: previousFolders });
      throw error;
    }
  },

  deleteConversationFolder: async (id) => {
    const previousFolders = get().conversationFolders;
    const previousConversations = get().recentConversations;
    set((state) => ({
      conversationFolders: state.conversationFolders.filter((folder) => folder.id !== id),
      recentConversations: state.recentConversations.map((conversation) =>
        conversation.folderId === id ? { ...conversation, folderId: null } : conversation
      ),
    }));
    try {
      await deleteConversationFolder(id);
    } catch (error) {
      set({ conversationFolders: previousFolders, recentConversations: previousConversations });
      throw error;
    }
  },

  reorderConversationFolders: async (folderIds) => {
    const previousFolders = get().conversationFolders;
    const orderById = new Map(folderIds.map((id, index) => [id, index]));
    const nextFolders = sortConversationFolders(
      previousFolders.map((folder) =>
        orderById.has(folder.id) ? { ...folder, sortOrder: orderById.get(folder.id)! } : folder
      )
    );
    set({ conversationFolders: nextFolders });
    try {
      const folders = await reorderConversationFolders(
        nextFolders.map((folder, index) => ({ id: folder.id, sortOrder: index }))
      );
      set({ conversationFolders: sortConversationFolders(folders) });
    } catch (error) {
      set({ conversationFolders: previousFolders });
      throw error;
    }
  },

  moveConversationsToFolder: async (conversationIds, folderId) => {
    const ids = new Set(conversationIds);
    const previousConversations = get().recentConversations;
    set((state) => ({
      recentConversations: state.recentConversations.map((conversation) =>
        ids.has(conversation.id) ? { ...conversation, folderId } : conversation
      ),
    }));
    try {
      await moveConversationsToFolder(conversationIds, folderId);
    } catch (error) {
      set({ recentConversations: previousConversations });
      throw error;
    }
  },

  loadConversation: async (conversationId: string) => {
    const loadGeneration = (conversationLoadGeneration += 1);
    try {
      const previousConversationId = get().activeConversationId;
      if (previousConversationId && previousConversationId !== conversationId) {
        trySendWSMessage({
          type: "conversation.unsubscribe",
          conversationId: previousConversationId,
        });
      }
      set({
        messages: [],
        savedName: null,
        activeConversationId: conversationId,
        sidebarActiveConversationId: conversationId,
        activeRunId: null,
        lastContext: null,
        pendingApprovalToolCallId: null,
      });
      const conversation = await getConversation(conversationId);
      if (loadGeneration !== conversationLoadGeneration) return;
      set({
        messages: normalizeConversationMessages(conversation.messages, conversation.id),
        savedName: conversation.title,
        activeConversationId: conversation.id,
        sidebarActiveConversationId: conversation.id,
        activeRunId: null,
        lastContext: conversation.lastContext,
      });
      trySendWSMessage({ type: "conversation.subscribe", conversationId });
    } catch {
      if (loadGeneration !== conversationLoadGeneration) return;
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
        sidebarActiveConversationId: null,
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
        trySendWSMessage({ type: "conversation.unsubscribe", conversationId });
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
              sidebarActiveConversationId: null,
              activeRunId: null,
              lastContext: null,
            }
          : {}),
      }));
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

  renameConversation: async (conversationId: string, title: string) => {
    const conversation = await renameConversation(conversationId, title);
    set((state) => ({
      savedName:
        state.activeConversationId === conversationId ? conversation.title : state.savedName,
      recentConversations: sortConversationSummaries(
        state.recentConversations.map((item) =>
          item.id === conversationId
            ? {
                ...item,
                title: conversation.title,
                updatedAt: conversation.updatedAt,
                lastUserMessageAt: conversation.lastUserMessageAt,
                status: conversation.status,
                blockReason: conversation.blockReason,
                activeRunStatus: conversation.activeRunStatus,
              }
            : item
        )
      ),
    }));
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
    set((state) => ({
      messages,
      savedName: result.conversation.title,
      activeConversationId: result.conversation.id,
      sidebarActiveConversationId: result.conversation.id,
      activeRunId: null,
      lastContext: result.conversation.lastContext,
      pendingApprovalToolCallId: null,
      isStreaming: false,
      recentConversations: sortConversationSummaries(
        state.recentConversations.map((item) =>
          item.id === result.conversation.id
            ? {
                ...item,
                title: result.conversation.title,
                updatedAt: result.conversation.updatedAt,
                lastUserMessageAt: result.conversation.lastUserMessageAt,
                folderId: result.conversation.folderId,
                messageCount: result.conversation.messages.length,
                status: result.conversation.status,
                blockReason: result.conversation.blockReason,
                activeRunStatus: result.conversation.activeRunStatus,
              }
            : item
        )
      ),
    }));
    trySendWSMessage({ type: "conversation.sync", conversationId: result.conversation.id });
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
        trySendWSMessage({
          type: "conversation.unsubscribe",
          conversationId: activeConversationId,
        });
      }
      set({
        messages: [],
        savedName: null,
        activeConversationId: null,
        sidebarActiveConversationId: null,
        activeRunId: null,
        lastContext: null,
      });
      return true;
    }

    if (cmd === "/context") {
      const { activeConversationId, lastContext, messages } = get();
      const usage = await getAIContextUsage(
        messages,
        lastContext ?? undefined,
        activeConversationId
      );
      const sourceNote =
        usage.source === "fallback"
          ? "\n- Estimate source: fallback (context estimate unavailable)"
          : usage.source === "settings"
            ? "\n- Estimate source: local chat + AI settings fallback"
            : "";
      const systemBreakdown =
        usage.systemBreakdown.length > 0
          ? `\n\n**System breakdown**\n${[...usage.systemBreakdown]
              .sort((left, right) => right.tokens - left.tokens)
              .slice(0, 6)
              .map((item) => `- ${item.label}: ~${item.tokens.toLocaleString()} tokens`)
              .join("\n")}`
          : "";
      const toolBreakdown =
        usage.toolBreakdown.length > 0
          ? `\n\n**Tool breakdown**\n${usage.toolBreakdown
              .slice(0, 6)
              .map((item) => `- ${item.label}: ~${item.tokens.toLocaleString()} tokens`)
              .join("\n")}`
          : "";

      const localMsg: AIMessage = {
        id: generateId(),
        role: "assistant",
        content: `**Context Usage**\n- Messages: ${usage.messageCount}\n- Estimated tokens: ${usage.estimatedTokens.toLocaleString()} / ${usage.limit.toLocaleString()} (${usage.percent}%)\n- Chat: ~${usage.chatTokens.toLocaleString()} tokens\n- System prompt: ~${usage.systemTokens.toLocaleString()} tokens\n- Tools: ~${usage.toolsTokens.toLocaleString()} tokens (${usage.toolCount} available)\n- Reasoning: ${usage.reasoningEffort}${sourceNote}${systemBreakdown}${toolBreakdown}`,
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
  conversationLoadGeneration += 1;
  assistantDraftVersions.clear();
  pendingToolCommands.clear();
  useAIStore.setState({
    messages: [],
    recentConversations: [],
    conversationFolders: [],
    isLoadingRecentConversations: false,
    isLoadingConversationFolders: false,
    isStreaming: false,
    isConnected: false,
    isConnecting: false,
    connectionError: null,
    retryAfter: null,
    savedName: null,
    activeConversationId: null,
    sidebarActiveConversationId: null,
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
      if (msg.clientCommandId) pendingToolCommands.delete(msg.clientCommandId);
      set((state) => {
        const selectsConversation = msg.commandType === "conversation.send_message";
        const matchesCurrentConversation =
          !!msg.conversationId && state.activeConversationId === msg.conversationId;
        return {
          ...(selectsConversation && msg.conversationId
            ? {
                activeConversationId: msg.conversationId,
                sidebarActiveConversationId: msg.conversationId,
              }
            : {}),
          ...(msg.runId && (selectsConversation || matchesCurrentConversation)
            ? { activeRunId: msg.runId }
            : {}),
        };
      });
      break;

    case "command.error":
      {
        const pending = msg.clientCommandId
          ? pendingToolCommands.get(msg.clientCommandId)
          : undefined;
        if (pending) {
          if (msg.clientCommandId) pendingToolCommands.delete(msg.clientCommandId);
          set((state) => ({
            isStreaming: false,
            messages: updateToolCallById(state.messages, pending.toolCallId, (tc) => ({
              ...tc,
              status: pending.previousStatus,
              result: pending.previousResult,
              error: msg.message,
            })),
            pendingApprovalToolCallId: pending.toolCallId,
          }));
          break;
        }
      }
      set((state) => ({
        isStreaming: false,
        messages: appendLocalAssistantError(state.messages, `**Error:** ${msg.message}`),
      }));
      break;

    case "conversation.snapshot":
      set((state) => ({
        recentConversations: patchRecentConversationFromSnapshot(
          state.recentConversations,
          msg.snapshot
        ),
      }));
      if (get().activeConversationId !== msg.conversationId) return;
      set((state) => projectConversationSnapshot(msg.snapshot, state.messages));
      break;

    case "assistant.delta":
      if (get().activeConversationId !== msg.conversationId) return;
      set((state) => ({
        activeRunId: msg.runId,
        isStreaming: true,
        messages: applyAssistantDeltaToMessages(state.messages, msg),
        recentConversations: patchRecentConversationRunStatus(
          state.recentConversations,
          msg.conversationId,
          "running"
        ),
      }));
      break;

    case "run.status_changed":
      set((state) => ({
        recentConversations: patchRecentConversationRunStatus(
          state.recentConversations,
          msg.conversationId,
          msg.run?.status ?? null
        ),
        ...(state.activeConversationId === msg.conversationId
          ? {
              activeRunId: msg.run?.id ?? null,
              isStreaming: isActiveRunStatus(msg.run?.status),
            }
          : {}),
      }));
      break;

    case "stores.invalidated":
      for (const storeName of msg.stores) invalidateStore(storeName);
      break;

    case "approval.updated":
    case "question.answered":
      break;
  }
}

function projectConversationSnapshot(
  snapshot: AIConversationRuntimeSnapshot,
  currentMessages: AIMessage[] = []
): Partial<AIState> {
  const activeRunId = snapshot.runtime.activeRun?.id ?? null;
  const snapshotDraftVersion = snapshot.runtime.assistantDraftVersion;
  const currentDraftVersion = activeRunId ? (assistantDraftVersions.get(activeRunId) ?? -1) : -1;
  const snapshotDraftIsStale = Boolean(
    activeRunId &&
      typeof snapshotDraftVersion === "number" &&
      snapshotDraftVersion < currentDraftVersion
  );

  if (activeRunId && typeof snapshotDraftVersion === "number" && !snapshotDraftIsStale) {
    assistantDraftVersions.set(activeRunId, snapshotDraftVersion);
  }
  const runtimeToolCalls = snapshot.runtime.toolCalls.map(runtimeToolCallToUI);
  const pendingQuestions =
    snapshot.runtime.pendingQuestions.length > 0
      ? snapshot.runtime.pendingQuestions
      : snapshot.runtime.pendingQuestion
        ? [snapshot.runtime.pendingQuestion]
        : [];
  const pendingQuestionToolCalls = pendingQuestions.map(pendingQuestionToToolCall);
  const messages = preserveFreshRuntimeDraft(
    attachRuntimeToolCallsToMessages(
      normalizeSnapshotMessages(snapshot),
      [...runtimeToolCalls, ...pendingQuestionToolCalls],
      Boolean(snapshot.runtime.activeRun),
      snapshot.runtime.activeRun?.id ?? null
    ),
    currentMessages,
    snapshotDraftIsStale ? activeRunId : null
  );

  return {
    messages,
    savedName: snapshot.conversation.title,
    activeConversationId: snapshot.conversation.id,
    sidebarActiveConversationId: snapshot.conversation.id,
    activeRunId: snapshot.runtime.activeRun?.id ?? null,
    lastContext: snapshot.conversation.lastContext,
    pendingApprovalToolCallId:
      snapshot.runtime.pendingApprovals[0]?.toolCallId ?? pendingQuestions[0]?.toolCallId ?? null,
    isStreaming: isActiveRunStatus(snapshot.runtime.activeRun?.status),
  };
}

function preserveFreshRuntimeDraft(
  snapshotMessages: AIMessage[],
  currentMessages: AIMessage[],
  activeRunId: string | null
): AIMessage[] {
  if (!activeRunId) return snapshotMessages;
  const currentIndex = findActiveRuntimeAssistantIndex(currentMessages, activeRunId);
  if (currentIndex === -1) return snapshotMessages;
  const snapshotIndex = findActiveRuntimeAssistantIndex(snapshotMessages, activeRunId);
  if (snapshotIndex === -1) return snapshotMessages;
  const currentDraft = currentMessages[currentIndex];
  const nextMessages = [...snapshotMessages];
  nextMessages[snapshotIndex] = {
    ...nextMessages[snapshotIndex],
    content: currentDraft.content,
    isStreaming: currentDraft.isStreaming,
  };
  return nextMessages;
}

function applyAssistantDeltaToMessages(
  messages: AIMessage[],
  delta: Extract<WSServerMessage, { type: "assistant.delta" }>
): AIMessage[] {
  const previousVersion = assistantDraftVersions.get(delta.runId) ?? 0;
  if (delta.version <= previousVersion) return messages;
  assistantDraftVersions.set(delta.runId, delta.version);

  const nextMessages = [...messages];
  let targetIndex = findActiveRuntimeAssistantIndex(nextMessages, delta.runId);
  if (targetIndex === -1) {
    targetIndex = nextMessages.length;
    nextMessages.push({
      id: `${delta.runId}:runtime`,
      role: "assistant",
      content: "",
      sequence: nextMessageSequence(nextMessages),
      createdAt: nowIso(),
      isStreaming: true,
    });
  }

  const current = nextMessages[targetIndex];
  nextMessages[targetIndex] = {
    ...current,
    content: `${current.content}${delta.content}`,
    isStreaming: true,
  };
  return sortMessagesBySequence(nextMessages);
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
  const functionCall =
    toolCall.function && typeof toolCall.function === "object" && !Array.isArray(toolCall.function)
      ? (toolCall.function as Record<string, unknown>)
      : null;
  const id =
    typeof toolCall.id === "string" && toolCall.id.length > 0
      ? toolCall.id
      : `${messageId}:tool:${index}`;
  const name =
    typeof toolCall.name === "string" && toolCall.name.length > 0
      ? toolCall.name
      : typeof functionCall?.name === "string" && functionCall.name.length > 0
        ? functionCall.name
        : "tool";
  const rawArguments = toolCall.arguments ?? functionCall?.arguments;
  return {
    id,
    name,
    arguments: normalizeToolCallArguments(rawArguments),
    status: normalizeToolCallStatus(toolCall.status),
    approvalPolicy:
      typeof toolCall.approvalPolicy === "string" ? toolCall.approvalPolicy : undefined,
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
    id: toolCall.toolCallId,
    name: toolCall.toolName,
    arguments: toolCall.toolArgs,
    status: runtimeToolStatusToUI(toolCall.status),
    approvalPolicy: toolCall.approvalPolicy,
    assistantMessageId: toolCall.assistantMessageId,
    result: toolCall.result ?? undefined,
    error: toolCall.error ?? undefined,
  };
}

function pendingQuestionToToolCall(
  question: AIConversationRuntimeSnapshot["runtime"]["pendingQuestions"][number]
): AIToolCall {
  return {
    id: question.toolCallId || question.id,
    name: "ask_question",
    arguments: { question: question.question },
    status: "awaiting_approval",
    result: question.answer ? { answer: question.answer } : undefined,
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
    const existingToolCallMessageIndex = nextMessages.findIndex((message) =>
      message.toolCalls?.some((existingToolCall) => existingToolCall.id === toolCall.id)
    );
    if (existingToolCallMessageIndex !== -1) {
      nextMessages[existingToolCallMessageIndex] = {
        ...nextMessages[existingToolCallMessageIndex],
        toolCalls: mergeToolCalls(nextMessages[existingToolCallMessageIndex].toolCalls ?? [], [
          toolCall,
        ]),
      };
      continue;
    }

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
  for (const toolCall of incoming) {
    const previous = byId.get(toolCall.id);
    byId.set(toolCall.id, {
      ...previous,
      ...toolCall,
      arguments: { ...(previous?.arguments ?? {}), ...toolCall.arguments },
    });
  }
  return [...byId.values()];
}

function normalizeToolCallArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || value.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function patchRecentConversationFromSnapshot(
  conversations: AIConversationSummary[],
  snapshot: AIConversationRuntimeSnapshot
): AIConversationSummary[] {
  const existing = conversations.find(
    (conversation) => conversation.id === snapshot.conversation.id
  );
  const nextConversation: AIConversationSummary = {
    id: snapshot.conversation.id,
    title: snapshot.conversation.title,
    createdAt: snapshot.conversation.createdAt,
    updatedAt: snapshot.conversation.updatedAt,
    lastUserMessageAt:
      snapshot.conversation.lastUserMessageAt ??
      snapshotLastUserMessageAt(snapshot.messages) ??
      existing?.lastUserMessageAt ??
      snapshot.conversation.createdAt,
    folderId: snapshot.conversation.folderId ?? existing?.folderId ?? null,
    messageCount: snapshot.conversation.messageCount ?? snapshot.messages.length,
    status: snapshot.conversation.status ?? existing?.status ?? "active",
    blockReason: snapshot.conversation.blockReason ?? existing?.blockReason ?? null,
    activeRunStatus: snapshot.runtime.activeRun?.status ?? null,
  };
  const found = Boolean(existing);
  const next = found
    ? conversations.map((conversation) =>
        conversation.id === nextConversation.id
          ? { ...conversation, ...nextConversation }
          : conversation
      )
    : [nextConversation, ...conversations];
  return sortConversationSummaries(next);
}

function patchRecentConversationRunStatus(
  conversations: AIConversationSummary[],
  conversationId: string,
  activeRunStatus: AIConversationSummary["activeRunStatus"]
): AIConversationSummary[] {
  let changed = false;
  const nextConversations = conversations.map((conversation) => {
    if (conversation.id !== conversationId) return conversation;
    if (conversation.activeRunStatus === activeRunStatus) return conversation;
    changed = true;
    return { ...conversation, activeRunStatus };
  });
  return changed ? nextConversations : conversations;
}

function sortConversationFolders(folders: AIConversationFolder[]): AIConversationFolder[] {
  return [...folders].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  });
}

function sortConversationSummaries(
  conversations: AIConversationSummary[]
): AIConversationSummary[] {
  return [...conversations].sort((left, right) => {
    const rightTime = Date.parse(right.lastUserMessageAt ?? right.createdAt);
    const leftTime = Date.parse(left.lastUserMessageAt ?? left.createdAt);
    return rightTime - leftTime;
  });
}

function snapshotLastUserMessageAt(messages: unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    const record = message as Record<string, unknown>;
    if (record.role !== "user") continue;
    return typeof record.createdAt === "string" ? record.createdAt : null;
  }
  return null;
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

const DEV_APPROVAL_MESSAGE_ID = "dev-approval-preview-message";
const DEV_APPROVAL_TOOL_CALL_ID = "dev-approval-preview-tool";

function installAIDevCommands(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;

  window.gatewayDev = {
    ...(window.gatewayDev ?? {}),
    showApprovalBlock: () => {
      useUIStore.setState({ aiPanelOpen: true });
      useAIStore.setState((state) => ({
        messages: [
          ...state.messages.filter((message) => message.id !== DEV_APPROVAL_MESSAGE_ID),
          {
            id: DEV_APPROVAL_MESSAGE_ID,
            role: "assistant",
            content: "",
            createdAt: nowIso(),
            localOnly: true,
            isStreaming: true,
            toolCalls: [
              {
                id: DEV_APPROVAL_TOOL_CALL_ID,
                name: "run_process",
                arguments: { command: "echo preview" },
                status: "awaiting_approval",
              },
            ],
          },
        ],
        activeConversationId: state.activeConversationId ?? "00000000-0000-4000-8000-000000000001",
        activeRunId: state.activeRunId ?? "dev-approval-preview-run",
        isConnected: true,
        retryAfter: null,
      }));
    },
    hideApprovalBlock: () => {
      useAIStore.setState((state) => ({
        messages: state.messages.filter((message) => message.id !== DEV_APPROVAL_MESSAGE_ID),
      }));
    },
  };
}

installAIDevCommands();

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
