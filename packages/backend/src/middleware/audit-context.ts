import type { MiddlewareHandler } from 'hono';
import { container } from '@/container.js';
import { getClientIpForContext } from '@/lib/request-ip.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import { getAuditRequestContext, runWithAuditRequestContext } from '@/modules/audit/audit-request-context.js';
import type { AppEnv } from '@/types.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_SEGMENT = /^[0-9a-f]{16,}$/i;
const TOKENISH_SEGMENT = /^[A-Za-z0-9_-]{16,}$/;

interface FallbackAuditTarget {
  action: string;
  resourceType: string;
  resourceId?: string;
}

const DOCKER_ROUTE_AUDIT_TARGETS: Array<{
  method: string;
  pattern: RegExp;
  action: string;
  resourceType: string;
  resourceIdGroup?: number;
}> = [
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/containers$/,
    action: 'docker.container.create',
    resourceType: 'docker-container',
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/containers\/([^/]+)\/start$/,
    action: 'docker.container.start',
    resourceType: 'docker-container',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/containers\/([^/]+)\/stop$/,
    action: 'docker.container.stop',
    resourceType: 'docker-container',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/containers\/([^/]+)\/restart$/,
    action: 'docker.container.restart',
    resourceType: 'docker-container',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/containers\/([^/]+)\/kill$/,
    action: 'docker.container.kill',
    resourceType: 'docker-container',
    resourceIdGroup: 2,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/containers\/([^/]+)$/,
    action: 'docker.container.remove',
    resourceType: 'docker-container',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/containers\/([^/]+)\/rename$/,
    action: 'docker.container.rename',
    resourceType: 'docker-container',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/containers\/([^/]+)\/duplicate$/,
    action: 'docker.container.duplicate',
    resourceType: 'docker-container',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/containers\/([^/]+)\/update$/,
    action: 'docker.container.update',
    resourceType: 'docker-container',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/containers\/([^/]+)\/live-update$/,
    action: 'docker.container.live_update',
    resourceType: 'docker-container',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/containers\/([^/]+)\/recreate$/,
    action: 'docker.container.recreate',
    resourceType: 'docker-container',
    resourceIdGroup: 2,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/containers\/([^/]+)\/env$/,
    action: 'docker.container.env.update',
    resourceType: 'docker-container',
    resourceIdGroup: 2,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/containers\/([^/]+)\/files\/write$/,
    action: 'docker.file.write',
    resourceType: 'docker-container',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/images\/pull(?:-sync)?$/,
    action: 'docker.image.pull',
    resourceType: 'docker-image',
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/images\/([^/]+)$/,
    action: 'docker.image.remove',
    resourceType: 'docker-image',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/images\/prune$/,
    action: 'docker.image.prune',
    resourceType: 'docker-image',
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/volumes$/,
    action: 'docker.volume.create',
    resourceType: 'docker-volume',
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/volumes\/([^/]+)$/,
    action: 'docker.volume.remove',
    resourceType: 'docker-volume',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/networks$/,
    action: 'docker.network.create',
    resourceType: 'docker-network',
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/networks\/([^/]+)$/,
    action: 'docker.network.remove',
    resourceType: 'docker-network',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/networks\/([^/]+)\/connect$/,
    action: 'docker.network.connect',
    resourceType: 'docker-network',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/networks\/([^/]+)\/disconnect$/,
    action: 'docker.network.disconnect',
    resourceType: 'docker-network',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/deployments$/,
    action: 'docker.deployment.create',
    resourceType: 'docker-deployment',
  },
  {
    method: 'PUT',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/deployments\/([^/]+)$/,
    action: 'docker.deployment.update',
    resourceType: 'docker-deployment',
    resourceIdGroup: 2,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/deployments\/([^/]+)$/,
    action: 'docker.deployment.delete',
    resourceType: 'docker-deployment',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/deployments\/([^/]+)\/start$/,
    action: 'docker.deployment.start',
    resourceType: 'docker-deployment',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/deployments\/([^/]+)\/stop$/,
    action: 'docker.deployment.stop',
    resourceType: 'docker-deployment',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/deployments\/([^/]+)\/restart$/,
    action: 'docker.deployment.restart',
    resourceType: 'docker-deployment',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/deployments\/([^/]+)\/kill$/,
    action: 'docker.deployment.kill',
    resourceType: 'docker-deployment',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/deployments\/([^/]+)\/deploy$/,
    action: 'docker.deployment.deploy',
    resourceType: 'docker-deployment',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/deployments\/([^/]+)\/switch$/,
    action: 'docker.deployment.switch',
    resourceType: 'docker-deployment',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/deployments\/([^/]+)\/rollback$/,
    action: 'docker.deployment.rollback',
    resourceType: 'docker-deployment',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/deployments\/([^/]+)\/slots\/[^/]+\/stop$/,
    action: 'docker.deployment.slot.stop',
    resourceType: 'docker-deployment',
    resourceIdGroup: 2,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/(?:containers|deployments)\/([^/]+)\/health-check$/,
    action: 'docker.health_check.configure',
    resourceType: 'docker-health-check',
    resourceIdGroup: 2,
  },
  {
    method: 'POST',
    pattern: /^\/api\/docker\/nodes\/([^/]+)\/(?:containers|deployments)\/([^/]+)\/health-check\/test$/,
    action: 'docker.health_check.test',
    resourceType: 'docker-health-check',
    resourceIdGroup: 2,
  },
];

function shouldEmitFallbackAudit(c: Parameters<MiddlewareHandler<AppEnv>>[0]): boolean {
  if (!MUTATING_METHODS.has(c.req.method)) {
    return false;
  }

  if (c.res.status < 200 || c.res.status >= 400) {
    return false;
  }

  return !getAuditRequestContext()?.auditEmitted;
}

function resolveFallbackAuditTarget(method: string, path: string): FallbackAuditTarget {
  for (const target of DOCKER_ROUTE_AUDIT_TARGETS) {
    if (target.method !== method) continue;
    const match = target.pattern.exec(path);
    if (!match) continue;
    return {
      action: target.action,
      resourceType: target.resourceType,
      resourceId: target.resourceIdGroup ? decodeURIComponent(match[target.resourceIdGroup] ?? '') : undefined,
    };
  }

  return {
    action: `route.${method.toLowerCase()}`,
    resourceType: 'http-route',
  };
}

function sanitizeAuditPath(path: string): string {
  const segments = path.split('/');
  return segments
    .map((segment) => {
      if (!segment) {
        return segment;
      }
      if (UUID_SEGMENT.test(segment)) {
        return ':id';
      }
      if (HEX_SEGMENT.test(segment) || TOKENISH_SEGMENT.test(segment)) {
        return ':redacted';
      }
      return segment;
    })
    .join('/');
}

export const auditContextMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const context = {
    requestId: c.get('requestId'),
    ipAddress: await getClientIpForContext(c),
    userAgent: c.req.header('user-agent'),
    auditEmitted: false,
  };

  await runWithAuditRequestContext(context, async () => {
    await next();

    if (!shouldEmitFallbackAudit(c)) {
      return;
    }

    const auditService = container.resolve(AuditService);
    const target = resolveFallbackAuditTarget(c.req.method, c.req.path);
    await auditService.log({
      userId: c.get('user')?.id ?? null,
      action: target.action,
      resourceType: target.resourceType,
      resourceId: target.resourceId || undefined,
      details: {
        path: sanitizeAuditPath(c.req.path),
        status: c.res.status,
      },
    });
  });
};

export const __testOnly = {
  resolveFallbackAuditTarget,
  sanitizeAuditPath,
};
