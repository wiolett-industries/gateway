import { describe, expect, it } from 'vitest';
// sanitizeAuditPath is intentionally tested through the middleware module's export surface.
import { __testOnly } from '@/middleware/audit-context.js';
import { extractClientIp } from './audit-request-context.js';

describe('extractClientIp', () => {
  it('prefers the first x-forwarded-for hop', () => {
    const headers = new Headers({
      'x-forwarded-for': '198.51.100.10, 203.0.113.4',
      'x-real-ip': '203.0.113.4',
    });

    expect(extractClientIp(headers)).toBe('198.51.100.10');
  });

  it('falls back to direct client ip headers', () => {
    const headers = new Headers({
      'cf-connecting-ip': '203.0.113.9',
    });

    expect(extractClientIp(headers)).toBe('203.0.113.9');
  });
});

describe('sanitizeAuditPath', () => {
  it('redacts high-entropy path segments', () => {
    expect(__testOnly.sanitizeAuditPath('/api/webhooks/docker/0123456789abcdef0123456789abcdef')).toBe(
      '/api/webhooks/docker/:redacted'
    );
  });

  it('redacts uuid segments and keeps stable route parts', () => {
    expect(__testOnly.sanitizeAuditPath('/api/nodes/123e4567-e89b-12d3-a456-426614174000/config')).toBe(
      '/api/nodes/:id/config'
    );
  });
});

describe('resolveFallbackAuditTarget', () => {
  it('maps Docker container actions away from generic route audit actions', () => {
    expect(
      __testOnly.resolveFallbackAuditTarget(
        'POST',
        '/api/docker/nodes/11111111-1111-4111-8111-111111111111/containers/f4b0d9c82b26/start'
      )
    ).toEqual({
      action: 'docker.container.start',
      resourceType: 'docker-container',
      resourceId: 'f4b0d9c82b26',
    });
  });

  it('maps Docker health-check routes that do not emit service audit entries', () => {
    expect(
      __testOnly.resolveFallbackAuditTarget(
        'PUT',
        '/api/docker/nodes/11111111-1111-4111-8111-111111111111/containers/api/health-check'
      )
    ).toEqual({
      action: 'docker.health_check.configure',
      resourceType: 'docker-health-check',
      resourceId: 'api',
    });
  });

  it('keeps a generic fallback for unknown mutating routes', () => {
    expect(__testOnly.resolveFallbackAuditTarget('POST', '/api/unknown')).toEqual({
      action: 'route.post',
      resourceType: 'http-route',
    });
  });
});
