import { describe, expect, it } from 'vitest';
import { DOC_TOPIC_SCOPES, getInternalDocumentation, INTERNAL_DOCS } from './ai.docs.js';
import { AI_TOOLS } from './ai.tools.js';

describe('AI internal docs registry', () => {
  it('keeps topic registry and scope contracts stable', () => {
    expect(Object.keys(INTERNAL_DOCS)).toEqual([
      'discovery',
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
      'logging',
      'api',
      'notifications',
    ]);
    expect(DOC_TOPIC_SCOPES).toMatchObject({
      discovery: 'feat:ai:use',
      permissions: 'feat:ai:use',
      docker: 'docker:containers:view',
      logging: ['logs:environments:view', 'logs:schemas:view', 'logs:read', 'logs:manage'],
      notifications: 'notifications:view',
      proxy: 'proxy:view',
    });
  });

  it('keeps internal_documentation tool topics aligned with the docs registry', () => {
    const tool = AI_TOOLS.find((candidate) => candidate.name === 'internal_documentation');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('logging');
    expect(tool?.description).toContain('discovery');
    const parameters = tool?.parameters as { properties: { topic: { enum: string[] } } };
    expect(parameters.properties.topic.enum).toEqual(Object.keys(INTERNAL_DOCS));
  });

  it('returns allowed documentation and preserves permission topic content', () => {
    expect(getInternalDocumentation('permissions', ['feat:ai:use'])).toEqual({
      topic: 'permissions',
      content: INTERNAL_DOCS.permissions,
    });
    expect(INTERNAL_DOCS.permissions).toContain('# Permissions');
    expect(INTERNAL_DOCS.permissions).toContain('Resource-Scoped Permissions');
    expect(INTERNAL_DOCS.permissions).toContain('docker:containers:view');

    expect(getInternalDocumentation('discovery', ['feat:ai:use']).content).toContain('discover_tools');
    expect(getInternalDocumentation('discovery', ['feat:ai:use']).content).toContain('get_current_context');
    expect(getInternalDocumentation('discovery', ['feat:ai:use']).content).toContain('find_resource');
    expect(getInternalDocumentation('logging', ['logs:schemas:view']).content).toContain('manage_logging');
    expect(getInternalDocumentation('logging', ['logs:read:env-1']).content).toContain('External Logging');
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
