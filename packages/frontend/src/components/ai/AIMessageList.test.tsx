import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AIMessage } from "@/types/ai";
import { AIMessageList } from "./AIMessageList";

describe("AIMessageList", () => {
  it("groups assistant tool calls with the following assistant answer", () => {
    const messages: AIMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "Check databases",
      },
      {
        id: "tool-boundary-1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tool-1",
            name: "find_resource",
            arguments: {},
            status: "completed",
          },
        ],
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "По базам сейчас так:",
      },
    ];

    const { container } = render(<AIMessageList messages={messages} />);

    expect(screen.getByRole("button", { name: /find resource/i })).toBeInTheDocument();
    expect(screen.getByText("По базам сейчас так:")).toBeInTheDocument();
    const compactAssistantTurn = container.querySelector(".space-y-1");
    expect(compactAssistantTurn).not.toBeNull();
    expect(compactAssistantTurn).toContainElement(
      screen.getByRole("button", { name: /find resource/i })
    );
    expect(compactAssistantTurn).toContainElement(screen.getByText("По базам сейчас так:"));
  });
});
