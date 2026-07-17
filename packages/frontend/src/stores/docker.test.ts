import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { useDockerStore } from "./docker";

function dockerNode(id: string) {
  return {
    id,
    slug: id,
    type: "docker" as const,
    hostname: id,
    displayName: null,
    appearanceColor: null,
    status: "online" as const,
    serviceCreationLocked: false,
    daemonVersion: null,
    osInfo: null,
    configVersionHash: null,
    capabilities: {},
    lastSeenAt: null,
    metadata: {},
    isConnected: true,
    createdAt: "",
    updatedAt: "",
  };
}

describe("docker store", () => {
  beforeEach(() => {
    useDockerStore.setState({
      selectedNodeId: null,
      dockerNodes: [],
      dockerNodesLoaded: false,
    });
  });

  it("clears a selected Docker node when the visible node list no longer contains it", () => {
    useDockerStore.getState().setDockerNodes([dockerNode("node-a"), dockerNode("node-b")]);
    useDockerStore.getState().setSelectedNode("node-a");

    useDockerStore.getState().setDockerNodes([dockerNode("node-b")]);

    expect(useDockerStore.getState().selectedNodeId).toBeNull();
  });

  it("updates cached node-tagged Docker rows when node appearance changes", () => {
    useDockerStore.setState({
      dockerNodes: [dockerNode("node-a")],
      containers: [
        { id: "container-a", name: "app", image: "busybox", state: "running", _nodeId: "node-a" },
      ] as never,
      containersByScope: {
        node_a: [
          {
            id: "container-a",
            name: "app",
            image: "busybox",
            state: "running",
            _nodeId: "node-a",
          },
        ] as never,
      },
    });

    useDockerStore.getState().syncNodeAppearance({
      id: "node-a",
      slug: "node-a-renamed",
      hostname: "node-a",
      displayName: "Blue Node",
      appearanceColor: "blue",
    });

    expect(useDockerStore.getState().dockerNodes[0]).toMatchObject({
      slug: "node-a-renamed",
      displayName: "Blue Node",
      appearanceColor: "blue",
    });
    expect(useDockerStore.getState().containers[0]).toMatchObject({
      _nodeSlug: "node-a-renamed",
      _nodeName: "Blue Node",
      _nodeColor: "blue",
    });
    expect(useDockerStore.getState().containersByScope.node_a?.[0]).toMatchObject({
      _nodeSlug: "node-a-renamed",
      _nodeName: "Blue Node",
      _nodeColor: "blue",
    });

    useDockerStore.getState().syncNodeAppearance({ id: "node-a", slug: "node-a-final" });

    expect(useDockerStore.getState().containers[0]).toMatchObject({
      _nodeSlug: "node-a-final",
      _nodeName: "Blue Node",
      _nodeColor: "blue",
    });
  });

  it("uses one aggregate snapshot request and preserves unavailable rows", async () => {
    const snapshotRequest = vi.spyOn(api, "listDockerContainerSnapshots").mockResolvedValue([
      {
        id: "container-a",
        name: "app",
        image: "busybox",
        state: "running",
        status: "Up",
        created: 0,
        ports: [],
        nodeId: "offline-node",
        _nodeId: "offline-node",
        availability: "unavailable",
      },
    ]);
    const perNodeRequest = vi.spyOn(api, "listDockerContainers");

    await useDockerStore.getState().fetchContainers();

    expect(snapshotRequest).toHaveBeenCalledTimes(1);
    expect(snapshotRequest).toHaveBeenCalledWith({ nodeId: undefined, search: "" });
    expect(perNodeRequest).not.toHaveBeenCalled();
    expect(useDockerStore.getState().containers).toMatchObject([
      { id: "container-a", availability: "unavailable" },
    ]);
  });

  it("sends refresh hints without a follow-up list request", async () => {
    const hint = vi.spyOn(api, "refreshDockerSnapshots").mockResolvedValue();
    const list = vi.spyOn(api, "listDockerVolumeSnapshots");

    await useDockerStore.getState().requestSnapshotRefresh("volumes", "node-a");

    expect(hint).toHaveBeenCalledWith({ resource: "volumes", nodeId: "node-a" });
    expect(list).not.toHaveBeenCalled();
  });
});
