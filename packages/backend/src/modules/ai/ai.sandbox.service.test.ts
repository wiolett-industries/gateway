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
});
