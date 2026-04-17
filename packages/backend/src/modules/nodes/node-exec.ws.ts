import { eq } from 'drizzle-orm';
import type { WSContext } from 'hono/ws';
import { container, TOKENS } from '@/container.js';
import type { DrizzleClient } from '@/db/client.js';
import { permissionGroups } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { hasScope } from '@/lib/permissions.js';
import { NodeDispatchService } from '@/services/node-dispatch.service.js';
import { NodeRegistryService } from '@/services/node-registry.service.js';
import { SessionService } from '@/services/session.service.js';
import type { User } from '@/types.js';

const logger = createChildLogger('NodeExec');

async function resolveLiveSessionUser(token: string): Promise<{ user: User; effectiveScopes: string[] } | null> {
  if (token.startsWith('gw_')) return null;
  const sessionService = container.resolve(SessionService);
  const session = await sessionService.getSession(token);
  if (!session?.user) return null;

  const { AuthService } = await import('@/modules/auth/auth.service.js');
  const authService = container.resolve(AuthService);
  const user = await authService.getUserById(session.user.id);
  if (!user) return null;

  const db = container.resolve<DrizzleClient>(TOKENS.DrizzleClient);
  const allGroups = await db.query.permissionGroups.findMany({
    columns: { id: true, parentId: true, scopes: true, name: true },
  });
  const groupMap = new Map(allGroups.map((group) => [group.id, group]));
  const group = groupMap.get(user.groupId);
  const scopeSet = new Set<string>();

  if (group) {
    for (const scope of (group.scopes as string[]) ?? []) scopeSet.add(scope);
    const visited = new Set<string>([group.id]);
    let parent = group.parentId ? groupMap.get(group.parentId) : undefined;
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      for (const scope of (parent.scopes as string[]) ?? []) scopeSet.add(scope);
      parent = parent.parentId ? groupMap.get(parent.parentId) : undefined;
    }
  } else {
    const freshGroup = await db.query.permissionGroups.findFirst({
      where: eq(permissionGroups.id, user.groupId),
      columns: { scopes: true, name: true },
    });
    for (const scope of (freshGroup?.scopes as string[]) ?? []) scopeSet.add(scope);
  }

  const effectiveScopes = [...scopeSet];
  return {
    user: {
      ...user,
      scopes: effectiveScopes,
      groupName: group?.name ?? user.groupName,
    },
    effectiveScopes,
  };
}

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
      };
      wsStates.set(ws, state);

      state.keepaliveInterval = setInterval(() => {
        try {
          ws.send(JSON.stringify({ type: 'pong' }));
        } catch {
          if (state.keepaliveInterval) clearInterval(state.keepaliveInterval);
        }
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
        try {
          const inputData = Buffer.from(msg.data as string, 'base64');
          dispatch.sendExecInput(nodeId, state.execId, inputData);
        } catch (err) {
          logger.error('Error forwarding exec input', { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      if (msg.type === 'resize' && state.execId) {
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
