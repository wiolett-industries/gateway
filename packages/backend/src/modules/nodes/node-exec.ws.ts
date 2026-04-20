import type { WSContext } from 'hono/ws';
import { container } from '@/container.js';
import { createChildLogger } from '@/lib/logger.js';
import { hasScope } from '@/lib/permissions.js';
import { resolveLiveSessionUser } from '@/modules/auth/live-session-user.js';
import { NodeDispatchService } from '@/services/node-dispatch.service.js';
import { NodeRegistryService } from '@/services/node-registry.service.js';
import type { User } from '@/types.js';

const logger = createChildLogger('NodeExec');

function send(ws: WSContext, msg: Record<string, unknown>): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Connection may already be closed
  }
}

interface ExecWSState {
  user: User | null;
  authenticated: boolean;
  execId: string | null;
  outputHandler: ((data: any) => void) | null;
  keepaliveInterval: ReturnType<typeof setInterval> | null;
  token: string;
}

const wsStates = new WeakMap<WSContext, ExecWSState>();

/**
 * Create WebSocket handlers for node-level console sessions.
 * Same pattern as Docker exec but uses NodeExecCommand (host-level PTY).
 */
export function createNodeExecWSHandlers(nodeId: string, shell: string, token: string) {
  const dispatch = container.resolve(NodeDispatchService);
  const registry = container.resolve(NodeRegistryService);

  return {
    onOpen(_event: Event, ws: WSContext) {
      const state: ExecWSState = {
        user: null,
        authenticated: false,
        execId: null,
        outputHandler: null,
        keepaliveInterval: null,
        token,
      };
      wsStates.set(ws, state);

      state.keepaliveInterval = setInterval(() => {
        void revalidateNodeExecAccess(ws, state, nodeId, true);
      }, 30_000);

      authenticateAndCreateExec(ws, state, token, nodeId, shell, dispatch, registry).catch((err) => {
        logger.error('Auth/exec creation failed', { error: err instanceof Error ? err.message : String(err) });
        try {
          ws.close();
        } catch {
          /* */
        }
      });
    },

    async onMessage(event: MessageEvent, ws: WSContext) {
      const state = wsStates.get(ws);
      if (!state?.authenticated) return;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        if (!msg || typeof msg.type !== 'string') return;
      } catch {
        return;
      }

      if (msg.type === 'ping') {
        send(ws, { type: 'pong' });
        return;
      }

      if (msg.type === 'input' && state.execId) {
        if (!(await revalidateNodeExecAccess(ws, state, nodeId))) return;
        try {
          const inputData = Buffer.from(msg.data as string, 'base64');
          dispatch.sendExecInput(nodeId, state.execId, inputData);
        } catch (err) {
          logger.error('Error forwarding exec input', { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      if (msg.type === 'resize' && state.execId) {
        if (!(await revalidateNodeExecAccess(ws, state, nodeId))) return;
        try {
          await dispatch.sendNodeExecCommand(nodeId, 'resize', {
            rows: msg.rows as number,
            cols: msg.cols as number,
          });
        } catch (err) {
          logger.error('Error sending resize', { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
    },

    onClose(_event: unknown, ws: WSContext) {
      const state = wsStates.get(ws);
      if (state) {
        if (state.execId) {
          registry.removeExecHandler(state.execId, state.outputHandler ?? undefined);
        }
        if (state.keepaliveInterval) clearInterval(state.keepaliveInterval);
        wsStates.delete(ws);
      }
      logger.info('Node exec WS closed', { nodeId });
    },

    onError(_error: Event, ws: WSContext) {
      const state = wsStates.get(ws);
      if (state) {
        if (state.execId) {
          registry.removeExecHandler(state.execId, state.outputHandler ?? undefined);
        }
        if (state.keepaliveInterval) clearInterval(state.keepaliveInterval);
        wsStates.delete(ws);
      }
      logger.error('Node exec WS error', { nodeId });
    },
  };
}

async function authenticateAndCreateExec(
  ws: WSContext,
  state: ExecWSState,
  token: string,
  nodeId: string,
  shell: string,
  dispatch: NodeDispatchService,
  registry: NodeRegistryService
): Promise<void> {
  const authResult = await resolveLiveSessionUser(token);
  if (!authResult) {
    send(ws, { type: 'auth_error', message: 'Invalid or expired token' });
    ws.close(1008, 'Authentication failed');
    return;
  }
  const { user, effectiveScopes } = authResult;

  if (!hasScope(effectiveScopes, `nodes:console:${nodeId}`)) {
    send(ws, { type: 'auth_error', message: `Missing required scope: nodes:console:${nodeId}` });
    ws.close(1008, 'Insufficient permissions');
    return;
  }

  if (user.isBlocked) {
    send(ws, { type: 'auth_error', message: 'Account is blocked' });
    ws.close(1008, 'Account blocked');
    return;
  }

  state.user = user;
  state.authenticated = true;

  logger.info('Node exec authenticated', { nodeId, userId: user.id });

  const node = registry.getNode(nodeId);
  if (!node) {
    send(ws, { type: 'error', message: `Node ${nodeId} is not connected` });
    ws.close(1011, 'Node not connected');
    return;
  }

  // Create or reuse node-level exec session
  const command = shell && shell !== 'auto' ? [shell] : [];
  let result: import('@/grpc/generated/types.js').CommandResult;
  try {
    result = await dispatch.sendNodeExecCommand(nodeId, 'create', {
      command,
      tty: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create exec session';
    send(ws, { type: 'error', message });
    ws.close(1011, 'Exec creation failed');
    return;
  }

  if (!result.success) {
    send(ws, { type: 'error', message: result.error || 'Exec creation failed' });
    ws.close(1011, 'Exec creation failed');
    return;
  }

  let execId: string | undefined;
  let isNew = true;
  let buffer: string[] = [];
  let usedShell = shell || 'auto';
  try {
    const parsed = JSON.parse(result.detail || '{}');
    execId = parsed.exec_id || parsed.execId || parsed.id;
    if (parsed.is_new === false || parsed.isNew === false) isNew = false;
    if (Array.isArray(parsed.buffer)) buffer = parsed.buffer;
    if (parsed.shell) usedShell = parsed.shell;
  } catch {
    execId = result.detail || undefined;
  }

  if (!execId) {
    send(ws, { type: 'error', message: 'No exec ID returned from daemon' });
    ws.close(1011, 'No exec ID');
    return;
  }

  state.execId = execId;

  const outputHandler = (output: any) => {
    void (async () => {
      if (!(await revalidateNodeExecAccess(ws, state, nodeId))) return;
      if (output.data && output.data.length > 0) {
        const b64 = Buffer.isBuffer(output.data)
          ? output.data.toString('base64')
          : Buffer.from(output.data).toString('base64');
        send(ws, { type: 'output', data: b64 });
      }
      if (output.exited) {
        send(ws, { type: 'exit', exitCode: output.exitCode ?? 0 });
        try {
          ws.close(1000, 'Process exited');
        } catch {
          /* */
        }
      }
    })();
  };
  state.outputHandler = outputHandler;
  registry.registerExecHandler(execId, outputHandler);

  if (!isNew && buffer.length > 0) {
    for (const b64chunk of buffer) {
      send(ws, { type: 'output', data: b64chunk });
    }
  }

  send(ws, { type: 'connected', execId, shell: usedShell, isNew });
}

async function revalidateNodeExecAccess(
  ws: WSContext,
  state: ExecWSState,
  nodeId: string,
  emitPong = false
): Promise<boolean> {
  const authResult = await resolveLiveSessionUser(state.token);
  if (!authResult || authResult.user.isBlocked || !hasScope(authResult.effectiveScopes, `nodes:console:${nodeId}`)) {
    state.authenticated = false;
    send(ws, { type: 'auth_error', message: 'Access revoked or token expired' });
    try {
      ws.close(1008, 'Authentication failed');
    } catch {
      /* */
    }
    return false;
  }

  state.user = authResult.user;
  if (emitPong) {
    try {
      ws.send(JSON.stringify({ type: 'pong' }));
    } catch {
      if (state.keepaliveInterval) clearInterval(state.keepaliveInterval);
    }
  }
  return true;
}
