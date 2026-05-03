import { beforeEach, describe, expect, it } from "vitest";
import { useDockerStore } from "./docker";

function dockerNode(id: string) {
  return {
    id,
    type: "docker" as const,
    hostname: id,
    displayName: null,
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
});
