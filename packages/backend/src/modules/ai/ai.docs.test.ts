import { describe, expect, it } from 'vitest';
import { DOC_TOPIC_SCOPES, getInternalDocumentation, INTERNAL_DOCS } from './ai.docs.js';

describe('AI internal docs registry', () => {
  it('keeps topic registry and scope contracts stable', () => {
    expect(Object.keys(INTERNAL_DOCS)).toEqual([
      'pki',
      'ssl',
      'proxy',
      'domains',
      'access-lists',
      'templates',
      'acme',
      'users',
      'audit',
      'nginx',
      'nodes',
      'housekeeping',
      'permissions',
      'docker',
      'databases',
      'postgres',
      'redis',
      'api',
      'notifications',
    ]);
    expect(DOC_TOPIC_SCOPES).toMatchObject({
      permissions: 'feat:ai:use',
      docker: 'docker:containers:view',
      notifications: 'notifications:view',
      proxy: 'proxy:view',
    });
  });

  it('returns allowed documentation and preserves permission topic content', () => {
    expect(getInternalDocumentation('permissions', ['feat:ai:use'])).toEqual({
      topic: 'permissions',
      content: INTERNAL_DOCS.permissions,
    });
    expect(INTERNAL_DOCS.permissions).toContain('# Permissions');
    expect(INTERNAL_DOCS.permissions).toContain('Resource-Scoped Permissions');
    expect(INTERNAL_DOCS.permissions).toContain('docker:containers:view');
  });

  it('filters unknown-topic suggestions and denies unauthorized topics', () => {
    expect(getInternalDocumentation('docker', ['feat:ai:use'])).toEqual({
      topic: 'docker',
      content: 'You do not have permission to access documentation for "docker".',
    });

    const unknown = getInternalDocumentation('missing', ['feat:ai:use']);
    expect(unknown.topic).toBe('missing');
    expect(unknown.content).toContain('Unknown topic "missing".');
    expect(unknown.content).toContain('permissions');
    expect(unknown.content).toContain('api');
    expect(unknown.content).not.toContain('docker');
    expect(unknown.content).not.toContain('proxy');
  });
});
