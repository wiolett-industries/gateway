import { describe, expect, it, vi } from 'vitest';
import { GitLabProvider } from './gitlab-provider.js';

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers });
}

describe('GitLabProvider', () => {
  it('detects read/write capabilities from safe probes and token scopes', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v4/user') return jsonResponse({ id: 1, username: 'bot' });
      if (url.pathname === '/api/v4/personal_access_tokens/self') {
        return jsonResponse({ scopes: ['api', 'write_repository', 'read_registry'] });
      }
      if (url.pathname === '/api/v4/projects') {
        return jsonResponse([
          { id: 10, path_with_namespace: 'org/app', name: 'app', web_url: 'https://gitlab.test/org/app' },
        ]);
      }
      if (url.pathname === '/api/v4/groups') {
        return jsonResponse([{ id: 20, full_path: 'org', name: 'org', web_url: 'https://gitlab.test/org' }]);
      }
      if (url.pathname === '/api/v4/projects/10/repository/tree') return jsonResponse([]);
      if (url.pathname === '/api/v4/projects/10/pipelines') return jsonResponse([]);
      if (url.pathname === '/api/v4/projects/10/variables') return jsonResponse([]);
      if (url.pathname === '/api/v4/projects/10/registry/repositories') return jsonResponse([]);
      if (url.pathname === '/api/v4/ci/lint') return jsonResponse({ valid: true });
      return new Response('not found', { status: 404 });
    });

    const provider = new GitLabProvider(fetchImpl as typeof fetch);
    const capabilities = await provider.testConnection({ baseUrl: 'https://gitlab.test/', token: 'glpat-secret' });

    expect(capabilities).toMatchObject({
      apiReachable: true,
      tokenSelf: true,
      projectsView: true,
      groupsView: true,
      repoRead: true,
      repoWrite: true,
      ciLint: true,
      variablesDelete: true,
      registryUse: true,
      webhooksManage: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/api/v4/user'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'PRIVATE-TOKEN': 'glpat-secret' }),
      })
    );
  });

  it('combines group and project search results for allowlist selection', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v4/groups') {
        return jsonResponse([{ id: 1, full_path: 'org', name: 'Org', web_url: 'https://gitlab.test/org' }]);
      }
      if (url.pathname === '/api/v4/projects') {
        return jsonResponse([
          { id: 2, path_with_namespace: 'org/app', name: 'App', web_url: 'https://gitlab.test/org/app' },
        ]);
      }
      return jsonResponse([]);
    });

    const provider = new GitLabProvider(fetchImpl as typeof fetch);
    const results = await provider.searchAllowlist({ baseUrl: 'https://gitlab.test', token: 'token' }, 'org');

    expect(results).toEqual([
      { entryType: 'group', remoteId: '1', fullPath: 'org', name: 'Org', webUrl: 'https://gitlab.test/org' },
      { entryType: 'project', remoteId: '2', fullPath: 'org/app', name: 'App', webUrl: 'https://gitlab.test/org/app' },
    ]);
  });

  it('lists registries only for the provided project scope', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v4/projects') {
        return jsonResponse([{ id: 12, path_with_namespace: 'org/private', name: 'private' }]);
      }
      if (url.pathname === '/api/v4/projects/11/registry/repositories') {
        return jsonResponse([
          {
            id: 101,
            location: 'registry.gitlab.test/org/app',
            name: 'app',
            path: 'org/app',
          },
        ]);
      }
      if (url.pathname === '/api/v4/projects/12/registry/repositories') {
        return new Response('forbidden', { status: 403 });
      }
      return jsonResponse([]);
    });

    const provider = new GitLabProvider(fetchImpl as typeof fetch);
    const registries = await provider.listRegistries({ baseUrl: 'https://gitlab.test', token: 'token' }, [
      { remoteId: '11', fullPath: 'org/app', name: 'app' },
    ]);

    expect(registries).toEqual([
      {
        remoteRegistryId: '101',
        projectRemoteId: '11',
        projectFullPath: 'org/app',
        registryUrl: 'registry.gitlab.test/org/app',
        name: 'app',
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/api/v4/projects/11/registry/repositories'),
      expect.any(Object)
    );
  });
});
