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
  route: z.string(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
});

export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
  context: PageContextSchema.optional(),
});

export const AIConfigUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  providerUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  customSystemPrompt: z.string().optional(),
  rateLimitMax: z.number().int().min(1).max(1000).optional(),
  rateLimitWindowSeconds: z.number().int().min(10).max(3600).optional(),
  maxToolRounds: z.number().int().min(1).max(50).optional(),
  maxCompletionTokens: z.number().int().min(256).max(128000).optional(),
  maxTokensField: z.enum(['max_tokens', 'max_completion_tokens']).optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high', 'none']).optional(),
  disabledTools: z.array(z.string()).optional(),
  webSearchApiKey: z.string().optional(),
  webSearchProvider: z.enum(['tavily', 'brave', 'serper', 'searxng', 'exa']).optional(),
  webSearchBaseUrl: z.string().optional(),
});

export const ToolApprovalSchema = z.object({
  toolCallId: z.string(),
  approved: z.boolean(),
});
