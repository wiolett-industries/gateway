import { describe, expect, it } from 'vitest';
import { diffDockerContainerStateReports } from './control.js';

describe('diffDockerContainerStateReports', () => {
  it('does not emit an exited change for an old ID when the same container name was recreated', () => {
    const changes = diffDockerContainerStateReports(
      [{ containerId: 'old-id', name: 'web', state: 'running' }],
      [{ containerId: 'new-id', name: 'web', state: 'running' }]
    );

    expect(changes).toEqual([{ containerId: 'new-id', name: 'web', state: 'running' }]);
  });

  it('emits an exited change when a container disappears without a same-name replacement', () => {
    const changes = diffDockerContainerStateReports([{ containerId: 'old-id', name: 'worker', state: 'running' }], []);

    expect(changes).toEqual([{ containerId: 'old-id', name: 'worker', state: 'exited' }]);
  });

  it('emits a change when the same container ID changes state', () => {
    const changes = diffDockerContainerStateReports(
      [{ containerId: 'same-id', name: 'api', state: 'running' }],
      [{ containerId: 'same-id', name: 'api', state: 'exited' }]
    );

    expect(changes).toEqual([{ containerId: 'same-id', name: 'api', state: 'exited' }]);
  });
});
