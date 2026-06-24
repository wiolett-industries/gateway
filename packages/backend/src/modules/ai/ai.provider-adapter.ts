import type OpenAI from 'openai';
import type { AIConfig } from './ai.types.js';

export interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface NormalizedModelResponse {
  content: string;
  toolCalls: NormalizedToolCall[];
}

export type ModelProviderEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'model_response'; response: NormalizedModelResponse };

interface StreamModelOptions {
  client: OpenAI;
  config: AIConfig;
  messages: Record<string, unknown>[];
  tools: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
  signal: AbortSignal;
}

type ProviderEndpoint = 'chat_completions' | 'responses';

export function resolveAIProviderEndpoint(config: AIConfig): ProviderEndpoint {
  if (config.endpointMode === 'chat_completions' || config.endpointMode === 'responses') {
    return config.endpointMode;
  }
  const providerUrl = config.providerUrl.trim();
  if (!providerUrl) return 'responses';
  try {
    const hostname = new URL(providerUrl).hostname.toLowerCase();
    return hostname === 'api.openai.com' || hostname.endsWith('.openai.com') ? 'responses' : 'chat_completions';
  } catch {
    return 'chat_completions';
  }
}

export async function* streamModelResponse(options: StreamModelOptions): AsyncGenerator<ModelProviderEvent> {
  const endpoint = resolveAIProviderEndpoint(options.config);
  if (endpoint === 'responses') {
    yield* streamResponsesModel(options);
    return;
  }
  yield* streamChatCompletionsModel(options);
}

async function* streamChatCompletionsModel({
  client,
  config,
  messages,
  tools,
  signal,
}: StreamModelOptions): AsyncGenerator<ModelProviderEvent> {
  const stream = await client.chat.completions.create({
    model: config.model || 'gpt-4o',
    messages: messages as unknown as OpenAI.ChatCompletionMessageParam[],
    tools: tools.length > 0 ? (tools as OpenAI.ChatCompletionTool[]) : undefined,
    stream: true,
    ...(config.maxTokensField === 'max_tokens'
      ? { max_tokens: config.maxCompletionTokens }
      : { max_completion_tokens: config.maxCompletionTokens }),
    ...(config.reasoningEffort && config.reasoningEffort !== 'none'
      ? ({ reasoning_effort: config.reasoningEffort } as Record<string, unknown>)
      : {}),
  });

  let content = '';
  const toolCallAccumulators = new Map<number, NormalizedToolCall>();

  for await (const chunk of stream) {
    if (signal.aborted) throw abortError();

    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      content += delta.content;
      yield { type: 'text_delta', content: delta.content };
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!toolCallAccumulators.has(idx)) {
          toolCallAccumulators.set(idx, { id: tc.id || '', name: tc.function?.name || '', arguments: '' });
        }
        const acc = toolCallAccumulators.get(idx)!;
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        if (tc.function?.arguments) acc.arguments += tc.function.arguments;
      }
    }
  }

  yield { type: 'model_response', response: { content, toolCalls: Array.from(toolCallAccumulators.values()) } };
}

function toResponsesTools(tools: StreamModelOptions['tools']): Array<{
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean | null;
}> {
  return tools.map((tool) => ({
    type: 'function' as const,
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: null,
  }));
}

function splitInstructions(messages: Record<string, unknown>[]): { instructions: string | null; input: unknown[] } {
  const instructions: string[] = [];
  const input: unknown[] = [];

  for (const message of messages) {
    const role = message.role;
    const content = typeof message.content === 'string' ? message.content : '';

    if (role === 'system') {
      if (content) instructions.push(content);
      continue;
    }

    if (role === 'tool') {
      const callId = typeof message.tool_call_id === 'string' ? message.tool_call_id : undefined;
      if (!callId) continue;
      input.push({ type: 'function_call_output', call_id: callId, output: content || '{}' });
      continue;
    }

    if (role === 'assistant') {
      if (content) input.push({ role: 'assistant', content });
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      for (const toolCall of toolCalls) {
        if (!toolCall || typeof toolCall !== 'object') continue;
        const call = toolCall as {
          id?: unknown;
          function?: { name?: unknown; arguments?: unknown };
        };
        const callId = typeof call.id === 'string' ? call.id : undefined;
        const name = typeof call.function?.name === 'string' ? call.function.name : undefined;
        if (!callId || !name) continue;
        input.push({
          type: 'function_call',
          call_id: callId,
          name,
          arguments: typeof call.function?.arguments === 'string' ? call.function.arguments : '{}',
        });
      }
      continue;
    }

    if (role === 'user' && content) {
      input.push({ role: 'user', content });
    }
  }

  return { instructions: instructions.join('\n\n') || null, input };
}

async function* streamResponsesModel({
  client,
  config,
  messages,
  tools,
  signal,
}: StreamModelOptions): AsyncGenerator<ModelProviderEvent> {
  const { instructions, input } = splitInstructions(messages);
  const stream = await client.responses.create(
    {
      model: config.model || 'gpt-4o',
      instructions,
      input: input as any,
      tools: tools.length > 0 ? (toResponsesTools(tools) as any) : undefined,
      stream: true,
      store: false,
      max_output_tokens: config.maxCompletionTokens,
      parallel_tool_calls: true,
      ...(config.reasoningEffort && config.reasoningEffort !== 'none'
        ? ({ reasoning: { effort: config.reasoningEffort } } as Record<string, unknown>)
        : {}),
    },
    { signal }
  );

  let content = '';
  const byOutputIndex = new Map<number, NormalizedToolCall>();

  for await (const event of stream) {
    if (signal.aborted) throw abortError();

    if (event.type === 'response.output_text.delta') {
      content += event.delta;
      yield { type: 'text_delta', content: event.delta };
      continue;
    }

    if (event.type === 'response.output_item.added' && event.item.type === 'function_call') {
      byOutputIndex.set(event.output_index, {
        id: event.item.call_id,
        name: event.item.name,
        arguments: event.item.arguments || '',
      });
      continue;
    }

    if (event.type === 'response.function_call_arguments.delta') {
      const acc = byOutputIndex.get(event.output_index);
      if (acc) acc.arguments += event.delta;
      continue;
    }

    if (event.type === 'response.function_call_arguments.done') {
      const acc = byOutputIndex.get(event.output_index);
      if (acc) {
        acc.name = event.name;
        acc.arguments = event.arguments;
      } else {
        byOutputIndex.set(event.output_index, {
          id: event.item_id,
          name: event.name,
          arguments: event.arguments,
        });
      }
    }
  }

  yield { type: 'model_response', response: { content, toolCalls: Array.from(byOutputIndex.values()) } };
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}
