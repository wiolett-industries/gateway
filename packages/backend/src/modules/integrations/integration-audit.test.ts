import { describe, expect, it } from 'vitest';
import {
  buildGitLabFileCommitAuditDetails,
  GITLAB_AUDIT_ACTIONS,
  hashGitLabDiff,
  redactGitLabAuditDetails,
} from './integration-audit.js';

describe('GitLab integration audit helpers', () => {
  it('exposes named connector audit actions', () => {
    expect(GITLAB_AUDIT_ACTIONS.fileCommit).toBe('connector.gitlab.file.commit');
    expect(GITLAB_AUDIT_ACTIONS.deployTokenCreate).toBe('connector.gitlab.deploy_token.create');
  });

  it('redacts raw secrets and replaces full diff-like payloads with hashes', () => {
    const details = redactGitLabAuditDetails({
      token: 'glpat-secret',
      variableValue: 'raw-secret',
      diff: 'full private diff',
      nested: { webhookSecret: 'hook-secret' },
    });

    expect(JSON.stringify(details)).not.toContain('glpat-secret');
    expect(JSON.stringify(details)).not.toContain('raw-secret');
    expect(JSON.stringify(details)).not.toContain('hook-secret');
    expect(details).toMatchObject({
      token: '[REDACTED]',
      variableValue: '[REDACTED]',
      diffHash: hashGitLabDiff('full private diff'),
      diffOmitted: true,
      nested: { webhookSecret: '[REDACTED]' },
    });
  });

  it('builds file commit audit details without storing a full diff', () => {
    const details = buildGitLabFileCommitAuditDetails({
      connectorId: 'connector-1',
      connectorName: 'Main GitLab',
      projectRemoteId: '10',
      projectFullPath: 'org/app',
      branch: 'main',
      actionCount: 2,
      filePaths: ['.gitlab-ci.yml', 'Dockerfile'],
      commitSha: 'abc123',
      diff: 'private diff body',
    });

    expect(details).toMatchObject({
      connectorId: 'connector-1',
      projectFullPath: 'org/app',
      branch: 'main',
      actionCount: 2,
      filePaths: ['.gitlab-ci.yml', 'Dockerfile'],
      commitSha: 'abc123',
      diffHash: hashGitLabDiff('private diff body'),
    });
    expect(JSON.stringify(details)).not.toContain('private diff body');
  });
});
