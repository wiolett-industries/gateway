import { describe, expect, it } from "vitest";
import { buildScopedDockerNodes } from "./docker-node-access";

describe("docker node access helpers", () => {
  it("derives Docker node placeholders from resource-scoped Docker view grants", () => {
    const nodes = buildScopedDockerNodes(
      [
        "docker:containers:view:node-1",
        "docker:images:view:node-2",
        "docker:volumes:view:node-3",
        "docker:containers:view:node-1",
      ],
      ["docker:containers:view", "docker:images:view", "docker:volumes:view"]
    );

    expect(nodes.map((node) => node.id)).toEqual(["node-1", "node-2", "node-3"]);
    expect(nodes[0]).toMatchObject({
      type: "docker",
      status: "online",
      isConnected: true,
      metadata: { scopedOnly: true },
    });
  });

  it("keeps scoped Docker placeholders that are not returned by node listing", async () => {
    const { loadVisibleDockerNodes } = await import("./docker-node-access");
    const { api } = await import("@/services/api");
    const originalListNodes = api.listNodes;
    api.listNodes = async () =>
      ({
        data: [
          {
            id: "node-a",
            type: "docker",
            hostname: "node-a",
            displayName: "Node A",
            status: "online",
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
          },
        ],
      }) as never;

    try {
      const nodes = await loadVisibleDockerNodes(
        ["nodes:details:node-a", "docker:containers:view:node-b"],
        ["docker:containers:view"],
        true
      );

      expect(nodes.map((node) => node.id)).toEqual(["node-a", "node-b"]);
    } finally {
      api.listNodes = originalListNodes;
    }
  });

  it("loads node list for broad Docker view grants even without node details", async () => {
    const { loadVisibleDockerNodes } = await import("./docker-node-access");
    const { api } = await import("@/services/api");
    const originalListNodes = api.listNodes;
    api.listNodes = async () =>
      ({
        data: [
          {
            id: "node-a",
            type: "docker",
            hostname: "node-a",
            displayName: "Node A",
            status: "online",
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
          },
        ],
      }) as never;

    try {
      const nodes = await loadVisibleDockerNodes(
        ["docker:containers:view"],
        ["docker:containers:view"],
        false
      );

      expect(nodes.map((node) => node.id)).toEqual(["node-a"]);
    } finally {
      api.listNodes = originalListNodes;
    }
  });

  it("loads node list for broad Docker scopes that imply view", async () => {
    const { loadVisibleDockerNodes } = await import("./docker-node-access");
    const { api } = await import("@/services/api");
    const originalListNodes = api.listNodes;
    api.listNodes = async () =>
      ({
        data: [
          {
            id: "node-a",
            type: "docker",
            hostname: "node-a",
            displayName: "Node A",
            status: "online",
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
          },
        ],
      }) as never;

    try {
      const nodes = await loadVisibleDockerNodes(
        ["docker:containers:manage"],
        ["docker:containers:view"],
        false
      );

      expect(nodes.map((node) => node.id)).toEqual(["node-a"]);
    } finally {
      api.listNodes = originalListNodes;
    }
  });
});
