import { describe, expect, it } from 'vitest';
import { sanitizeConversationMessagesForStorage } from './ai-conversation.service.js';

function toolCall(index: number) {
  return {
    id: `tool-${index}`,
    name: 'get_docker_container_logs',
    status: 'completed',
    result: `raw output ${index}`,
  };
}

describe('AIConversationService storage sanitization', () => {
  it('keeps only the latest 10 non-question tool outputs in saved messages', () => {
    const messages = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        toolCalls: [
          ...Array.from({ length: 12 }, (_, index) => toolCall(index + 1)),
          {
            id: 'question-1',
            name: 'ask_question',
            status: 'completed',
            result: { answer: 'yes' },
          },
        ],
      },
    ];

    const [sanitized] = sanitizeConversationMessagesForStorage(messages) as Array<{
      toolCalls: Array<{ id: string; result: unknown }>;
    }>;

    expect(sanitized.toolCalls[0].result).toEqual({
      summary: 'Tool output omitted from saved conversation after the latest 10 tool calls.',
      fullOutputOmitted: true,
    });
    expect(sanitized.toolCalls[1].result).toEqual({
      summary: 'Tool output omitted from saved conversation after the latest 10 tool calls.',
      fullOutputOmitted: true,
    });
    expect(sanitized.toolCalls[2].result).toBe('raw output 3');
    expect(sanitized.toolCalls[11].result).toBe('raw output 12');
    expect(sanitized.toolCalls[12].result).toEqual({ answer: 'yes' });
  });
});
