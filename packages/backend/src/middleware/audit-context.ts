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
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_SEGMENT = /^[0-9a-f]{16,}$/i;
const TOKENISH_SEGMENT = /^[A-Za-z0-9_-]{16,}$/;

function shouldEmitFallbackAudit(c: Parameters<MiddlewareHandler<AppEnv>>[0]): boolean {
  if (!MUTATING_METHODS.has(c.req.method)) {
    return false;
  }

  if (c.res.status < 200 || c.res.status >= 400) {
    return false;
  }

  return !getAuditRequestContext()?.auditEmitted;
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
        path: sanitizeAuditPath(c.req.path),
        status: c.res.status,
      },
    });
  });
};

export const __testOnly = {
  sanitizeAuditPath,
};
