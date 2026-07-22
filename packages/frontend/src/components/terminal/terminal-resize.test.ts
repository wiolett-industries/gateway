import { describe, expect, it, vi } from "vitest";
import { sendTerminalResize } from "./terminal-resize";

describe("sendTerminalResize", () => {
  it("sends the current terminal dimensions to an open socket", () => {
    const socket = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    };

    expect(sendTerminalResize(socket, 36, 140)).toBe(true);
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "resize", rows: 36, cols: 140 })
    );
  });

  it("does not send dimensions before the socket is open", () => {
    const socket = {
      readyState: WebSocket.CONNECTING,
      send: vi.fn(),
    };

    expect(sendTerminalResize(socket, 24, 80)).toBe(false);
    expect(socket.send).not.toHaveBeenCalled();
  });
});
