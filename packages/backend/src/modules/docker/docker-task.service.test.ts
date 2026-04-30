import { describe, expect, it, vi } from 'vitest';
import { DockerTaskService } from './docker-task.service.js';

describe('DockerTaskService', () => {
  it('marks stale active tasks as failed and emits updates', async () => {
    const staleTask = {
      id: 'task-1',
      nodeId: '11111111-1111-4111-8111-111111111111',
      status: 'failed',
      progress: null,
      error: 'Timed out after backend restart or lost task watcher',
    };
    const returning = vi.fn().mockResolvedValue([staleTask]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const publish = vi.fn();
    const service = new DockerTaskService({ update } as never);
    service.setEventBus({ publish } as never);

    await expect(service.markStaleActiveTasksFailed(new Date('2026-04-30T12:00:00Z'))).resolves.toBe(1);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: 'Timed out after backend restart or lost task watcher',
      })
    );
    expect(publish).toHaveBeenCalledWith(
      'docker.task.changed',
      expect.objectContaining({
        taskId: staleTask.id,
        nodeId: staleTask.nodeId,
        status: 'failed',
        error: staleTask.error,
      })
    );
  });
});
