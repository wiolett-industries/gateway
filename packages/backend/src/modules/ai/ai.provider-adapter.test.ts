import { describe, expect, it, vi } from 'vitest';
import { resolveAIProviderEndpoint, streamModelResponse } from './ai.provider-adapter.js';
import type { AIConfig } from './ai.types.js';

const BASE_CONFIG: AIConfig = {
  enabled: true,
  providerUrl: '',
  endpointMode: 'auto',
  model: 'gpt-5.4-mini',
  maxCompletionTokens: 1024,
  maxTokensField: 'max_completion_tokens',
  reasoningEffort: 'medium',
  customSystemPrompt: '',
  rateLimitMax: 10,
  rateLimitWindowSeconds: 60,
  maxToolRounds: 5,
  maxContextTokens: 56_000,
  disabledTools: [],
  webSearchEnabled: false,
  webSearchProvider: 'tavily',
  webSearchBaseUrl: '',
};

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'manage_docker_container_config',
      description: 'Manage container config',
      parameters: { type: 'object', properties: {} },
    },
  },
];

async function collectEvents(client: unknown, config: AIConfig = BASE_CONFIG) {
  const events = [];
  for await (const event of streamModelResponse({
    client: client as any,
    config,
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'set env' },
    ],
    tools: TOOLS,
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }
  return events;
}

describe('AI provider adapter', () => {
  it('uses Responses for default OpenAI auto mode and Chat for custom provider auto mode', () => {
    expect(resolveAIProviderEndpoint({ ...BASE_CONFIG, providerUrl: '' })).toBe('responses');
    expect(resolveAIProviderEndpoint({ ...BASE_CONFIG, providerUrl: 'https://api.openai.com/v1' })).toBe('responses');
    expect(resolveAIProviderEndpoint({ ...BASE_CONFIG, providerUrl: 'https://llm.example.com/v1' })).toBe(
      'chat_completions'
    );
    expect(resolveAIProviderEndpoint({ ...BASE_CONFIG, endpointMode: 'chat_completions' })).toBe('chat_completions');
  });

  it('normalizes Responses text and function call streaming events', async () => {
    async function* responseStream() {
      yield { type: 'response.output_text.delta', delta: 'Checking ' };
      yield {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'manage_docker_container_config',
          arguments: '',
        },
      };
      yield { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"containerId"' };
      yield {
        type: 'response.function_call_arguments.done',
        output_index: 0,
        item_id: 'item-1',
        name: 'manage_docker_container_config',
        arguments: '{"containerId":"container-1"}',
      };
    }
    const create = vi.fn().mockResolvedValue(responseStream());
    const events = await collectEvents({ responses: { create } });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.4-mini',
        stream: true,
        store: false,
        reasoning: { effort: 'medium' },
      }),
      expect.any(Object)
    );
    expect(events).toEqual([
      { type: 'text_delta', content: 'Checking ' },
      {
        type: 'model_response',
        response: {
          content: 'Checking ',
          toolCalls: [
            {
              id: 'call-1',
              name: 'manage_docker_container_config',
              arguments: '{"containerId":"container-1"}',
            },
          ],
        },
      },
    ]);
  });

  it('normalizes Chat Completions text and tool call streaming chunks', async () => {
    async function* chatStream() {
      yield { choices: [{ delta: { content: 'Checking ' } }] };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call-1',
                  function: { name: 'manage_docker_container_config', arguments: '{"containerId"' },
                },
              ],
            },
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: ':"container-1"}' },
                },
              ],
            },
          },
        ],
      };
    }
    const create = vi.fn().mockResolvedValue(chatStream());
    const events = await collectEvents(
      { chat: { completions: { create } } },
      { ...BASE_CONFIG, endpointMode: 'chat_completions' }
    );

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ stream: true }));
    expect(events).toEqual([
      { type: 'text_delta', content: 'Checking ' },
      {
        type: 'model_response',
        response: {
          content: 'Checking ',
          toolCalls: [
            {
              id: 'call-1',
              name: 'manage_docker_container_config',
              arguments: '{"containerId":"container-1"}',
            },
          ],
        },
      },
    ]);
  });
});
