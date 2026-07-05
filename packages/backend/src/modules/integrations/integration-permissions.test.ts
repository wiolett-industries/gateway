import { describe, expect, it } from 'vitest';
import { assertConnectorOperationAccess } from './integration-permissions.js';

describe('integration connector permission gate', () => {
  it('denies an operation when the actor lacks the Gateway scope', () => {
    expect(() =>
      assertConnectorOperationAccess({
        actor: { userId: 'user-1', scopes: ['integrations:gitlab:view'] },
        provider: 'gitlab',
        connectorId: 'connector-1',
        operation: 'file.commit',
        requiredScope: 'integrations:gitlab:repo:write',
        capabilities: { repoWrite: true },
        requiredCapability: 'repoWrite',
      })
    ).toThrowError(expect.objectContaining({ code: 'CONNECTOR_SCOPE_DENIED' }));
  });

  it('denies an operation when the PAT capability is missing even if the Gateway scope exists', () => {
    expect(() =>
      assertConnectorOperationAccess({
        actor: { userId: 'user-1', scopes: ['integrations:gitlab:repo:write'] },
        provider: 'gitlab',
        connectorId: 'connector-1',
        operation: 'file.commit',
        requiredScope: 'integrations:gitlab:repo:write',
        capabilities: { repoWrite: false },
        requiredCapability: 'repoWrite',
      })
    ).toThrowError(expect.objectContaining({ code: 'CONNECTOR_CAPABILITY_DENIED' }));
  });

  it('denies project operations outside the connector allowlist', () => {
    expect(() =>
      assertConnectorOperationAccess({
        actor: { userId: 'user-1', scopes: ['integrations:gitlab:repo:read'] },
        provider: 'gitlab',
        connectorId: 'connector-1',
        operation: 'file.read',
        requiredScope: 'integrations:gitlab:repo:read',
        capabilities: { repoRead: true },
        requiredCapability: 'repoRead',
        projectAllowed: false,
        project: { remoteId: '10', fullPath: 'private/app', name: 'app' },
      })
    ).toThrowError(expect.objectContaining({ code: 'CONNECTOR_PROJECT_NOT_ALLOWED' }));
  });

  it('returns normalized metadata for allowed operations', () => {
    expect(
      assertConnectorOperationAccess({
        actor: { userId: 'user-1', scopes: ['integrations:gitlab:repo:read'] },
        provider: 'gitlab',
        connectorId: 'connector-1',
        connectorName: 'Main GitLab',
        operation: 'file.read',
        requiredScope: ['integrations:gitlab:manage', 'integrations:gitlab:repo:read'],
        capabilities: { repoRead: true },
        requiredCapability: 'repoRead',
        projectAllowed: true,
      })
    ).toMatchObject({
      provider: 'gitlab',
      connectorId: 'connector-1',
      connectorName: 'Main GitLab',
      operation: 'file.read',
      grantedScope: 'integrations:gitlab:repo:read',
    });
  });
});
