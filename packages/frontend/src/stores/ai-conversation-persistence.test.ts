import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getConversation,
  listConversations,
  rollbackConversationToMessage,
} from "@/services/ai-conversations";
import { resetAIStateForAuthChange, useAIStore } from "@/stores/ai";
import { useAuthStore } from "@/stores/auth";
import { useUIStore } from "@/stores/ui";
import type { WSServerMessage } from "@/types/ai";

vi.mock("@/services/ai-conversations", () => ({
  listConversations: vi.fn(async () => []),
  getConversation: vi.fn(),
  deleteConversation: vi.fn(),
  rollbackConversationToMessage: vi.fn(),
}));

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();

  constructor() {
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  emit(message: WSServerMessage | { type: "auth_ok" }) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function setAuthenticatedUser() {
  useAuthStore.setState({
    user: {
      id: "user-1",
      email: "user@example.com",
      name: "User One",
      groupName: "admin",
      scopes: ["feat:ai:use"],
      isBlocked: false,
    } as any,
    isAuthenticated: true,
    isLoading: false,
  });
}

async function connectAI() {
  vi.stubGlobal("WebSocket", MockWebSocket);
  setAuthenticatedUser();

  const connectPromise = useAIStore.getState().connect();
  const socket = MockWebSocket.instances[0];
  socket.emit({ type: "auth_ok" });
  await connectPromise;
  return socket;
}

function sentPayloads(socket: MockWebSocket): Array<Record<string, unknown>> {
  return vi.mocked(socket.send).mock.calls.map(([payload]) => JSON.parse(String(payload)));
}

function runtimeRun(status: "queued" | "running" | "waiting_for_approval" | "waiting_for_answer") {
  return {
    id: "run-1",
    conversationId: "conversation-1",
    userId: "user-1",
    status,
    activeMessageId: "assistant-1",
    clientCommandId: "command-1",
    assistantDraftContent: null,
    error: null,
    startedAt: "2026-06-26T10:00:00.000Z",
    completedAt: null,
    stoppedAt: null,
    createdAt: "2026-06-26T10:00:00.000Z",
    updatedAt: "2026-06-26T10:00:01.000Z",
  };
}

describe("AI backend runtime store", () => {
  afterEach(() => {
    resetAIStateForAuthChange();
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
    useUIStore.setState({
      aiApprovalMode: "normal",
    });
    MockWebSocket.instances = [];
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("sends user turns through the backend-owned runtime socket command", async () => {
    const socket = await connectAI();

    useAIStore.getState().sendMessage("hello");

    expect(sentPayloads(socket)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "conversation.send_message",
          content: "hello",
        }),
      ])
    );
  });

  it("refreshes all recent conversations without blanking an existing sidebar list", async () => {
    setAuthenticatedUser();
    useAIStore.setState({
      recentConversations: [
        {
          id: "existing-conversation",
          title: "Existing",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastUserMessageAt: new Date().toISOString(),
          messageCount: 1,
          status: "active",
          blockReason: null,
          activeRunStatus: null,
        },
      ],
      isLoadingRecentConversations: false,
    });

    let resolveList: (value: Awaited<ReturnType<typeof listConversations>>) => void = () => {};
    vi.mocked(listConversations).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        })
    );

    const fetchPromise = useAIStore.getState().fetchRecentConversations();
    expect(useAIStore.getState().isLoadingRecentConversations).toBe(false);
    expect(listConversations).toHaveBeenCalledWith();

    const conversations = Array.from({ length: 6 }, (_, index) => ({
      id: `conversation-${index + 1}`,
      title: `Conversation ${index + 1}`,
      createdAt: new Date(2026, 0, index + 1).toISOString(),
      updatedAt: new Date(2026, 0, index + 1).toISOString(),
      lastUserMessageAt: new Date(2026, 0, index + 1).toISOString(),
      messageCount: index + 1,
      status: "active" as const,
      blockReason: null,
      activeRunStatus: null,
    }));

    resolveList(conversations);
    await fetchPromise;

    expect(useAIStore.getState().recentConversations).toHaveLength(6);
  });

  it("starts an empty quick action in a new backend conversation instead of replacing the previous chat", async () => {
    const socket = await connectAI();

    useAIStore.setState({
      messages: [],
      activeConversationId: "old-conversation",
      sidebarActiveConversationId: "old-conversation",
      savedName: "Old conversation",
      lastContext: null,
    });

    useAIStore.getState().sendMessage("Give me an overview of the system status", undefined, [], {
      startNewConversation: true,
    });

    const payload = sentPayloads(socket).find((item) => item.type === "conversation.send_message");
    expect(payload).toMatchObject({
      content: "Give me an overview of the system status",
    });
    expect(payload).not.toHaveProperty("conversationId", "old-conversation");
    expect(useAIStore.getState().activeConversationId).toBeNull();
    expect(useAIStore.getState().sidebarActiveConversationId).toBeNull();
  });

  it("allows starting a new conversation while a previous run is still streaming", async () => {
    const socket = await connectAI();

    useAIStore.setState({
      messages: [],
      activeConversationId: "old-conversation",
      sidebarActiveConversationId: null,
      activeRunId: "old-run",
      isStreaming: true,
      savedName: "Old conversation",
      lastContext: null,
    });

    useAIStore.getState().sendMessage("Start a separate chat", undefined, [], {
      startNewConversation: true,
    });

    const payload = sentPayloads(socket).find((item) => item.type === "conversation.send_message");
    expect(payload).toMatchObject({
      content: "Start a separate chat",
    });
    expect(payload).not.toHaveProperty("conversationId", "old-conversation");
    expect(useAIStore.getState().activeConversationId).toBeNull();
    expect(useAIStore.getState().activeRunId).toBeNull();
  });

  it("does not reselect a stale conversation load after starting a new chat", async () => {
    const socket = await connectAI();
    let resolveConversation: (value: Awaited<ReturnType<typeof getConversation>>) => void =
      () => {};
    vi.mocked(getConversation).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConversation = resolve;
        })
    );

    const loadPromise = useAIStore.getState().loadConversation("conversation-1");
    expect(useAIStore.getState().activeConversationId).toBe("conversation-1");
    expect(useAIStore.getState().sidebarActiveConversationId).toBe("conversation-1");

    useAIStore.getState().clearMessages();
    expect(useAIStore.getState().activeConversationId).toBeNull();
    expect(useAIStore.getState().sidebarActiveConversationId).toBeNull();

    resolveConversation({
      id: "conversation-1",
      title: "Restored chat",
      messages: [{ id: "message-1", role: "user", content: "hello" }],
      lastContext: null,
      createdAt: "2026-06-26T09:59:00.000Z",
      updatedAt: "2026-06-26T10:00:00.000Z",
      lastUserMessageAt: "2026-06-26T10:00:00.000Z",
      status: "active",
      blockReason: null,
      activeRunStatus: null,
    });
    await loadPromise;

    expect(useAIStore.getState().activeConversationId).toBeNull();
    expect(useAIStore.getState().sidebarActiveConversationId).toBeNull();
    expect(sentPayloads(socket)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "conversation.subscribe",
          conversationId: "conversation-1",
        }),
      ])
    );
  });

  it("does not reselect a chat from a late non-message command ack", async () => {
    const socket = await connectAI();
    useAIStore.setState({
      activeConversationId: null,
      sidebarActiveConversationId: null,
    });

    socket.emit({
      type: "command.ack",
      commandType: "question.answer",
      clientCommandId: "command-1",
      conversationId: "conversation-1",
      runId: "run-1",
    });

    expect(useAIStore.getState().activeConversationId).toBeNull();
    expect(useAIStore.getState().sidebarActiveConversationId).toBeNull();
    expect(useAIStore.getState().activeRunId).toBeNull();
  });

  it("normalizes restored conversations before they reach message renderers", async () => {
    const socket = await connectAI();
    vi.mocked(getConversation).mockResolvedValueOnce({
      id: "conversation-1",
      title: "Restored chat",
      messages: [
        {
          role: "assistant",
          content: "Still working",
          toolCalls: [
            {
              name: "find_resource",
              arguments: { query: "certificates" },
              status: "completed",
            },
          ],
        },
      ] as any,
      lastContext: null,
      createdAt: "2026-06-26T09:59:00.000Z",
      updatedAt: "2026-06-26T10:00:00.000Z",
      lastUserMessageAt: "2026-06-26T10:00:00.000Z",
      status: "active",
      blockReason: null,
      activeRunStatus: null,
    });

    await useAIStore.getState().loadConversation("conversation-1");

    expect(sentPayloads(socket)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "conversation.subscribe",
          conversationId: "conversation-1",
        }),
      ])
    );
    expect(useAIStore.getState().messages).toEqual([
      expect.objectContaining({
        id: "conversation-1:message:0",
        role: "assistant",
        content: "Still working",
        toolCalls: [
          expect.objectContaining({
            id: "conversation-1:message:0:tool:0",
            name: "find_resource",
            status: "completed",
          }),
        ],
      }),
    ]);
  });

  it("rolls a backend conversation back to an edited user message", async () => {
    const socket = await connectAI();
    useAIStore.setState({
      activeConversationId: "conversation-1",
      messages: [
        { id: "user-1", role: "user", content: "old prompt" },
        { id: "assistant-1", role: "assistant", content: "old answer" },
      ],
    });
    vi.mocked(rollbackConversationToMessage).mockResolvedValueOnce({
      message: { id: "user-1", role: "user", content: "old prompt" },
      conversation: {
        id: "conversation-1",
        title: "Editable chat",
        messages: [],
        lastContext: null,
        createdAt: "2026-06-26T09:59:00.000Z",
        updatedAt: "2026-06-26T10:00:00.000Z",
        lastUserMessageAt: "2026-06-26T10:00:00.000Z",
        status: "active",
        blockReason: null,
        activeRunStatus: null,
      },
    });

    const message = await useAIStore.getState().rollbackToMessage("user-1");

    expect(rollbackConversationToMessage).toHaveBeenCalledWith("conversation-1", "user-1");
    expect(message).toEqual({ id: "user-1", role: "user", content: "old prompt" });
    expect(useAIStore.getState().messages).toEqual([]);
    expect(sentPayloads(socket)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "conversation.sync",
          conversationId: "conversation-1",
        }),
      ])
    );
  });

  it("projects backend runtime snapshots into messages and pending approval state", async () => {
    const socket = await connectAI();

    socket.emit({
      type: "command.ack",
      commandType: "conversation.send_message",
      clientCommandId: "command-1",
      conversationId: "conversation-1",
      runId: "run-1",
    });

    socket.emit({
      type: "conversation.snapshot",
      conversationId: "conversation-1",
      snapshot: {
        conversation: {
          id: "conversation-1",
          title: "Runtime chat",
          createdAt: "2026-06-26T10:00:00.000Z",
          updatedAt: "2026-06-26T10:00:01.000Z",
          lastContext: null,
          discoveredToolsets: [],
          checkpoint: null,
        },
        messages: [{ id: "message-1", role: "assistant", content: "Checking..." }],
        runtime: {
          activeRun: {
            id: "run-1",
            conversationId: "conversation-1",
            userId: "user-1",
            status: "waiting_for_approval",
            activeMessageId: "message-1",
            clientCommandId: "command-1",
            assistantDraftContent: null,
            error: null,
            startedAt: "2026-06-26T10:00:00.000Z",
            completedAt: null,
            stoppedAt: null,
            createdAt: "2026-06-26T10:00:00.000Z",
            updatedAt: "2026-06-26T10:00:01.000Z",
          },
          pendingApprovals: [],
          pendingQuestion: null,
          pendingQuestions: [],
          toolCalls: [
            {
              id: "approval-1",
              runId: "run-1",
              conversationId: "conversation-1",
              assistantMessageId: "message-1",
              toolCallId: "tool-1",
              toolName: "pull_docker_image",
              toolArgs: { imageRef: "redis:latest" },
              classification: "create",
              approvalPolicy: "normal",
              requiredScopes: [],
              status: "pending_approval",
              decision: null,
              result: null,
              error: null,
            },
          ],
        },
      },
    });

    expect(useAIStore.getState()).toMatchObject({
      activeConversationId: "conversation-1",
      activeRunId: "run-1",
      pendingApprovalToolCallId: null,
      isStreaming: true,
    });
    expect(useAIStore.getState().messages[0].toolCalls).toEqual([
      expect.objectContaining({
        id: "tool-1",
        name: "pull_docker_image",
        status: "awaiting_approval",
      }),
    ]);
  });

  it("merges pending ask_question runtime state into the saved assistant tool call", async () => {
    const socket = await connectAI();
    useAIStore.setState({ activeConversationId: "conversation-1" });

    socket.emit({
      type: "conversation.snapshot",
      conversationId: "conversation-1",
      snapshot: {
        conversation: {
          id: "conversation-1",
          title: "Runtime chat",
          createdAt: "2026-06-26T10:00:00.000Z",
          updatedAt: "2026-06-26T10:00:01.000Z",
          lastContext: null,
          discoveredToolsets: [],
          checkpoint: null,
        },
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "call_question_1",
                type: "function",
                function: {
                  name: "ask_question",
                  arguments: JSON.stringify({ question: "Убить все активные sandbox-процессы?" }),
                },
              },
            ],
          },
        ],
        runtime: {
          activeRun: runtimeRun("waiting_for_answer"),
          pendingApprovals: [],
          pendingQuestion: null,
          pendingQuestions: [
            {
              id: "question-row-1",
              runId: "run-1",
              conversationId: "conversation-1",
              toolCallId: "call_question_1",
              question: "Убить все активные sandbox-процессы?",
              status: "pending",
              answer: null,
            },
          ],
          toolCalls: [],
        },
      },
    });

    const questionToolCalls = useAIStore
      .getState()
      .messages.flatMap((message) => message.toolCalls ?? [])
      .filter((toolCall) => toolCall.name === "ask_question");

    expect(questionToolCalls).toEqual([
      expect.objectContaining({
        id: "call_question_1",
        status: "awaiting_approval",
        arguments: { question: "Убить все активные sandbox-процессы?" },
      }),
    ]);

    useAIStore.getState().answerQuestion("call_question_1", "yes");

    expect(sentPayloads(socket)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "question.answer",
          questionId: "call_question_1",
          answer: "yes",
        }),
      ])
    );
  });

  it("updates background chat runtime status from snapshots and status events", async () => {
    const socket = await connectAI();
    useAIStore.setState({
      activeConversationId: "conversation-current",
      recentConversations: [
        {
          id: "conversation-1",
          title: "Background chat",
          createdAt: "2026-06-26T09:00:00.000Z",
          updatedAt: "2026-06-26T10:00:00.000Z",
          lastUserMessageAt: "2026-06-26T09:30:00.000Z",
          messageCount: 2,
          status: "active",
          blockReason: null,
          activeRunStatus: "running",
        },
      ],
    });

    socket.emit({
      type: "conversation.snapshot",
      conversationId: "conversation-1",
      snapshot: {
        conversation: {
          id: "conversation-1",
          title: "Background chat",
          createdAt: "2026-06-26T09:00:00.000Z",
          updatedAt: "2026-06-26T10:00:00.000Z",
          lastContext: null,
          discoveredToolsets: [],
          checkpoint: null,
        },
        messages: [],
        runtime: {
          activeRun: runtimeRun("waiting_for_answer"),
          pendingApprovals: [],
          pendingQuestion: null,
          pendingQuestions: [],
          toolCalls: [],
        },
      },
    });

    expect(useAIStore.getState().recentConversations[0].activeRunStatus).toBe("waiting_for_answer");
    expect(useAIStore.getState().activeConversationId).toBe("conversation-current");

    socket.emit({
      type: "run.status_changed",
      conversationId: "conversation-1",
      run: null,
    });

    expect(useAIStore.getState().recentConversations[0].activeRunStatus).toBeNull();
  });

  it("orders restored snapshot messages by backend sequence", async () => {
    const socket = await connectAI();
    useAIStore.setState({ activeConversationId: "conversation-1" });

    socket.emit({
      type: "conversation.snapshot",
      conversationId: "conversation-1",
      snapshot: {
        conversation: {
          id: "conversation-1",
          title: "Runtime chat",
          createdAt: "2026-06-26T10:00:00.000Z",
          updatedAt: "2026-06-26T10:00:01.000Z",
          lastContext: null,
          discoveredToolsets: [],
          checkpoint: null,
        },
        messages: [
          {
            id: "assistant-1",
            sequence: 1,
            role: "assistant",
            content: "Answer",
          },
          {
            id: "user-1",
            sequence: 0,
            role: "user",
            content: "Question",
          },
        ],
        runtime: {
          activeRun: null,
          pendingApprovals: [],
          pendingQuestion: null,
          pendingQuestions: [],
          toolCalls: [],
        },
      },
    });

    expect(useAIStore.getState().messages.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
    ]);
  });

  it("renders tool-only active turns in a runtime placeholder instead of the previous assistant reply", async () => {
    const socket = await connectAI();
    useAIStore.setState({ activeConversationId: "conversation-1" });

    socket.emit({
      type: "conversation.snapshot",
      conversationId: "conversation-1",
      snapshot: {
        conversation: {
          id: "conversation-1",
          title: "Runtime chat",
          createdAt: "2026-06-26T10:00:00.000Z",
          updatedAt: "2026-06-26T10:00:01.000Z",
          lastContext: null,
          discoveredToolsets: [],
          checkpoint: null,
        },
        messages: [
          { id: "assistant-old", role: "assistant", content: "Previous answer" },
          { id: "user-new", role: "user", content: "Pull redis" },
        ],
        runtime: {
          activeRun: {
            id: "run-1",
            conversationId: "conversation-1",
            userId: "user-1",
            status: "waiting_for_approval",
            activeMessageId: "user-new",
            clientCommandId: "command-1",
            assistantDraftContent: null,
            error: null,
            startedAt: "2026-06-26T10:00:00.000Z",
            completedAt: null,
            stoppedAt: null,
            createdAt: "2026-06-26T10:00:00.000Z",
            updatedAt: "2026-06-26T10:00:01.000Z",
          },
          pendingApprovals: [],
          pendingQuestion: null,
          pendingQuestions: [],
          toolCalls: [
            {
              id: "approval-1",
              runId: "run-1",
              conversationId: "conversation-1",
              assistantMessageId: null,
              toolCallId: "tool-1",
              toolName: "pull_docker_image",
              toolArgs: { imageRef: "redis:latest" },
              classification: "create",
              approvalPolicy: "normal",
              requiredScopes: [],
              status: "pending_approval",
              decision: null,
              result: null,
              error: null,
            },
          ],
        },
      },
    });

    const { messages } = useAIStore.getState();
    expect(messages.find((message) => message.id === "assistant-old")?.toolCalls).toBeUndefined();
    expect(messages.at(-1)).toMatchObject({
      id: "run-1:runtime",
      role: "assistant",
      isStreaming: true,
      toolCalls: [expect.objectContaining({ id: "tool-1" })],
    });
  });

  it("ignores stale snapshots after the active conversation changes", async () => {
    const socket = await connectAI();
    useAIStore.setState({
      activeConversationId: "conversation-new",
      messages: [{ id: "new-user", role: "user", content: "New chat" }],
    });

    socket.emit({
      type: "conversation.snapshot",
      conversationId: "conversation-old",
      snapshot: {
        conversation: {
          id: "conversation-old",
          title: "Old chat",
          createdAt: "2026-06-26T10:00:00.000Z",
          updatedAt: "2026-06-26T10:00:01.000Z",
          lastContext: null,
          discoveredToolsets: [],
          checkpoint: null,
        },
        messages: [{ id: "old-assistant", role: "assistant", content: "Old answer" }],
        runtime: {
          activeRun: null,
          pendingApprovals: [],
          pendingQuestion: null,
          pendingQuestions: [],
          toolCalls: [],
        },
      },
    });

    expect(useAIStore.getState().activeConversationId).toBe("conversation-new");
    expect(useAIStore.getState().messages).toEqual([
      { id: "new-user", role: "user", content: "New chat" },
    ]);
  });

  it("sends approval decisions idempotently to the backend runtime", async () => {
    const socket = await connectAI();
    useAIStore.setState({
      activeConversationId: "conversation-1",
      activeRunId: "run-1",
      pendingApprovalToolCallId: "tool-1",
      messages: [
        {
          id: "message-1",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tool-1",
              name: "pull_docker_image",
              arguments: { imageRef: "redis:latest" },
              status: "awaiting_approval",
            },
          ],
        },
      ],
    });

    useAIStore.getState().approveTool("tool-1");

    expect(sentPayloads(socket)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "approval.decide",
          conversationId: "conversation-1",
          runId: "run-1",
          approvalId: "tool-1",
          decision: "approved",
        }),
      ])
    );
  });
});
