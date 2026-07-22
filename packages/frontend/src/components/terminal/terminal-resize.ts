export function sendTerminalResize(
  socket: Pick<WebSocket, "readyState" | "send"> | null,
  rows: number,
  cols: number
): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ type: "resize", rows, cols }));
  return true;
}
