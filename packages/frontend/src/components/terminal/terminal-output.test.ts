import { describe, expect, it } from "vitest";
import { TerminalOutputNormalizer } from "./terminal-output";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("TerminalOutputNormalizer", () => {
  it("clears xterm scrollback when BusyBox clears the viewport", () => {
    const normalizer = new TerminalOutputNormalizer();
    const output = normalizer.push(encoder.encode("old\u001b[H\u001b[J/ # "));

    expect(decoder.decode(output)).toBe("old\u001b[3J\u001b[H\u001b[J/ # ");
  });

  it("recognizes a clear sequence split across chunks", () => {
    const normalizer = new TerminalOutputNormalizer();
    const chunks = ["old\u001b[", "H\u001b", "[J/ # "].map((chunk) =>
      normalizer.push(encoder.encode(chunk))
    );

    const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }

    expect(decoder.decode(output)).toBe("old\u001b[3J\u001b[H\u001b[J/ # ");
  });

  it("passes ordinary UTF-8 terminal output through unchanged", () => {
    const normalizer = new TerminalOutputNormalizer();
    const input = encoder.encode("привет 🐳\r\n/ # ");

    expect(Array.from(normalizer.push(input))).toEqual(Array.from(input));
  });
});
