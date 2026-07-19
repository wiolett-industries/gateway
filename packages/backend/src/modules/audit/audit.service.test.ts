import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { auditLog } from '@/db/schema/index.js';
import { AuditService } from './audit.service.js';
import { runWithAuditRequestContext } from './audit-request-context.js';

describe('auditLog schema', () => {
  it('stores resource IDs as text so Docker IDs can be audited', () => {
    expect(auditLog.resourceId.getSQLType()).toBe('text');
  });
});

describe('AuditService MCP context', () => {
  it('enriches domain audit entries with the MCP tool and redacted arguments', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = { insert: vi.fn(() => ({ values })) } as any;
    const service = new AuditService(db);

    await runWithAuditRequestContext(
      {
        auditEmitted: false,
        mcp: {
          toolName: 'update_proxy_host',
          category: 'Proxy Hosts',
          arguments: { proxyHostId: 'proxy-1', token: '[REDACTED]' },
          tokenPrefix: 'gwo_abc123',
          authType: 'oauth',
          clientId: 'client-1',
        },
      },
      () =>
        service.log({
          userId: 'user-1',
          action: 'proxy_host.update',
          resourceType: 'proxy_host',
          resourceId: 'proxy-1',
          details: { domainNames: ['example.com'] },
        })
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'proxy_host.update',
        details: {
          domainNames: ['example.com'],
          source: 'mcp',
          toolName: 'update_proxy_host',
          category: 'Proxy Hosts',
          arguments: { proxyHostId: 'proxy-1', token: '[REDACTED]' },
          tokenPrefix: 'gwo_abc123',
          authType: 'oauth',
          clientId: 'client-1',
        },
      })
    );
  });
});
