import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBusService } from '@/services/event-bus.service.js';
import { DockerSnapshotReconciler } from './docker-snapshot-reconciler.service.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createReconciler(dispatchOverrides: Record<string, unknown> = {}) {
  const snapshots = {
    markListRefreshing: vi.fn().mockResolvedValue(undefined),
    replaceList: vi.fn().mockResolvedValue(undefined),
    markListError: vi.fn().mockResolvedValue(undefined),
    replaceDetail: vi.fn().mockResolvedValue(undefined),
    markDetailError: vi.fn().mockResolvedValue(undefined),
    getList: vi.fn().mockResolvedValue({ data: [] }),
    getDetail: vi.fn().mockResolvedValue(null),
    getDetails: vi.fn().mockResolvedValue({}),
    purgeNode: vi.fn().mockResolvedValue(undefined),
    publishNodeAvailability: vi.fn().mockResolvedValue(undefined),
  };
  const ok = { success: true, detail: '[]' };
  const dispatch = {
    sendDockerContainerCommand: vi.fn().mockResolvedValue(ok),
    sendDockerImageCommand: vi.fn().mockResolvedValue(ok),
    sendDockerVolumeCommand: vi.fn().mockResolvedValue(ok),
    sendDockerNetworkCommand: vi.fn().mockResolvedValue(ok),
    ...dispatchOverrides,
  };
  const registry = {
    getNodesByType: vi.fn().mockReturnValue([]),
    getNode: vi.fn((nodeId: string) => ({ nodeId, type: 'docker' })),
  };
  const eventBus = new EventBusService();
  const reconciler = new DockerSnapshotReconciler(snapshots as never, dispatch as never, registry as never, eventBus);
  return { reconciler, snapshots, dispatch, registry, eventBus };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DockerSnapshotReconciler', () => {
  it('coalesces an in-flight duplicate into exactly one follow-up refresh', async () => {
    const first = deferred<{ success: boolean; detail: string }>();
    const send = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ success: true, detail: '[]' });
    const { reconciler } = createReconciler({ sendDockerContainerCommand: send });

    reconciler.enqueue({ nodeId: 'node-1', kind: 'containers' });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    reconciler.enqueue({ nodeId: 'node-1', kind: 'containers' });
    reconciler.enqueue({ nodeId: 'node-1', kind: 'containers' });
    first.resolve({ success: true, detail: '[]' });

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, 'node-1', 'list', {}, 10_000);
  });

  it('does not let a hung node block another node refresh', async () => {
    const hung = deferred<{ success: boolean; detail: string }>();
    const send = vi.fn((nodeId: string) =>
      nodeId === 'node-1' ? hung.promise : Promise.resolve({ success: true, detail: '[]' })
    );
    const { reconciler, snapshots } = createReconciler({ sendDockerContainerCommand: send });

    reconciler.enqueue({ nodeId: 'node-1', kind: 'containers' });
    reconciler.enqueue({ nodeId: 'node-2', kind: 'containers' });

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(snapshots.replaceList).toHaveBeenCalledWith('node-2', 'containers', []));
    expect(snapshots.replaceList).not.toHaveBeenCalledWith('node-1', 'containers', []);
    hung.resolve({ success: true, detail: '[]' });
  });

  it('serializes different refresh kinds for the same node', async () => {
    const first = deferred<{ success: boolean; detail: string }>();
    const containerSend = vi.fn(() => first.promise);
    const imageSend = vi.fn().mockResolvedValue({ success: true, detail: '[]' });
    const { reconciler } = createReconciler({
      sendDockerContainerCommand: containerSend,
      sendDockerImageCommand: imageSend,
    });

    reconciler.enqueue({ nodeId: 'node-1', kind: 'containers' });
    reconciler.enqueue({ nodeId: 'node-1', kind: 'images' });
    await vi.waitFor(() => expect(containerSend).toHaveBeenCalledTimes(1));
    expect(imageSend).not.toHaveBeenCalled();
    first.resolve({ success: true, detail: '[]' });
    await vi.waitFor(() => expect(imageSend).toHaveBeenCalledTimes(1));
  });

  it('turns a write event into targeted list/detail refreshes without purging old data', async () => {
    const { reconciler, dispatch, snapshots, eventBus } = createReconciler();
    reconciler.start();

    eventBus.publish('docker.container.changed', {
      nodeId: 'node-1',
      id: 'container-1',
      name: 'web',
      action: 'updated',
    });

    await vi.waitFor(() =>
      expect(dispatch.sendDockerContainerCommand).toHaveBeenCalledWith('node-1', 'list', {}, 10_000)
    );
    await vi.waitFor(() =>
      expect(dispatch.sendDockerContainerCommand).toHaveBeenCalledWith(
        'node-1',
        'inspect',
        { containerId: 'web' },
        10_000
      )
    );
    expect(snapshots.purgeNode).not.toHaveBeenCalled();
    reconciler.stop();
  });

  it('purges on explicit deletion and refreshes all inventory kinds on reconnect', async () => {
    const { reconciler, dispatch, snapshots, eventBus } = createReconciler();
    reconciler.start();
    eventBus.publish('node.changed', { id: 'node-1', action: 'deleted' });
    await vi.waitFor(() => expect(snapshots.purgeNode).toHaveBeenCalledWith('node-1'));

    eventBus.publish('node.changed', { id: 'node-1', action: 'updated', status: 'online' });
    await vi.waitFor(() => expect(dispatch.sendDockerContainerCommand).toHaveBeenCalled());
    await vi.waitFor(() => expect(dispatch.sendDockerImageCommand).toHaveBeenCalled());
    await vi.waitFor(() => expect(dispatch.sendDockerVolumeCommand).toHaveBeenCalled());
    await vi.waitFor(() => expect(dispatch.sendDockerNetworkCommand).toHaveBeenCalled());
    reconciler.stop();
  });

  it('announces snapshot availability changes when a node disconnects', async () => {
    const { reconciler, snapshots, eventBus } = createReconciler();
    reconciler.start();

    eventBus.publish('node.changed', { id: 'node-1', action: 'updated', status: 'offline' });

    await vi.waitFor(() => expect(snapshots.publishNodeAvailability).toHaveBeenCalledWith('node-1'));
    reconciler.stop();
  });

  it('automatically retries a failed job after 10 seconds without accumulating duplicates', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({ success: true, detail: '[]' });
    const { reconciler } = createReconciler({ sendDockerContainerCommand: send });

    reconciler.enqueue({ nodeId: 'node-1', kind: 'containers' });
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    reconciler.enqueue({ nodeId: 'node-1', kind: 'containers' });
    reconciler.enqueue({ nodeId: 'node-1', kind: 'containers' });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
