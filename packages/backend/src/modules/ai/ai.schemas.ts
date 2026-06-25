import { z } from 'zod';

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().nullable(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal('function'),
        function: z.object({
          name: z.string(),
          arguments: z.string(),
        }),
      })
    )
    .optional(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
});

export const PageContextSchema = z.object({
  route: z.string().max(200),
  resourceType: z.string().max(50).optional(),
  resourceId: z.string().max(100).optional(),
});

export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
  context: PageContextSchema.optional(),
});

export const AIConversationMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    toolCalls: z.array(z.unknown()).optional(),
    isStreaming: z.boolean().optional(),
    localOnly: z.boolean().optional(),
    rawToolCalls: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const SaveAIConversationSchema = z.object({
  title: z.string().trim().min(1).max(255),
  messages: z.array(AIConversationMessageSchema),
  lastContext: PageContextSchema.nullable().optional(),
});

export const UpdateAIConversationSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  messages: z.array(AIConversationMessageSchema).optional(),
  lastContext: PageContextSchema.nullable().optional(),
  discoveredToolsets: z.array(z.string().trim().min(1).max(100)).optional(),
  checkpoint: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const AIConfigUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  providerUrl: z.union([z.string().url(), z.literal('')]).optional(),
  endpointMode: z.enum(['auto', 'chat_completions', 'responses']).optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  customSystemPrompt: z.string().optional(),
  rateLimitMax: z.number().int().min(1).max(1000).optional(),
  rateLimitWindowSeconds: z.number().int().min(10).max(3600).optional(),
  maxToolRounds: z.number().int().min(1).max(50).optional(),
  maxContextTokens: z.number().int().min(4000).max(1000000).optional(),
  maxCompletionTokens: z.number().int().min(256).max(128000).optional(),
  maxTokensField: z.enum(['max_tokens', 'max_completion_tokens']).optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high', 'none']).optional(),
  disabledTools: z.array(z.string()).optional(),
  webSearchApiKey: z.string().optional(),
  webSearchProvider: z.enum(['tavily', 'brave', 'serper', 'searxng', 'exa']).optional(),
  webSearchBaseUrl: z.union([z.string().url(), z.literal('')]).optional(),
  sandboxEnabled: z.boolean().optional(),
  sandboxDefaultTier: z.enum(['low', 'medium', 'high']).optional(),
});

export const ToolApprovalSchema = z.object({
  toolCallId: z.string(),
  approved: z.boolean(),
});
