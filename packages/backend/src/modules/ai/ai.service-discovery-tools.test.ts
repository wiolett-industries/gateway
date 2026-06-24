import { describe, expect, it, vi } from 'vitest';
import { AIService } from './ai.service.js';

const BASE_USER = {
  id: 'user-1',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: ['feat:ai:use'] as string[],
  isBlocked: false,
};

function createService(config: Record<string, unknown> = {}) {
  return new AIService(
    { getConfig: vi.fn().mockResolvedValue({ disabledTools: [], webSearchEnabled: false, ...config }) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { log: vi.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
}

describe('AIService discovery tools', () => {
  it('returns the current page context supplied for this tool execution', async () => {
    const service = createService();

    const result = await service.executeTool(
      BASE_USER,
      'get_current_context',
      {},
      {
        pageContext: {
          route: '/proxy-hosts/host-1/settings',
          resourceType: 'proxy_host',
          resourceId: 'host-1',
        },
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toEqual({
      hasCurrentPage: true,
      currentPage: {
        route: '/proxy-hosts/host-1/settings',
        resourceType: 'proxy_host',
        resourceId: 'host-1',
      },
    });
  });

  it('discovers callable tools filtered by scope, config, category, and query', async () => {
    const service = createService({ disabledTools: ['get_current_context'], webSearchEnabled: true });

    const result = await service.executeTool(
      { ...BASE_USER, scopes: ['feat:ai:use', 'logs:schemas:create', 'logs:schemas:view'] },
      'discover_tools',
      { category: 'Logging', query: 'schema' }
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({
      totalCallableTools: expect.any(Number),
      categories: expect.arrayContaining([expect.objectContaining({ name: 'Logging' })]),
      tools: [
        expect.objectContaining({
          name: 'manage_logging',
          category: 'Logging',
          destructive: true,
        }),
      ],
    });
    expect(
      (result.result as { categories: Array<{ name: string }>; tools: Array<{ name: string }> }).categories.map(
        (category) => category.name
      )
    ).toContain('Discovery');
    expect(
      (result.result as { tools: Array<{ name: string }> }).tools.some((tool) => tool.name === 'get_current_context')
    ).toBe(false);
  });
});
