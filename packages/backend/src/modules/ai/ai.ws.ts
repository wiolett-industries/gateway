import type { WSContext } from 'hono/ws';
import { container, TOKENS } from '@/container.js';
import { createChildLogger } from '@/lib/logger.js';
import { canUseAI } from '@/lib/permissions.js';
import { SessionService } from '@/services/session.service.js';
import type { User } from '@/types.js';
import { AIService } from './ai.service.js';
import { AISettingsService } from './ai.settings.service.js';
import type { PageContext, WSClientMessage, WSServerMessage } from './ai.types.js';

const logger = createChildLogger('AI-WebSocket');

type RedisClient = ReturnType<typeof import('@/services/cache.service.js').createRedisClient>;

interface PendingApproval {
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  messages: Record<string, unknown>[];
  pageContext?: PageContext;
  allQuestions?: Array<{ id: string; args: Record<string, unknown> }>;
}

interface WSConnectionState {
  user: User | null;
  sessionToken: string | null;
  authenticated: boolean;
  currentAbortController: AbortController | null;
  currentRequestId: string | null;
  pendingApproval: PendingApproval | null;
  keepaliveInterval: ReturnType<typeof setInterval> | null;
}

function send(ws: WSContext, msg: WSServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Connection may be closed
  }
}

async function authenticateFromToken(token: string): Promise<User | null> {
  // API tokens cannot access AI — sessions only
  if (token.startsWith('gw_')) return null;
  const sessionService = container.resolve(SessionService);
  const session = await sessionService.getSession(token);
  return session?.user ?? null;
}

async function checkRateLimit(userId: string): Promise<{ allowed: boolean; retryAfter: number }> {
  const settingsService = container.resolve(AISettingsService);
  const config = await settingsService.getConfig();
  const redis = container.resolve<RedisClient>(TOKENS.RedisClient);

  const key = `ai-ratelimit:${userId}`;
  const now = Date.now();
  const windowMs = config.rateLimitWindowSeconds * 1000;
  const windowStart = now - windowMs;

  try {
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);
    pipeline.zadd(key, now, `${now}-${Math.random()}`);
    pipeline.expire(key, config.rateLimitWindowSeconds + 1);

    const results = await pipeline.exec();
    if (!results) return { allowed: true, retryAfter: 0 };

    const requestCount = (results[1]?.[1] as number) || 0;
    if (requestCount >= config.rateLimitMax) {
      return { allowed: false, retryAfter: config.rateLimitWindowSeconds };
    }
    return { allowed: true, retryAfter: 0 };
  } catch {
    return { allowed: true, retryAfter: 0 };
  }
}

// WeakMap to store per-connection state
const wsStates = new WeakMap<WSContext, WSConnectionState>();

export function createWSHandlers() {
  return {
    onOpen(_event: Event, ws: WSContext) {
      const state: WSConnectionState = {
        user: null,
        sessionToken: null,
        authenticated: false,
        currentAbortController: null,
        currentRequestId: null,
        pendingApproval: null,
        keepaliveInterval: null,
      };

      wsStates.set(ws, state);

      state.keepaliveInterval = setInterval(() => {
        try {
          ws.send(JSON.stringify({ type: 'pong' }));
        } catch {
          if (state.keepaliveInterval) clearInterval(state.keepaliveInterval);
        }
      }, 30_000);
    },

    async onMessage(event: MessageEvent, ws: WSContext) {
      const state = wsStates.get(ws);
      if (!state) return;

      let msg: WSClientMessage;
      try {
        const raw = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') {
          send(ws, { type: 'error', requestId: '', message: 'Invalid message format' });
          return;
        }
        msg = raw as WSClientMessage;
      } catch {
        send(ws, { type: 'error', requestId: '', message: 'Invalid JSON' });
        return;
      }

      if (msg.type === 'ping') {
        send(ws, { type: 'pong' });
        return;
      }

      if (!state.authenticated) {
        send(ws, { type: 'auth_error', message: 'Not authenticated' });
        return;
      }

      // Re-validate session on each message to catch role changes
      if (state.sessionToken) {
        const freshUser = await authenticateFromToken(state.sessionToken);
        if (!freshUser || !canUseAI(freshUser.role)) {
          send(ws, { type: 'auth_error', message: 'Session expired or role changed' });
          try { ws.close(); } catch { /* ignore */ }
          return;
        }
        state.user = freshUser;
      }

      const user = state.user!;

      if (msg.type === 'cancel') {
        if (state.currentAbortController) {
          state.currentAbortController.abort();
          state.currentAbortController = null;
        }
        state.pendingApproval = null;
        send(ws, { type: 'done', requestId: msg.requestId });
        return;
      }

      if (msg.type === 'tool_approval') {
        const pending = state.pendingApproval;
        logger.info('Tool approval received', {
          msgToolCallId: msg.toolCallId,
          pendingToolCallId: pending?.toolCallId,
          pendingToolName: pending?.toolName,
        });
        if (!pending || pending.toolCallId !== msg.toolCallId) {
          send(ws, { type: 'error', requestId: msg.requestId, message: 'No pending approval for this tool call' });
          return;
        }

        state.pendingApproval = null;
        const aiService = container.resolve(AIService);
        const abortController = new AbortController();
        state.currentAbortController = abortController;

        try {
          const generator = aiService.resumeAfterApproval(
            user,
            pending.toolCallId,
            pending.toolName,
            pending.toolArgs,
            msg.approved,
            pending.messages,
            pending.pageContext,
            abortController.signal,
            msg.requestId,
            (msg as any).answer,
            (msg as any).answers
          );

          for await (const evt of generator) {
            if (evt.type === 'tool_approval_required') {
              const approvalEvt = evt as any;
              state.pendingApproval = {
                toolCallId: approvalEvt.id,
                toolName: approvalEvt.name,
                toolArgs: approvalEvt.arguments,
                messages: approvalEvt._pendingMessages || pending.messages,
                pageContext: pending.pageContext,
                allQuestions: approvalEvt._allQuestions,
              };
              const { _pendingMessages, _allQuestions, ...clientEvt } = approvalEvt;
              send(ws, clientEvt);
            } else {
              send(ws, evt);
            }
          }
        } catch (err) {
          if (!(err instanceof Error && err.name === 'AbortError')) {
            send(ws, {
              type: 'error',
              requestId: msg.requestId,
              message: err instanceof Error ? err.message : 'Error',
            });
            send(ws, { type: 'done', requestId: msg.requestId });
          }
        } finally {
          state.currentAbortController = null;
        }
        return;
      }

      if (msg.type === 'chat') {
        const rateCheck = await checkRateLimit(user.id);
        if (!rateCheck.allowed) {
          send(ws, { type: 'rate_limited', retryAfter: rateCheck.retryAfter });
          return;
        }

        const aiService = container.resolve(AIService);
        const abortController = new AbortController();
        state.currentAbortController = abortController;
        state.currentRequestId = msg.requestId;

        try {
          const generator = aiService.streamChat(
            user,
            msg.messages,
            msg.context,
            abortController.signal,
            msg.requestId
          );

          for await (const evt of generator) {
            if (evt.type === 'tool_approval_required') {
              const approvalEvt = evt as any;
              state.pendingApproval = {
                toolCallId: approvalEvt.id,
                toolName: approvalEvt.name,
                toolArgs: approvalEvt.arguments,
                messages: approvalEvt._pendingMessages || [],
                pageContext: msg.context,
                allQuestions: approvalEvt._allQuestions,
              };
              const { _pendingMessages, _allQuestions, ...clientEvt } = approvalEvt;
              send(ws, clientEvt);
            } else {
              send(ws, evt);
            }
          }
        } catch (err) {
          if (!(err instanceof Error && err.name === 'AbortError')) {
            send(ws, {
              type: 'error',
              requestId: msg.requestId,
              message: err instanceof Error ? err.message : 'Error',
            });
            send(ws, { type: 'done', requestId: msg.requestId });
          }
        } finally {
          state.currentAbortController = null;
          state.currentRequestId = null;
        }
        return;
      }
    },

    onClose(_event: unknown, ws: WSContext) {
      const state = wsStates.get(ws);
      if (state) {
        if (state.currentAbortController) state.currentAbortController.abort();
        if (state.keepaliveInterval) clearInterval(state.keepaliveInterval);
        wsStates.delete(ws);
      }
    },

    onError(_error: Event, ws: WSContext) {
      logger.error('WebSocket error');
      const state = wsStates.get(ws);
      if (state) {
        if (state.currentAbortController) state.currentAbortController.abort();
        if (state.keepaliveInterval) clearInterval(state.keepaliveInterval);
        wsStates.delete(ws);
      }
    },
  };
}

/**
 * Authenticate and initialize a WS connection from the query token.
 * Called during the WS upgrade / onOpen.
 */
export async function authenticateWSConnection(ws: WSContext, token: string): Promise<boolean> {
  const state = wsStates.get(ws);
  if (!state) return false;

  const user = await authenticateFromToken(token);
  if (!user) {
    send(ws, { type: 'auth_error', message: 'Invalid or expired token' });
    return false;
  }

  if (!canUseAI(user.role)) {
    send(ws, { type: 'auth_error', message: 'Insufficient permissions to use AI assistant' });
    return false;
  }

  const settingsService = container.resolve(AISettingsService);
  const enabled = await settingsService.isEnabled();
  if (!enabled) {
    send(ws, { type: 'auth_error', message: 'AI assistant is not enabled' });
    return false;
  }

  state.user = user;
  state.sessionToken = token;
  state.authenticated = true;
  send(ws, { type: 'auth_ok', userId: user.id });
  return true;
}
