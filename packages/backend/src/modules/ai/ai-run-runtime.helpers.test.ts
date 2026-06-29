import { describe, expect, it } from 'vitest';
import { normalizeCheckpoint, toCheckpoint, toClientCheckpoint } from './ai-run-runtime.helpers.js';

describe('AI run runtime checkpoint helpers', () => {
  it('keeps server pending messages for resume but omits them from client checkpoints', () => {
    const raw = toCheckpoint({
      type: 'tool_approval_required',
      requestId: 'request-1',
      id: 'call-1',
      name: 'pull_docker_image',
      arguments: { imageRef: 'redis:latest' },
      _pendingMessages: [
        { role: 'system', content: 'server-only system prompt' },
        { role: 'user', content: 'pull redis' },
      ],
      _queuedApprovals: [{ id: 'call-2', name: 'restart_docker_container', arguments: { containerId: 'abc' } }],
    } as never);

    expect(normalizeCheckpoint(raw).pendingMessages).toEqual([
      { role: 'system', content: 'server-only system prompt' },
      { role: 'user', content: 'pull redis' },
    ]);
    expect(toClientCheckpoint(raw)).toEqual({
      type: 'tool_approval_required',
      requestId: 'request-1',
      allQuestions: [],
      queuedApprovals: [{ id: 'call-2', name: 'restart_docker_container', arguments: { containerId: 'abc' } }],
    });
  });
});

