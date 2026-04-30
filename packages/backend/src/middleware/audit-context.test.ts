import { describe, expect, it } from 'vitest';
import { __testOnly } from './audit-context.js';

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

describe('shouldSkipFallbackAudit', () => {
  it('skips high-volume logging ingest and read-style POST routes', () => {
    expect(__testOnly.shouldSkipFallbackAudit('POST', '/api/logging/ingest')).toBe(true);
    expect(__testOnly.shouldSkipFallbackAudit('POST', '/api/logging/ingest/batch')).toBe(true);
    expect(
      __testOnly.shouldSkipFallbackAudit(
        'POST',
        '/api/logging/environments/11111111-1111-4111-8111-111111111111/search'
      )
    ).toBe(true);
  });

  it('keeps logging create/update/delete routes eligible for service or fallback audit', () => {
    expect(__testOnly.shouldSkipFallbackAudit('POST', '/api/logging/environments')).toBe(false);
    expect(
      __testOnly.shouldSkipFallbackAudit('DELETE', '/api/logging/environments/11111111-1111-4111-8111-111111111111')
    ).toBe(false);
  });
});
