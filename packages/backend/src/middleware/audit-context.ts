import type { MiddlewareHandler } from 'hono';
import { container } from '@/container.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import {
  extractClientIp,
  getAuditRequestContext,
  runWithAuditRequestContext,
} from '@/modules/audit/audit-request-context.js';
import type { AppEnv } from '@/types.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function shouldEmitFallbackAudit(c: Parameters<MiddlewareHandler<AppEnv>>[0]): boolean {
  if (!MUTATING_METHODS.has(c.req.method)) {
    return false;
  }

  if (c.res.status < 200 || c.res.status >= 400) {
    return false;
  }

  return !getAuditRequestContext()?.auditEmitted;
}

export const auditContextMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const context = {
    requestId: c.get('requestId'),
    ipAddress: extractClientIp(c.req.raw.headers),
    userAgent: c.req.header('user-agent'),
    auditEmitted: false,
  };

  await runWithAuditRequestContext(context, async () => {
    await next();

    if (!shouldEmitFallbackAudit(c)) {
      return;
    }

    const auditService = container.resolve(AuditService);
    await auditService.log({
      userId: c.get('user')?.id ?? null,
      action: `route.${c.req.method.toLowerCase()}`,
      resourceType: 'http-route',
      details: {
        path: c.req.path,
        status: c.res.status,
      },
    });
  });
};
