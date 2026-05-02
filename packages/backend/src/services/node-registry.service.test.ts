import { describe, expect, it, vi } from 'vitest';
import { NodeRegistryService } from './node-registry.service.js';

describe('NodeRegistryService', () => {
  function makeDb() {
    return {
      select: vi.fn((selection?: Record<string, unknown>) => ({
        from: () => ({
          where: () => {
            if (selection && 'id' in selection && 'hostname' in selection) {
              return Promise.resolve([{ id: 'node-1', hostname: 'worker-1' }]);
            }

            return {
              limit: () => Promise.resolve([{ healthHistory: [] }]),
            };
          },
        }),
      })),
      update: vi.fn(() => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      })),
    };
  }

  it('observes ongoing disconnected offline nodes for stateful notification windows', async () => {
    const db = makeDb();
    const evaluator = {
      observeStatefulEvent: vi.fn().mockResolvedValue(undefined),
    };
    const registry = new NodeRegistryService(db as never);
    registry.setEvaluator(evaluator as never);

    await registry.recordHealthChecks();

    expect(evaluator.observeStatefulEvent).toHaveBeenCalledWith(
      'node',
      'offline',
      { type: 'node', id: 'node-1', name: 'worker-1' },
      { hostname: 'worker-1' }
    );
  });

  it('closes replaced command and log streams when a node reconnects', async () => {
    const registry = new NodeRegistryService(makeDb() as never);
    const oldCommandStream = { end: vi.fn(), destroy: vi.fn() };
    const oldLogStream = { end: vi.fn(), destroy: vi.fn() };
    const newCommandStream = { end: vi.fn(), destroy: vi.fn() };

    await registry.register('node-1', 'nginx', 'worker-1', 'hash-1', oldCommandStream as never);
    const connected = registry.getNode('node-1');
    if (connected) connected.logStream = oldLogStream as never;

    await registry.register('node-1', 'nginx', 'worker-1', 'hash-2', newCommandStream as never);

    expect(oldCommandStream.end).toHaveBeenCalled();
    expect(oldCommandStream.destroy).toHaveBeenCalled();
    expect(oldLogStream.end).toHaveBeenCalled();
    expect(oldLogStream.destroy).toHaveBeenCalled();
  });

  it('does not register a node when the DB online update fails', async () => {
    const db = makeDb();
    db.update.mockReturnValueOnce({
      set: () => ({
        where: () => Promise.reject(new Error('db failed')),
      }),
    } as never);
    const registry = new NodeRegistryService(db as never);
    const commandStream = { end: vi.fn(), destroy: vi.fn() };

    await expect(registry.register('node-1', 'nginx', 'worker-1', 'hash-1', commandStream as never)).rejects.toThrow(
      'db failed'
    );

    expect(registry.getNode('node-1')).toBeUndefined();
  });

  it('does not register a node when the registration is superseded during the DB update', async () => {
    const registry = new NodeRegistryService(makeDb() as never);
    const commandStream = { end: vi.fn(), destroy: vi.fn() };
    let current = true;

    await expect(
      registry.register('node-1', 'nginx', 'worker-1', 'hash-1', commandStream as never, {
        isCurrentRegistration: () => {
          const result = current;
          current = false;
          return result;
        },
      })
    ).rejects.toThrow('Registration superseded');

    expect(registry.getNode('node-1')).toBeUndefined();
  });
});
