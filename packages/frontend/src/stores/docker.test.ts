import { beforeEach, describe, expect, it } from "vitest";
import { useDockerStore } from "./docker";

function dockerNode(id: string) {
  return {
    id,
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
      hostname: "node-a",
      displayName: "Blue Node",
      appearanceColor: "blue",
    });

    expect(useDockerStore.getState().dockerNodes[0]).toMatchObject({
      displayName: "Blue Node",
      appearanceColor: "blue",
    });
    expect(useDockerStore.getState().containers[0]).toMatchObject({
      _nodeName: "Blue Node",
      _nodeColor: "blue",
    });
    expect(useDockerStore.getState().containersByScope.node_a?.[0]).toMatchObject({
      _nodeName: "Blue Node",
      _nodeColor: "blue",
    });
  });
});
