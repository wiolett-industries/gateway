import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compactConversation,
  listConversations,
  saveConversation,
} from "@/services/ai-conversations";
import { resetAIStateForAuthChange, useAIStore } from "@/stores/ai";
import { useAuthStore } from "@/stores/auth";
import { useUIStore } from "@/stores/ui";
import type { WSServerMessage } from "@/types/ai";

vi.mock("@/services/ai-conversations", () => ({
  saveConversation: vi.fn(async (_title, messages, lastContext) => ({
    id: "conversation-1",
    title: "hello",
    messages,
    lastContext: lastContext ?? null,
    updatedAt: new Date().toISOString(),
  })),
  compactConversation: vi.fn(async (id, messages, lastContext) => ({
    id,
    title: "hello",
    messages,
    lastContext: lastContext ?? null,
    updatedAt: new Date().toISOString(),
  })),
  listConversations: vi.fn(async () => []),
  getConversation: vi.fn(),
  deleteConversation: vi.fn(),
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

describe("AI conversation persistence", () => {
  afterEach(() => {
    resetAIStateForAuthChange();
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
    useUIStore.setState({
      aiAlwaysAskApprovals: false,
      aiBypassCreateApprovals: false,
      aiBypassEditApprovals: false,
      aiBypassDeleteApprovals: false,
    });
    MockWebSocket.instances = [];
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("saves the final assistant answer when streaming completes", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
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

    const connectPromise = useAIStore.getState().connect();
    const socket = MockWebSocket.instances[0];
    socket.emit({ type: "auth_ok" });
    await connectPromise;

    useAIStore.getState().sendMessage("hello");
    await vi.waitFor(() => expect(saveConversation).toHaveBeenCalled());

    socket.emit({ type: "text_delta", requestId: "request-1", content: "final answer" });
    socket.emit({ type: "done", requestId: "request-1" });

    await vi.waitFor(() => expect(compactConversation).toHaveBeenCalled());
    const [, savedMessages] = vi.mocked(compactConversation).mock.calls.at(-1)!;
    expect(savedMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "hello" }),
        expect.objectContaining({
          role: "assistant",
          content: "final answer",
          isStreaming: false,
        }),
      ])
    );
    expect(listConversations).toHaveBeenCalled();
  });

  it("auto-approves Docker image pulls in bypass create/edit mode", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
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
    useUIStore.setState({
      aiBypassCreateApprovals: true,
      aiBypassEditApprovals: true,
      aiBypassDeleteApprovals: false,
    });

    const connectPromise = useAIStore.getState().connect();
    const socket = MockWebSocket.instances[0];
    socket.emit({ type: "auth_ok" });
    await connectPromise;

    useAIStore.getState().sendMessage("pull redis image");
    await vi.waitFor(() =>
      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"chat"'))
    );

    socket.emit({
      type: "tool_approval_required",
      requestId: "request-1",
      id: "tool-1",
      name: "pull_docker_image",
      arguments: { nodeId: "node-1", imageRef: "redis:latest" },
    });

    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"tool_approval"'));
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"approved":true'));
  });

  it("auto-approves read-only umbrella tool operations without bypass mode", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
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

    const connectPromise = useAIStore.getState().connect();
    const socket = MockWebSocket.instances[0];
    socket.emit({ type: "auth_ok" });
    await connectPromise;

    useAIStore.getState().sendMessage("browse rows");
    await vi.waitFor(() =>
      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"chat"'))
    );
    socket.send.mockClear();

    socket.emit({
      type: "tool_approval_required",
      requestId: "request-1",
      id: "tool-read",
      name: "manage_postgres_data",
      arguments: { operation: "browse_rows", databaseId: "db-1", schema: "public", table: "users" },
    });

    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"tool_approval"'));
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"approved":true'));
  });

  it("does not auto-approve read-only tools in always ask mode", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
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
    useUIStore.setState({ aiAlwaysAskApprovals: true });

    const connectPromise = useAIStore.getState().connect();
    const socket = MockWebSocket.instances[0];
    socket.emit({ type: "auth_ok" });
    await connectPromise;

    useAIStore.getState().sendMessage("list containers");
    await vi.waitFor(() =>
      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"chat"'))
    );
    socket.send.mockClear();

    socket.emit({
      type: "tool_approval_required",
      requestId: "request-1",
      id: "tool-read",
      name: "find_resource",
      arguments: { query: "redis", types: ["docker_container"] },
    });

    expect(socket.send).not.toHaveBeenCalledWith(expect.stringContaining('"type":"tool_approval"'));
  });

  it("auto-approves Postgres data writes in bypass create/edit mode", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
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
    useUIStore.setState({
      aiBypassCreateApprovals: true,
      aiBypassEditApprovals: true,
      aiBypassDeleteApprovals: false,
    });

    const connectPromise = useAIStore.getState().connect();
    const socket = MockWebSocket.instances[0];
    socket.emit({ type: "auth_ok" });
    await connectPromise;

    useAIStore.getState().sendMessage("insert row");
    await vi.waitFor(() =>
      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"chat"'))
    );
    socket.send.mockClear();

    socket.emit({
      type: "tool_approval_required",
      requestId: "request-1",
      id: "tool-write",
      name: "manage_postgres_data",
      arguments: { operation: "insert_row", databaseId: "db-1", schema: "public", table: "users" },
    });

    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"tool_approval"'));
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"approved":true'));
  });

  it("only auto-approves sandbox execution in bypass everything mode", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
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
    useUIStore.setState({
      aiBypassCreateApprovals: true,
      aiBypassEditApprovals: true,
      aiBypassDeleteApprovals: false,
    });

    const connectPromise = useAIStore.getState().connect();
    const socket = MockWebSocket.instances[0];
    socket.emit({ type: "auth_ok" });
    await connectPromise;

    useAIStore.getState().sendMessage("run script");
    await vi.waitFor(() =>
      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"chat"'))
    );
    socket.send.mockClear();

    socket.emit({
      type: "tool_approval_required",
      requestId: "request-1",
      id: "sandbox-1",
      name: "execute_script",
      arguments: { script: "echo hi" },
    });
    expect(socket.send).not.toHaveBeenCalledWith(expect.stringContaining('"type":"tool_approval"'));

    useUIStore.setState({ aiBypassDeleteApprovals: true });
    socket.emit({
      type: "tool_approval_required",
      requestId: "request-1",
      id: "sandbox-2",
      name: "execute_script",
      arguments: { script: "echo hi" },
    });

    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"tool_approval"'));
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"approved":true'));
  });

  it("does not auto-approve interaction questions", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
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

    const connectPromise = useAIStore.getState().connect();
    const socket = MockWebSocket.instances[0];
    socket.emit({ type: "auth_ok" });
    await connectPromise;

    useAIStore.getState().sendMessage("ask a question");
    await vi.waitFor(() =>
      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"chat"'))
    );
    socket.send.mockClear();

    socket.emit({
      type: "tool_approval_required",
      requestId: "request-1",
      id: "question-1",
      name: "ask_question",
      arguments: { question: "Which node?" },
    });

    expect(socket.send).not.toHaveBeenCalledWith(expect.stringContaining('"type":"tool_approval"'));
  });
});
