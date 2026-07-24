import { describe, expect, it, vi } from 'vitest';
import { migrationSourceMayNeedRestore, restoreMigrationSource } from './docker-migration-source-restore.js';

function createDispatch() {
  const dispatch = {
    containerAction: vi.fn().mockResolvedValue({}),
    deploymentAction: vi.fn().mockResolvedValue({}),
  };
  return dispatch;
}

describe('DockerMigrationExecutor source restoration', () => {
  it('restores every deployment container restart policy before starting the source deployment', async () => {
    const dispatch = createDispatch();
    const row = {
      resourceType: 'deployment',
      sourceNodeId: 'source-node',
      sourceState: 'ready',
      deploymentId: 'deployment-id',
    } as never;
    const plan = {
      deployment: {
        routerName: 'router',
        slots: { blue: 'blue', green: 'green' },
        deployment: { id: 'deployment-id' },
      },
      deploymentManifests: {
        router: { hostConfig: { RestartPolicy: { Name: 'always' } } },
        blue: { hostConfig: { RestartPolicy: { Name: 'unless-stopped' } } },
        green: { hostConfig: { RestartPolicy: { Name: 'on-failure' } } },
      },
    };

    await restoreMigrationSource(dispatch as never, row, plan);

    expect(dispatch.containerAction.mock.calls).toEqual([
      ['source-node', 'live_update', 'router', { configJson: JSON.stringify({ restartPolicy: 'always' }) }],
      ['source-node', 'live_update', 'blue', { configJson: JSON.stringify({ restartPolicy: 'unless-stopped' }) }],
      ['source-node', 'live_update', 'green', { configJson: JSON.stringify({ restartPolicy: 'on-failure' }) }],
    ]);
    expect(dispatch.deploymentAction).toHaveBeenCalledWith('source-node', 'start', 'deployment-id', {
      configJson: JSON.stringify({ deployment: { id: 'deployment-id' }, force: true }),
      force: true,
    });
  });

  it('does not start a deployment when any restart policy cannot be restored', async () => {
    const dispatch = createDispatch();
    dispatch.containerAction.mockRejectedValueOnce(new Error('policy update failed'));
    const row = {
      resourceType: 'deployment',
      sourceNodeId: 'source-node',
      sourceState: 'ready',
      deploymentId: 'deployment-id',
    } as never;
    const plan = {
      deployment: {
        routerName: 'router',
        slots: { blue: 'blue' },
        deployment: { id: 'deployment-id' },
      },
      deploymentManifests: {
        router: { hostConfig: { RestartPolicy: { Name: 'always' } } },
        blue: { hostConfig: { RestartPolicy: { Name: 'unless-stopped' } } },
      },
    };

    await expect(restoreMigrationSource(dispatch as never, row, plan)).rejects.toThrow(
      'Source deployment restoration was incomplete'
    );
    expect(dispatch.containerAction).toHaveBeenCalledTimes(2);
    expect(dispatch.deploymentAction).not.toHaveBeenCalled();
  });

  it('does not restore a source that has not reached the stopping phase', () => {
    expect(migrationSourceMayNeedRestore({ phase: 'locking' } as never)).toBe(false);
    expect(migrationSourceMayNeedRestore({ phase: 'maintenance' } as never)).toBe(false);
    expect(migrationSourceMayNeedRestore({ phase: 'stopping_source' } as never)).toBe(true);
    expect(migrationSourceMayNeedRestore({ phase: 'verifying_target' } as never)).toBe(true);
  });
});
