import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { nodes } from '@/db/schema/index.js';
import { AppError } from '@/middleware/error-handler.js';

type LockableNodeType = 'nginx' | 'docker';

export const NODE_SERVICE_CREATION_LOCKED_CODE = 'NODE_SERVICE_CREATION_LOCKED';
export const NODE_SERVICE_CREATION_LOCKED_MESSAGE = 'Node is locked for new service creation';

export async function assertNodeAllowsServiceCreation(
  db: DrizzleClient,
  nodeId: string,
  expectedType: LockableNodeType
) {
  const [node] = await db
    .select({
      id: nodes.id,
      type: nodes.type,
      serviceCreationLocked: nodes.serviceCreationLocked,
    })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .limit(1);

  if (!node) throw new AppError(404, 'NOT_FOUND', 'Node not found');
  if (node.type !== expectedType) {
    throw new AppError(
      400,
      expectedType === 'nginx' ? 'NOT_NGINX' : 'NOT_DOCKER',
      expectedType === 'nginx' ? 'Node is not an nginx node' : 'Node is not a Docker node'
    );
  }
  if (node.serviceCreationLocked) {
    throw new AppError(409, NODE_SERVICE_CREATION_LOCKED_CODE, NODE_SERVICE_CREATION_LOCKED_MESSAGE);
  }

  return node;
}
