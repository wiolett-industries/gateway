import type { ChatMessage, PageContext, WSServerMessage } from './ai.types.js';

export interface AIModelCheckpoint {
  pendingMessages: Record<string, unknown>[];
  allQuestions: Array<{ id: string; args: Record<string, unknown> }>;
  queuedApprovals: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

export function toPageContext(value: Record<string, unknown> | null): PageContext | undefined {
  if (!value || typeof value.route !== 'string') return undefined;
  return {
    route: value.route,
    resourceType: typeof value.resourceType === 'string' ? value.resourceType : undefined,
    resourceId: typeof value.resourceId === 'string' ? value.resourceId : undefined,
  };
}

export function toChatMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  const role = message.role;
  if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') return null;
  return {
    role,
    content: typeof message.content === 'string' ? message.content : null,
    attachments: Array.isArray(message.attachments) ? (message.attachments as ChatMessage['attachments']) : undefined,
    tool_calls: Array.isArray(message.tool_calls) ? (message.tool_calls as ChatMessage['tool_calls']) : undefined,
    tool_call_id: typeof message.tool_call_id === 'string' ? message.tool_call_id : undefined,
    name: typeof message.name === 'string' ? message.name : undefined,
  };
}

export function questionTextFromArgs(args: Record<string, unknown>): string {
  return typeof args.question === 'string' && args.question.trim()
    ? args.question
    : 'The assistant needs clarification.';
}

export function toCheckpoint(event: WSServerMessage): Record<string, unknown> {
  const payload = event as WSServerMessage & {
    _pendingMessages?: unknown;
    _allQuestions?: unknown;
    _queuedApprovals?: unknown;
  };
  return {
    type: event.type,
    requestId: 'requestId' in event ? event.requestId : undefined,
    pendingMessages: Array.isArray(payload._pendingMessages) ? payload._pendingMessages : [],
    allQuestions: Array.isArray(payload._allQuestions) ? payload._allQuestions : [],
    queuedApprovals: Array.isArray(payload._queuedApprovals) ? payload._queuedApprovals : [],
  };
}

export function normalizeCheckpoint(value: Record<string, unknown> | null): AIModelCheckpoint {
  if (!value) {
    return { pendingMessages: [], allQuestions: [], queuedApprovals: [] };
  }

  return {
    pendingMessages: Array.isArray(value.pendingMessages) ? value.pendingMessages.filter(isRecord) : [],
    allQuestions: Array.isArray(value.allQuestions)
      ? value.allQuestions
          .map(normalizeCheckpointQuestion)
          .filter((question): question is { id: string; args: Record<string, unknown> } => question !== null)
      : [],
    queuedApprovals: Array.isArray(value.queuedApprovals)
      ? value.queuedApprovals
          .map(normalizeQueuedApproval)
          .filter(
            (approval): approval is { id: string; name: string; arguments: Record<string, unknown> } =>
              approval !== null
          )
      : [],
  };
}

export function toClientCheckpoint(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) return null;
  return {
    type: typeof value.type === 'string' ? value.type : undefined,
    requestId: typeof value.requestId === 'string' ? value.requestId : undefined,
    allQuestions: Array.isArray(value.allQuestions)
      ? value.allQuestions.map(normalizeCheckpointQuestion).filter((question) => question !== null)
      : [],
    queuedApprovals: Array.isArray(value.queuedApprovals)
      ? value.queuedApprovals.map(normalizeQueuedApproval).filter((approval) => approval !== null)
      : [],
  };
}

function normalizeCheckpointQuestion(value: unknown): { id: string; args: Record<string, unknown> } | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  return {
    id: value.id,
    args: isRecord(value.args) ? value.args : {},
  };
}

function normalizeQueuedApproval(
  value: unknown
): { id: string; name: string; arguments: Record<string, unknown> } | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  return {
    id: value.id,
    name: value.name,
    arguments: isRecord(value.arguments) ? value.arguments : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
