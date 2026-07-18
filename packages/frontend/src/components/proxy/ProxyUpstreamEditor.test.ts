import { describe, expect, it } from "vitest";
import type { DockerContainer } from "@/types";
import {
  DEFAULT_PROXY_UPSTREAM,
  isProxyUpstreamValid,
  proxyUpstreamForDockerTarget,
  proxyUpstreamRequest,
} from "./ProxyUpstreamEditor";

function container(overrides: Partial<DockerContainer> = {}): DockerContainer {
  return {
    id: "container-1",
    name: "api",
    image: "nginx:alpine",
    state: "running",
    status: "Up",
    created: 1,
    nodeId: "node-1",
    ports: [{ privatePort: 80, publicPort: 18080, type: "tcp", ip: "0.0.0.0" }],
    ...overrides,
  };
}

describe("proxy Docker upstream selection", () => {
  it("automatically selects a single published TCP mapping", () => {
    const selected = proxyUpstreamForDockerTarget(DEFAULT_PROXY_UPSTREAM, container());

    expect(selected).toMatchObject({
      kind: "docker_container",
      dockerNodeId: "node-1",
      containerName: "api",
      containerPort: 80,
      hostPort: 18080,
    });
    expect(isProxyUpstreamValid(selected)).toBe(true);
    expect(proxyUpstreamRequest(selected)).toMatchObject({
      upstreamKind: "docker_container",
      dockerNodeId: "node-1",
      dockerContainerName: "api",
      dockerContainerPort: 80,
      dockerHostPort: 18080,
      dockerProtocol: "tcp",
    });
  });

  it("requires an explicit choice when multiple mappings exist", () => {
    const selected = proxyUpstreamForDockerTarget(
      DEFAULT_PROXY_UPSTREAM,
      container({
        ports: [
          { privatePort: 80, publicPort: 18080, type: "tcp" },
          { privatePort: 443, publicPort: 18443, type: "tcp" },
        ],
      })
    );

    expect(selected.containerPort).toBeNull();
    expect(selected.hostPort).toBeNull();
    expect(isProxyUpstreamValid(selected)).toBe(false);
  });

  it("does not offer a mapping published only on loopback", () => {
    const selected = proxyUpstreamForDockerTarget(
      DEFAULT_PROXY_UPSTREAM,
      container({
        ports: [{ privatePort: 80, publicPort: 18080, type: "tcp", ip: "127.0.0.1" }],
      })
    );

    expect(selected.containerPort).toBeNull();
    expect(selected.hostPort).toBeNull();
    expect(isProxyUpstreamValid(selected)).toBe(false);
  });

  it("stores a deployment reference instead of a slot container", () => {
    const selected = proxyUpstreamForDockerTarget(
      DEFAULT_PROXY_UPSTREAM,
      container({ kind: "deployment", id: "deployment-1", deploymentId: "deployment-1" })
    );

    expect(selected).toMatchObject({
      kind: "docker_deployment",
      deploymentId: "deployment-1",
      dockerNodeId: null,
      containerName: null,
    });
  });
});
