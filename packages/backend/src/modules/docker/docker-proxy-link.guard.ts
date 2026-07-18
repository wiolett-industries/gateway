import { and, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { proxyHosts } from '@/db/schema/index.js';
import { AppError } from '@/middleware/error-handler.js';

async function findLinkedProxyHost(
  db: DrizzleClient,
  where: ReturnType<typeof and>
): Promise<{ id: string; domainNames: string[] } | undefined> {
  const [host] = await db
    .select({ id: proxyHosts.id, domainNames: proxyHosts.domainNames })
    .from(proxyHosts)
    .where(where)
    .limit(1);
  return host && Array.isArray(host.domainNames) ? host : undefined;
}

function inUseError(host: { id: string; domainNames: string[] }) {
  const label = host.domainNames[0] ?? host.id;
  return new AppError(
    409,
    'PROXY_UPSTREAM_IN_USE',
    `Resource is used by proxy host "${label}". Change or delete the proxy host first.`
  );
}

export async function assertContainerNotUsedByProxy(db: DrizzleClient, nodeId: string, containerName: string) {
  const host = await findLinkedProxyHost(
    db,
    and(
      eq(proxyHosts.upstreamKind, 'docker_container'),
      eq(proxyHosts.dockerNodeId, nodeId),
      eq(proxyHosts.dockerContainerName, containerName)
    )
  );
  if (host) throw inUseError(host);
}

export async function assertDeploymentNotUsedByProxy(db: DrizzleClient, deploymentId: string) {
  const host = await findLinkedProxyHost(
    db,
    and(eq(proxyHosts.upstreamKind, 'docker_deployment'), eq(proxyHosts.dockerDeploymentId, deploymentId))
  );
  if (host) throw inUseError(host);
}
