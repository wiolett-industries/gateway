import { describe, expect, it } from "vitest";
import { encodeTerminalInput } from "./terminal-encoding";

function decodeTerminalInput(encoded: string): string {
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

describe("encodeTerminalInput", () => {
  it.each(["hello", "привет", "你好", "emoji: 🐳", "line one\rline two"])(
    "encodes terminal input as UTF-8: %s",
    (input) => {
      expect(decodeTerminalInput(encodeTerminalInput(input))).toBe(input);
    }
  );

  it("handles large pasted input without exceeding function argument limits", () => {
    const input = "ю".repeat(100_000);
    expect(decodeTerminalInput(encodeTerminalInput(input))).toBe(input);
  });
});
