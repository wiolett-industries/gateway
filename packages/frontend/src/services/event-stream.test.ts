const invalidateCache = vi.fn();
const invalidateNodes = vi.fn();
const invalidatePinnedNodes = vi.fn();

vi.mock("@/services/api", () => ({
  api: {
    invalidateCache,
  },
}));

vi.mock("@/stores/nodes", () => ({
  useNodesStore: {
    getState: () => ({ invalidate: invalidateNodes }),
  },
}));

vi.mock("@/stores/pinned-nodes", () => ({
  usePinnedNodesStore: {
    getState: () => ({ invalidate: invalidatePinnedNodes }),
  },
}));

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

describe("eventStream", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    invalidateCache.mockClear();
    invalidateNodes.mockClear();
    invalidatePinnedNodes.mockClear();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(async () => {
    const { eventStream } = await import("@/services/event-stream");
    eventStream.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("subscribes to node.changed and invalidates node caches on incoming events", async () => {
    const { eventStream } = await import("@/services/event-stream");
    const handler = vi.fn();

    const unsubscribe = eventStream.subscribe("node.changed", handler);
    eventStream.start();
    vi.runAllTimers();

    const socket = MockWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket.open();

    expect(socket.sent).toContain(
      JSON.stringify({ type: "subscribe", channels: ["node.changed"] })
    );

    const payload = { id: "node-1", status: "offline" };
    socket.emit({ type: "event", channel: "node.changed", payload });
    await vi.advanceTimersByTimeAsync(750);
    await vi.dynamicImportSettled();

    expect(invalidateCache).toHaveBeenCalledWith("req:/api/nodes");
    expect(invalidateNodes).toHaveBeenCalledTimes(1);
    expect(invalidatePinnedNodes).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload);

    unsubscribe();
  });

  it("coalesces noisy node.changed events before refetching", async () => {
    const { eventStream } = await import("@/services/event-stream");
    const handler = vi.fn();

    const unsubscribe = eventStream.subscribe("node.changed", handler);
    eventStream.start();
    vi.runAllTimers();

    const socket = MockWebSocket.instances[0];
    if (!socket) throw new Error("Expected websocket");
    socket.open();

    socket.emit({
      type: "event",
      channel: "node.changed",
      payload: { id: "node-1", status: "online" },
    });
    socket.emit({
      type: "event",
      channel: "node.changed",
      payload: { id: "node-1", status: "offline" },
    });
    socket.emit({
      type: "event",
      channel: "node.changed",
      payload: { id: "node-1", status: "online" },
    });

    await vi.advanceTimersByTimeAsync(749);
    await vi.dynamicImportSettled();
    expect(handler).not.toHaveBeenCalled();
    expect(invalidateNodes).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await vi.dynamicImportSettled();

    expect(invalidateNodes).toHaveBeenCalledTimes(1);
    expect(invalidatePinnedNodes).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ id: "node-1", status: "online" });

    unsubscribe();
  });
});
