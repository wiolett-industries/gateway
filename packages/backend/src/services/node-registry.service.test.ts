import { describe, expect, it, vi } from 'vitest';
import { NodeRegistryService } from './node-registry.service.js';

describe('NodeRegistryService', () => {
  it('observes ongoing disconnected offline nodes for stateful notification windows', async () => {
    const db = {
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
});
