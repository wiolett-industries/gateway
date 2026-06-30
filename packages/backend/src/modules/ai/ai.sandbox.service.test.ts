import { describe, expect, it, vi } from 'vitest';
import { AISandboxService } from './ai.sandbox.service.js';

describe('AISandboxService', () => {
  it('kills and expires active jobs whose TTL has passed during reconciliation', async () => {
    const expiredJob = {
      id: 'job-1',
      containerId: 'container-1',
      expiresAt: new Date(Date.now() - 1_000),
      requiredScopes: [],
    };
    const jobs = {
      listActiveWithEffectiveScopes: vi.fn().mockResolvedValue([
        {
          job: expiredJob,
          userId: 'user-1',
          currentScopes: [],
        },
      ]),
      markFinished: vi.fn().mockResolvedValue({}),
    };
    const runner = {
      killProcess: vi.fn().mockResolvedValue({ processId: 'container-1', killed: true }),
    };
    const service = new AISandboxService(jobs as never, runner as never, {} as never);

    await expect(service.reconcileActiveJobs()).resolves.toEqual({ checked: 1, expired: 1, revoked: 0 });
    expect(runner.killProcess).toHaveBeenCalledWith({ processId: 'container-1' });
    expect(jobs.markFinished).toHaveBeenCalledWith('job-1', 'expired');
  });

  it('marks run_process jobs exited when their container finishes before TTL', async () => {
    const user = { id: 'user-1', scopes: ['ai:sandbox:use'] };
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const jobs = {
      create: vi.fn().mockResolvedValue({ id: 'job-1' }),
      markRunning: vi.fn().mockResolvedValue({}),
      markFinished: vi.fn().mockResolvedValue({}),
      markFinishedIfActive: vi.fn().mockResolvedValue({ id: 'job-1', status: 'exited' }),
    };
    const runner = {
      runProcess: vi.fn().mockResolvedValue({
        processId: 'container-1',
        containerId: 'container-1',
        expiresAt,
      }),
      waitProcess: vi.fn().mockResolvedValue({ processId: 'container-1', exitCode: 2, outputBytes: 56 }),
    };
    const service = new AISandboxService(jobs as never, runner as never, {} as never);

    await expect(
      service.runProcess(user as never, {
        command: ['sh', '-lc', 'exit 2'],
        conversationId: 'conversation-1',
      })
    ).resolves.toMatchObject({
      jobId: 'job-1',
      processId: 'container-1',
      containerId: 'container-1',
    });

    expect(jobs.markRunning).toHaveBeenCalledWith('job-1', 'container-1');
    expect(runner.waitProcess).toHaveBeenCalledWith({ processId: 'container-1', timeoutMs: expect.any(Number) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(jobs.markFinishedIfActive).toHaveBeenCalledWith('job-1', 'exited', {
      exitCode: 2,
      outputBytes: 56,
    });
  });
});
