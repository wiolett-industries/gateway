import { describe, expect, it, vi } from 'vitest';
import { AISandboxJobsService } from './ai.sandbox-jobs.service.js';

describe('AISandboxJobsService.listActiveWithEffectiveScopes', () => {
  it('includes user-specific additional scopes when revalidating active jobs', async () => {
    const rows = [
      {
        job: { id: 'job-1' },
        user: {
          id: 'user-1',
          groupId: 'group-1',
          additionalScopes: ['ai:sandbox:tier:high'],
          isBlocked: false,
        },
      },
    ];
    const where = vi.fn().mockResolvedValue(rows);
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ innerJoin }));
    const service = new AISandboxJobsService({
      query: {
        permissionGroups: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: 'group-1', parentId: null, name: 'sandbox-users', scopes: ['ai:sandbox:use'] }]),
        },
      },
      select: vi.fn(() => ({ from })),
    } as never);

    await expect(service.listActiveWithEffectiveScopes()).resolves.toEqual([
      {
        job: { id: 'job-1' },
        userId: 'user-1',
        currentScopes: ['ai:sandbox:tier:high', 'ai:sandbox:use'],
      },
    ]);
  });
});
