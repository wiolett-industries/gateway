import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuditRequestContext {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  auditEmitted?: boolean;
  mcp?: AuditMcpContext;
}

export interface AuditMcpContext {
  toolName: string;
  category: string;
  arguments: Record<string, unknown>;
  tokenId?: string;
  tokenPrefix?: string;
  authType?: string;
  clientId?: string;
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

export function setAuditMcpContext(mcp: AuditMcpContext): void {
  const context = storage.getStore();
  if (context) {
    context.mcp = mcp;
  }
}
