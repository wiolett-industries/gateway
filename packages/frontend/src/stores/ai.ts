import { create } from "zustand";
import {
  dropConversation,
  listConversations,
  restoreConversation,
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
  AIMessage,
  AIToolCall,
  ChatMessage,
  PageContext,
  ToolActionType,
  WSServerMessage,
} from "@/types/ai";

function getToolActionType(toolName: string): ToolActionType {
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

function shouldAutoApprove(toolName: string): boolean {
  const ui = useUIStore.getState();
  const action = getToolActionType(toolName);
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

interface AIState {
  messages: AIMessage[];
  isStreaming: boolean;
  isConnected: boolean;
  isEnabled: boolean | null;
  retryAfter: number | null;
  savedName: string | null;
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
  setEnabled: (enabled: boolean) => void;
  handleSlashCommand: (input: string) => Promise<boolean>;
  setMessages: (messages: AIMessage[]) => void;
}

let wsClient: AIWebSocketClient | null = null;
let currentRequestId: string | null = null;
let retryTimer: ReturnType<typeof setInterval> | null = null;

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
                ? JSON.stringify(tc.result)
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
  isStreaming: false,
  isConnected: false,
  isEnabled: null,
  retryAfter: null,
  savedName: null,
  pendingApprovalToolCallId: null,

  connect: async () => {
    const sessionId = useAuthStore.getState().sessionId;
    if (!sessionId) return false;
    if (wsClient?.isConnected) {
      set({ isConnected: true });
      return true;
    }
    if (wsClient) {
      wsClient.disconnect();
      wsClient = null;
    }

    wsClient = new AIWebSocketClient();
    wsClient.onMessage((msg: WSServerMessage) => {
      handleWSMessage(msg, set, get);
    });
    wsClient.onStatusChange((connected) => {
      set({ isConnected: connected });
      if (!connected) set({ isStreaming: false });
    });

    const ok = await wsClient.connect(sessionId);
    return ok;
  },

  disconnect: () => {
    wsClient?.disconnect();
    wsClient = null;
    set({ isConnected: false, isStreaming: false });
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

    set({ messages: [...messages, userMsg, assistantMsg], isStreaming: true });

    const requestId = generateId();
    currentRequestId = requestId;

    const chatMessages = buildChatMessages([...messages, userMsg]);

    wsClient?.send({
      type: "chat",
      requestId,
      messages: chatMessages,
      context,
    });
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
    set({ messages: [], savedName: null });
  },

  setEnabled: (enabled: boolean) => {
    set({ isEnabled: enabled });
  },

  setMessages: (messages: AIMessage[]) => {
    set({ messages });
  },

  handleSlashCommand: async (input: string): Promise<boolean> => {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const arg = parts.slice(1).join(" ");

    if (cmd === "/clear") {
      set({ messages: [] });
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

    if (cmd === "/save") {
      if (!arg) {
        const localMsg: AIMessage = {
          id: generateId(),
          role: "assistant",
          content: "Usage: `/save <name>`",
          localOnly: true,
        };
        set((state) => ({ messages: [...state.messages, localMsg] }));
        return true;
      }
      try {
        await saveConversation(
          arg,
          get().messages.filter((m) => !m.localOnly)
        );
        set({ savedName: arg });
        const localMsg: AIMessage = {
          id: generateId(),
          role: "assistant",
          content: `Conversation saved as **${arg}** — will auto-save on new messages`,
          localOnly: true,
        };
        set((state) => ({ messages: [...state.messages, localMsg] }));
      } catch {
        const localMsg: AIMessage = {
          id: generateId(),
          role: "assistant",
          content: "Failed to save conversation.",
          localOnly: true,
        };
        set((state) => ({ messages: [...state.messages, localMsg] }));
      }
      return true;
    }

    if (cmd === "/restore") {
      if (!arg) {
        const convos = await listConversations();
        const list =
          convos.length > 0
            ? convos
                .map((c) => `- **${c.name}** (${new Date(c.savedAt).toLocaleDateString()})`)
                .join("\n")
            : "No saved conversations.";
        const localMsg: AIMessage = {
          id: generateId(),
          role: "assistant",
          content: `**Saved conversations:**\n${list}\n\nUsage: \`/restore <name>\``,
          localOnly: true,
        };
        set((state) => ({ messages: [...state.messages, localMsg] }));
        return true;
      }
      try {
        const messages = await restoreConversation(arg);
        if (messages) {
          set({ messages, savedName: arg });
          const localMsg: AIMessage = {
            id: generateId(),
            role: "assistant",
            content: `Restored **${arg}** (${messages.length} messages)`,
            localOnly: true,
          };
          set((state) => ({ messages: [...state.messages, localMsg] }));
        } else {
          const localMsg: AIMessage = {
            id: generateId(),
            role: "assistant",
            content: `Conversation **${arg}** not found.`,
            localOnly: true,
          };
          set((state) => ({ messages: [...state.messages, localMsg] }));
        }
      } catch {
        const localMsg: AIMessage = {
          id: generateId(),
          role: "assistant",
          content: "Failed to restore conversation.",
          localOnly: true,
        };
        set((state) => ({ messages: [...state.messages, localMsg] }));
      }
      return true;
    }

    if (cmd === "/drop") {
      if (!arg) {
        const localMsg: AIMessage = {
          id: generateId(),
          role: "assistant",
          content: "Usage: `/drop <name>`",
          localOnly: true,
        };
        set((state) => ({ messages: [...state.messages, localMsg] }));
        return true;
      }
      try {
        await dropConversation(arg);
        const localMsg: AIMessage = {
          id: generateId(),
          role: "assistant",
          content: `Deleted **${arg}**`,
          localOnly: true,
        };
        set((state) => ({ messages: [...state.messages, localMsg] }));
      } catch {
        const localMsg: AIMessage = {
          id: generateId(),
          role: "assistant",
          content: "Failed to delete conversation.",
          localOnly: true,
        };
        set((state) => ({ messages: [...state.messages, localMsg] }));
      }
      return true;
    }

    return false;
  },
}));

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
      if (shouldAutoApprove(msg.name)) {
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
      // Auto-save if conversation was previously saved
      const { savedName, messages: msgs } = get();
      if (savedName) {
        saveConversation(
          savedName,
          msgs.filter((m) => !m.localOnly)
        ).catch(() => {});
      }
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
