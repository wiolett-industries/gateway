import { afterEach, describe, expect, it, vi } from 'vitest';
import { container } from '@/container.js';
import { IntegrationsService } from '@/modules/integrations/integrations.service.js';
import { AIService } from './ai.service.js';

const BASE_USER = {
  id: 'user-1',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: [] as string[],
  isBlocked: false,
};

function createService(auditService = { log: vi.fn() }) {
  return new AIService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    auditService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
}

describe('AIService GitLab tool routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes GitLab connector listing through IntegrationsService', async () => {
    const integrationsService = {
      listGitLabConnectorsForTool: vi.fn().mockResolvedValue([{ id: 'connector-1', name: 'Main GitLab' }]),
    };
    vi.spyOn(container, 'resolve').mockImplementation((token) => {
      if (token === IntegrationsService) return integrationsService as never;
      throw new Error('unexpected resolver call');
    });

    await expect(
      createService().executeTool({ ...BASE_USER, scopes: ['integrations:gitlab:view'] }, 'gitlab_list_connectors', {})
    ).resolves.toEqual({
      result: [{ id: 'connector-1', name: 'Main GitLab' }],
      invalidateStores: [],
    });
    expect(integrationsService.listGitLabConnectorsForTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' })
    );
  });

  it('preserves masked deploy token metadata returned by the integration layer', async () => {
    const integrationsService = {
      gitLabCreateDeployToken: vi.fn().mockResolvedValue({
        credentialId: 'credential-1',
        username: 'gitlab+deploy-token-1',
        tokenMasked: '****abcd',
        scopes: ['read_registry'],
      }),
    };
    vi.spyOn(container, 'resolve').mockImplementation((token) => {
      if (token === IntegrationsService) return integrationsService as never;
      throw new Error('unexpected resolver call');
    });

    await expect(
      createService().executeTool(
        { ...BASE_USER, scopes: ['integrations:gitlab:registry:manage'] },
        'gitlab_create_deploy_token',
        {
          connectorId: 'connector-1',
          project: 'group/app',
          name: 'Deploy',
          scopes: ['read_registry'],
        }
      )
    ).resolves.toMatchObject({
      result: {
        credentialId: 'credential-1',
        username: 'gitlab+deploy-token-1',
        tokenMasked: '****abcd',
        scopes: ['read_registry'],
      },
      invalidateStores: [],
    });
  });

  it('routes GitLab connector sync and allowlist update through IntegrationsService', async () => {
    const integrationsService = {
      gitLabSyncConnectorForTool: vi.fn().mockResolvedValue({ status: 'success' }),
      gitLabAddConnectorProjects: vi.fn().mockResolvedValue({ added: [{ fullPath: 'group/app' }] }),
    };
    vi.spyOn(container, 'resolve').mockImplementation((token) => {
      if (token === IntegrationsService) return integrationsService as never;
      throw new Error('unexpected resolver call');
    });

    await expect(
      createService().executeTool({ ...BASE_USER, scopes: ['integrations:gitlab:manage'] }, 'gitlab_sync_connector', {
        connectorId: 'connector-1',
      })
    ).resolves.toMatchObject({ result: { status: 'success' } });
    await expect(
      createService().executeTool(
        { ...BASE_USER, scopes: ['integrations:gitlab:manage'] },
        'gitlab_add_connector_projects',
        { connectorId: 'connector-1', projects: ['group/app'], syncAfter: true }
      )
    ).resolves.toMatchObject({ result: { added: [{ fullPath: 'group/app' }] } });

    expect(integrationsService.gitLabSyncConnectorForTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      { connectorId: 'connector-1' }
    );
    expect(integrationsService.gitLabAddConnectorProjects).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      { connectorId: 'connector-1', projects: ['group/app'], syncAfter: true }
    );
  });

  it('routes GitLab project settings updates through IntegrationsService', async () => {
    const integrationsService = {
      gitLabUpdateProjectSettings: vi.fn().mockResolvedValue({ fullPath: 'group/app' }),
    };
    vi.spyOn(container, 'resolve').mockImplementation((token) => {
      if (token === IntegrationsService) return integrationsService as never;
      throw new Error('unexpected resolver call');
    });

    await expect(
      createService().executeTool(
        { ...BASE_USER, scopes: ['integrations:gitlab:registry:manage'] },
        'gitlab_update_project_settings',
        { connectorId: 'connector-1', project: 'group/app', containerRegistryAccessLevel: 'enabled' }
      )
    ).resolves.toMatchObject({
      result: { fullPath: 'group/app' },
      invalidateStores: ['integrations', 'dockerRegistries'],
    });

    expect(integrationsService.gitLabUpdateProjectSettings).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      {
        connectorId: 'connector-1',
        project: 'group/app',
        containerRegistryAccessLevel: 'enabled',
      }
    );
  });

  it('rejects invalid GitLab project registry access levels instead of defaulting open', async () => {
    const integrationsService = {
      gitLabUpdateProjectSettings: vi.fn().mockResolvedValue({ fullPath: 'group/app' }),
    };
    vi.spyOn(container, 'resolve').mockImplementation((token) => {
      if (token === IntegrationsService) return integrationsService as never;
      throw new Error('unexpected resolver call');
    });

    await expect(
      createService().executeTool(
        { ...BASE_USER, scopes: ['integrations:gitlab:registry:manage'] },
        'gitlab_update_project_settings',
        { connectorId: 'connector-1', project: 'group/app', containerRegistryAccessLevel: 'public' }
      )
    ).resolves.toMatchObject({ error: 'containerRegistryAccessLevel must be one of: enabled, private, disabled' });

    expect(integrationsService.gitLabUpdateProjectSettings).not.toHaveBeenCalled();
  });

  it('redacts GitLab secret input values in the standard AI tool audit entry', async () => {
    const integrationsService = {
      gitLabSetProjectVariable: vi.fn().mockResolvedValue({
        key: 'SECRET_TOKEN',
        masked: true,
      }),
    };
    const auditService = { log: vi.fn() };
    vi.spyOn(container, 'resolve').mockImplementation((token) => {
      if (token === IntegrationsService) return integrationsService as never;
      throw new Error('unexpected resolver call');
    });

    await createService(auditService).executeTool(
      { ...BASE_USER, scopes: ['integrations:gitlab:variables:edit'] },
      'gitlab_set_project_variable',
      {
        connectorId: 'connector-1',
        project: 'group/app',
        key: 'SECRET_TOKEN',
        value: 'raw-secret-value',
      }
    );

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai.gitlab_set_project_variable',
        details: expect.objectContaining({
          arguments: expect.objectContaining({
            value: '[REDACTED]',
          }),
        }),
      })
    );
  });
});
