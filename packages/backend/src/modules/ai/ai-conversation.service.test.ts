import { describe, expect, it } from 'vitest';
import {
  sanitizeConversationMessagesForStorage,
  sortConversationSummariesByLastUserMessage,
} from './ai-conversation.service.js';

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

  it('redacts one-time API token results even when the tool call output is retained', () => {
    const [sanitized] = sanitizeConversationMessagesForStorage([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'token-call-1',
            name: 'manage_api_token',
            status: 'completed',
            result: { id: 'token-1', name: 'Deploy', token: 'gw_secret' },
          },
        ],
      },
    ]) as Array<{ toolCalls: Array<{ result: unknown }> }>;

    expect(sanitized.toolCalls[0].result).toEqual({
      id: 'token-1',
      name: 'Deploy',
      token: '[REDACTED_ONE_TIME_SECRET]',
      tokenRedacted: true,
    });
  });
});

describe('AIConversationService conversation ordering', () => {
  it('sorts conversations by the latest user message time', () => {
    const olderUserMessageWithNewerAssistantUpdate = {
      id: 'older-user-message',
      createdAt: new Date('2026-06-26T09:00:00.000Z'),
      updatedAt: new Date('2026-06-26T12:00:00.000Z'),
      lastUserMessageAt: new Date('2026-06-26T09:30:00.000Z'),
    };
    const newerUserMessageWithOlderAssistantUpdate = {
      id: 'newer-user-message',
      createdAt: new Date('2026-06-26T08:00:00.000Z'),
      updatedAt: new Date('2026-06-26T10:00:00.000Z'),
      lastUserMessageAt: new Date('2026-06-26T10:30:00.000Z'),
    };

    expect(
      sortConversationSummariesByLastUserMessage([
        olderUserMessageWithNewerAssistantUpdate,
        newerUserMessageWithOlderAssistantUpdate,
      ]).map((conversation) => conversation.id)
    ).toEqual(['newer-user-message', 'older-user-message']);
  });
});
