import { describe, expect, it, vi } from 'vitest';
import { statusPageServices } from '@/db/schema/index.js';
import { StatusIncidentEvaluatorService } from './status-incident-evaluator.service.js';

function createDb(services: any[]) {
  const updates: any[] = [];
  return {
    updates,
    query: {
      statusPageServices: {
        findMany: vi.fn().mockResolvedValue(services),
      },
    },
    update: (table: unknown) => ({
      set: (data: unknown) => ({
        where: vi.fn().mockImplementation(async () => {
          expect(table).toBe(statusPageServices);
          updates.push(data);
        }),
      }),
    }),
  };
}

describe('StatusIncidentEvaluatorService', () => {
  it('creates an automatic incident after the unhealthy threshold', async () => {
    const service = {
      id: 'service-1',
      enabled: true,
      sortOrder: 0,
      publicName: 'Website',
      createThresholdSeconds: 60,
      resolveThresholdSeconds: 60,
      unhealthySince: new Date('2026-04-01T00:00:00.000Z'),
      healthySince: null,
    };
    const db = createDb([service]);
    const statusPageService = {
      resolveSources: vi.fn().mockResolvedValue(new Map([['service-1', { status: 'outage' }]])),
      createAutomaticIncident: vi.fn().mockResolvedValue(undefined),
      autoResolveIncident: vi.fn().mockResolvedValue(undefined),
    };

    await new StatusIncidentEvaluatorService(db as any, statusPageService as any).run(
      new Date('2026-04-01T00:01:01.000Z')
    );

    expect(statusPageService.createAutomaticIncident).toHaveBeenCalledWith(service, 'outage');
    expect(statusPageService.autoResolveIncident).not.toHaveBeenCalled();
  });

  it('auto-resolves only after the healthy threshold', async () => {
    const service = {
      id: 'service-1',
      enabled: true,
      sortOrder: 0,
      publicName: 'Website',
      createThresholdSeconds: 60,
      resolveThresholdSeconds: 30,
      unhealthySince: null,
      healthySince: new Date('2026-04-01T00:00:00.000Z'),
    };
    const db = createDb([service]);
    const statusPageService = {
      resolveSources: vi.fn().mockResolvedValue(new Map([['service-1', { status: 'operational' }]])),
      createAutomaticIncident: vi.fn().mockResolvedValue(undefined),
      autoResolveIncident: vi.fn().mockResolvedValue(undefined),
    };

    await new StatusIncidentEvaluatorService(db as any, statusPageService as any).run(
      new Date('2026-04-01T00:00:31.000Z')
    );

    expect(statusPageService.autoResolveIncident).toHaveBeenCalledWith('service-1');
    expect(statusPageService.createAutomaticIncident).not.toHaveBeenCalled();
  });
});
