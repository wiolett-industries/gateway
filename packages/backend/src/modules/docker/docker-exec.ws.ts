import type { WSContext } from 'hono/ws';
import { container } from '@/container.js';
import { createChildLogger } from '@/lib/logger.js';
import { hasScope } from '@/lib/permissions.js';
import { NodeDispatchService } from '@/services/node-dispatch.service.js';
import { NodeRegistryService } from '@/services/node-registry.service.js';
import { SessionService } from '@/services/session.service.js';
import type { User } from '@/types.js';

const logger = createChildLogger('DockerExec');

/**
 * Authenticate a session token and return the user if valid.
 * Mirrors the pattern from ai.ws.ts — always resolves live scopes from the group.
 */
async function authenticateFromToken(token: string): Promise<User | null> {
  if (token.startsWith('gw_')) return null; // API tokens not allowed for exec
  const sessionService = container.resolve(SessionService);
  const session = await sessionService.getSession(token);
  if (!session?.user) return null;

  const { AuthService } = await import('@/modules/auth/auth.service.js');
  const authService = container.resolve(AuthService);
  return authService.getUserById(session.user.id);
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
 * Create WebSocket handlers for Docker exec terminal sessions.
 *
 * Flow (persistent sessions):
 * 1. Client connects with ?token=<session>&shell=<shell>
 * 2. onOpen authenticates and asks daemon to create-or-reuse exec for this container
 * 3. Daemon creates a new exec OR reuses existing; sends buffered output first on reuse
 * 4. Daemon streams ExecOutput back; backend forwards to WebSocket
 * 5. Client sends { type: "input", data: "<base64>" } or { type: "resize", rows, cols }
 * 6. On WS disconnect, backend sends "detach" — daemon keeps exec alive, buffers output
 * 7. On reconnect, daemon replays buffered output then resumes live forwarding
 */
export function createDockerExecWSHandlers(nodeId: string, containerId: string, shell: string, token: string) {
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

      // Authenticate immediately from query token (same as AI WS pattern)
      authenticateAndCreateExec(ws, state, token, nodeId, containerId, shell, dispatch, registry).catch((err) => {
        logger.error('Auth/exec creation failed', { error: err instanceof Error ? err.message : String(err) });
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });
    },

    async onMessage(event: MessageEvent, ws: WSContext) {
      const state = wsStates.get(ws);
      if (!state) return;

      const raw = typeof event.data === 'string' ? event.data : String(event.data);

      if (!state.authenticated) {
        send(ws, { type: 'error', message: 'Not authenticated' });
        return;
      }

      let msg: Record<string, unknown>;
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
          send(ws, { type: 'error', message: 'Invalid message format' });
          return;
        }
        msg = parsed;
      } catch {
        send(ws, { type: 'error', message: 'Invalid JSON' });
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
          await dispatch.sendDockerExecCommand(nodeId, 'resize', {
            containerId,
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
      logger.info('Docker exec WS closed', { nodeId, containerId });
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
      logger.error('Docker exec WS error', { nodeId, containerId });
    },
  };
}

/**
 * Authenticate via session token and create/reuse the exec session on the daemon.
 * Called immediately on WebSocket open.
 */
async function authenticateAndCreateExec(
  ws: WSContext,
  state: ExecWSState,
  token: string,
  nodeId: string,
  containerId: string,
  shell: string,
  dispatch: NodeDispatchService,
  registry: NodeRegistryService
): Promise<void> {
  // Validate session token
  const user = await authenticateFromToken(token);
  if (!user) {
    send(ws, { type: 'auth_error', message: 'Invalid or expired token' });
    ws.close(1008, 'Authentication failed');
    return;
  }

  // Check docker:exec scope
  if (!hasScope(user.scopes, 'docker:containers:console')) {
    send(ws, { type: 'auth_error', message: 'Missing required scope: docker:exec' });
    ws.close(1008, 'Insufficient permissions');
    return;
  }

  // Check user is not blocked
  if (user.isBlocked) {
    send(ws, { type: 'auth_error', message: 'Account is blocked' });
    ws.close(1008, 'Account blocked');
    return;
  }

  state.user = user;
  state.authenticated = true;

  logger.info('Docker exec authenticated', { nodeId, containerId, userId: user.id });

  // Verify the node is connected
  const node = registry.getNode(nodeId);
  if (!node) {
    send(ws, { type: 'error', message: `Node ${nodeId} is not connected` });
    ws.close(1011, 'Node not connected');
    return;
  }

  // Auto-detect best available shell by reading /etc/shells
  let usedShell = shell && shell !== 'auto' ? shell : '/bin/sh';
  if (!shell || shell === 'auto') {
    try {
      const fileResult = await dispatch.sendDockerFileCommand(nodeId, 'read', {
        containerId,
        path: '/etc/shells',
        maxBytes: 4096,
      });
      if (fileResult.success && fileResult.detail) {
        // Daemon returns file content as base64
        let content = typeof fileResult.detail === 'string' ? fileResult.detail : '';
        try { content = Buffer.from(content, 'base64').toString('utf-8'); } catch { /* not base64, use as-is */ }
        const lines = content.split('\n').map((l: string) => l.trim()).filter((l: string) => l && !l.startsWith('#'));
        const preferred = ['/bin/bash', '/usr/bin/bash', '/bin/zsh', '/usr/bin/zsh', '/bin/ash', '/bin/sh'];
        for (const s of preferred) {
          if (lines.includes(s)) {
            usedShell = s;
            break;
          }
        }
      }
    } catch {
      // /etc/shells doesn't exist — fall back to /bin/sh
    }
    logger.info('Auto-detected shell', { nodeId, containerId, shell: usedShell });
  }

  // Create or reuse exec session on daemon
  let result: import('@/grpc/generated/types.js').CommandResult;
  try {
    result = await dispatch.sendDockerExecCommand(nodeId, 'create', {
      containerId,
      command: [usedShell],
      tty: true,
      stdin: true,
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

  // Parse exec ID, reuse flag, and buffer from the command result
  let execId: string | undefined;
  let isNew = true;
  let buffer: string[] = [];
  try {
    const parsed = JSON.parse(result.detail || '{}');
    execId = parsed.exec_id || parsed.execId || parsed.id;
    if (parsed.is_new === false || parsed.isNew === false) {
      isNew = false;
    }
    if (Array.isArray(parsed.buffer)) {
      buffer = parsed.buffer;
    }
  } catch {
    execId = result.detail || undefined;
  }

  if (!execId) {
    send(ws, { type: 'error', message: 'No exec ID returned from daemon' });
    ws.close(1011, 'No exec ID');
    return;
  }

  state.execId = execId;

  // Register handler for live ExecOutput from daemon -> forward to this WS
  const outputHandler = (output: any) => {
    if (output.data && output.data.length > 0) {
      const b64 = Buffer.isBuffer(output.data)
        ? output.data.toString('base64')
        : Buffer.from(output.data).toString('base64');
      send(ws, { type: 'output', data: b64 });
    }
    if (output.exited) {
      send(ws, { type: 'exit', exitCode: output.exitCode ?? 0 });
      try { ws.close(1000, 'Process exited'); } catch { /* */ }
    }
  };
  state.outputHandler = outputHandler;
  registry.registerExecHandler(execId, outputHandler);

  // Send buffered history to THIS client only (from the create response)
  if (!isNew && buffer.length > 0) {
    for (const b64chunk of buffer) {
      send(ws, { type: 'output', data: b64chunk });
    }
  }

  send(ws, { type: 'connected', execId, shell: usedShell, isNew });
}
