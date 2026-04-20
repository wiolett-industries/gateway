import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuditRequestContext {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  auditEmitted?: boolean;
}

const storage = new AsyncLocalStorage<AuditRequestContext>();

export function runWithAuditRequestContext<T>(context: AuditRequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function getAuditRequestContext(): AuditRequestContext | undefined {
  return storage.getStore();
}

export function markAuditEmitted(): void {
  const context = storage.getStore();
  if (context) {
    context.auditEmitted = true;
  }
}

export function extractClientIp(headers: Pick<Headers, 'get'>): string | undefined {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstHop = forwardedFor
      .split(',')
      .map((value) => value.trim())
      .find(Boolean);
    if (firstHop) {
      return firstHop;
    }
  }

  const directHeaders = ['cf-connecting-ip', 'x-real-ip', 'x-client-ip'];
  for (const header of directHeaders) {
    const value = headers.get(header)?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}
