import { deriveAllowedResourceIdsByScope, scopeMatches } from "@/lib/scope-utils";
import { api } from "@/services/api";
import type { Node } from "@/types";
import { isNodeIncompatible } from "@/types";

export const DOCKER_VIEW_NODE_SCOPES = [
  "docker:containers:view",
  "docker:images:view",
  "docker:volumes:view",
  "docker:networks:view",
] as const;

export type DockerViewNodeScope = (typeof DOCKER_VIEW_NODE_SCOPES)[number];

export function buildScopedDockerNodes(
  scopes: readonly string[],
  scopeBases: readonly DockerViewNodeScope[]
): Node[] {
  const allowedIds = deriveAllowedResourceIdsByScope(scopes);
  const nodeIds = new Set<string>();
  for (const scopeBase of scopeBases) {
    for (const nodeId of allowedIds[scopeBase] ?? []) nodeIds.add(nodeId);
  }

  return [...nodeIds].sort().map((nodeId) => ({
    id: nodeId,
    type: "docker",
    hostname: nodeId,
    displayName: null,
    status: "online",
    serviceCreationLocked: false,
    daemonVersion: null,
    osInfo: null,
    configVersionHash: null,
    capabilities: {},
    lastSeenAt: null,
    metadata: { scopedOnly: true },
    isConnected: true,
    createdAt: "",
    updatedAt: "",
  }));
}

function hasBroadDockerNodeAccess(
  scopes: readonly string[],
  scopeBases: readonly DockerViewNodeScope[]
) {
  return scopeBases.some((scopeBase) => scopeMatches(scopes, scopeBase));
}

export async function loadVisibleDockerNodes(
  scopes: readonly string[],
  scopeBases: readonly DockerViewNodeScope[],
  canListNodes: boolean
): Promise<Node[]> {
  const scopedNodes = buildScopedDockerNodes(scopes, scopeBases);
  const shouldListNodes = canListNodes || hasBroadDockerNodeAccess(scopes, scopeBases);
  if (!shouldListNodes) return scopedNodes;

  try {
    const response = await api.listNodes({ type: "docker", limit: 100 });
    const listedNodes = response.data.filter(
      (node) => node.status === "online" && node.isConnected && !isNodeIncompatible(node)
    );
    const listedIds = new Set(listedNodes.map((node) => node.id));
    return [...listedNodes, ...scopedNodes.filter((node) => !listedIds.has(node.id))];
  } catch (error) {
    if (scopedNodes.length > 0) return scopedNodes;
    throw error;
  }
}
