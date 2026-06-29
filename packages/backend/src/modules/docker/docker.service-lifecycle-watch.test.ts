import { describe, expect, it, vi } from 'vitest';
import { DockerManagementService } from './docker.service.js';

function createService(dispatch: { sendDockerContainerCommand: ReturnType<typeof vi.fn> }) {
  return new DockerManagementService(
    {} as never,
    { log: vi.fn().mockResolvedValue(undefined) } as never,
    dispatch as never,
    { getNode: vi.fn() } as never
  );
}

describe('DockerManagementService lifecycle watcher', () => {
  it('marks a transition task as succeeded when the container reaches the expected state', async () => {
    vi.useFakeTimers();

    try {
      const dispatch = {
        sendDockerContainerCommand: vi.fn().mockResolvedValue({
          success: true,
          detail: JSON.stringify({ State: { Status: 'running' } }),
        }),
      };
      const service = createService(dispatch);
      const update = vi.fn().mockResolvedValue(undefined);
      const publish = vi.fn();
      service.setTaskService({ update } as never);
      service.setEventBus({ publish } as never);

      (
        service as unknown as {
          watchTransition: (
            nodeId: string,
            containerId: string,
            name: string,
            taskId: string | undefined,
            expectedState: string,
            progress: string,
            completedAction: 'started',
            timeoutMs?: number
          ) => void;
        }
      ).watchTransition('node-1', 'container-1', 'api', 'task-1', 'running', 'Container started', 'started', 60000);

      await vi.advanceTimersByTimeAsync(2000);

      expect(update).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'succeeded',
          progress: 'Container started',
        })
      );
      expect(publish).toHaveBeenCalledWith(
        'docker.container.changed',
        expect.objectContaining({
          nodeId: 'node-1',
          name: 'api',
          id: 'container-1',
          action: 'started',
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
