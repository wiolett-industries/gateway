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
