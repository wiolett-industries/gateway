import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AIMessage as AIMessageType, AIToolCall } from "@/types/ai";
import { AIMessage } from "./AIMessage";

function toolCall(id: string, status: AIToolCall["status"] = "completed"): AIToolCall {
  return {
    id,
    name: id === "tool-3" ? "read_process_output" : "find_resource",
    arguments: { query: id },
    status,
    result: { ok: true },
  };
}

function message(toolCalls: AIToolCall[]): AIMessageType {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    isStreaming: true,
    toolCalls,
  };
}

function artifactToolCall(): AIToolCall {
  return {
    id: "artifact-1",
    name: "send_artifact",
    arguments: { path: "generated.txt" },
    status: "completed",
    result: {
      artifactId: "artifact-id",
      filename: "generated.txt",
      mediaType: "text/plain",
      sizeBytes: 25,
      downloadUrl: "/api/ai/sandbox/artifacts/artifact-id/download",
    },
  };
}

describe("AIMessage tool call groups", () => {
  it("does not crash when a restored user message has no generated id timestamp", () => {
    render(
      <AIMessage
        message={
          {
            role: "user",
            content: "Show health summary",
          } as AIMessageType
        }
      />
    );

    expect(screen.getByText("Show health summary")).toBeInTheDocument();
  });

  it("keeps an expanded completed tool group open when a new tool call appears", () => {
    const { rerender } = render(
      <AIMessage message={message([toolCall("tool-1"), toolCall("tool-2")])} />
    );

    fireEvent.click(screen.getByRole("button", { name: /called 2 tools/i }));
    expect(screen.getAllByRole("button", { name: /find resource/i })).toHaveLength(2);

    rerender(
      <AIMessage
        message={message([toolCall("tool-1"), toolCall("tool-2"), toolCall("tool-3", "running")])}
      />
    );

    expect(screen.getAllByRole("button", { name: /find resource/i })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /read process output/i })).toBeInTheDocument();
  });

  it("shows artifact attachments only after the assistant turn finishes", () => {
    const streamingMessage: AIMessageType = {
      id: "assistant-2",
      role: "assistant",
      content: "Готовлю файл.",
      isStreaming: true,
      toolCalls: [artifactToolCall()],
    };

    const { rerender } = render(<AIMessage message={streamingMessage} />);
    expect(screen.getByText("Готовлю файл.")).toBeInTheDocument();
    expect(screen.queryByText("generated.txt")).not.toBeInTheDocument();

    rerender(<AIMessage message={{ ...streamingMessage, isStreaming: false }} />);
    expect(screen.getByText("Готовлю файл.")).toBeInTheDocument();
    expect(screen.getByText("generated.txt")).toBeInTheDocument();
  });
});
