import { describe, expect, it } from 'vitest';
import { getAIToolApprovalDecision } from '@/modules/ai/ai-approval-policy.js';
import { buildGitLabApprovalMetadata, classifyGitLabAIToolForApproval } from './gitlab-approval-policy.js';

describe('GitLab AI approval policy', () => {
  it('classifies planned GitLab tools before the tool registry is wired', () => {
    expect(classifyGitLabAIToolForApproval('gitlab_read_file')).toBe('read');
    expect(classifyGitLabAIToolForApproval('gitlab_lint_ci_config')).toBe('read');
    expect(classifyGitLabAIToolForApproval('gitlab_commit_files')).toBe('update');
    expect(classifyGitLabAIToolForApproval('gitlab_sync_connector')).toBe('update');
    expect(classifyGitLabAIToolForApproval('gitlab_add_connector_projects')).toBe('update');
    expect(classifyGitLabAIToolForApproval('gitlab_delete_project_variable')).toBe('delete');
  });

  it('always requires approval for variable delete even in full-access mode', () => {
    expect(getAIToolApprovalDecision('gitlab_delete_project_variable', 'bypass-everything')).toMatchObject({
      classification: 'delete',
      approvalPolicy: 'requires_approval',
      requiresApproval: true,
    });
  });

  it('always requires approval for direct GitLab commits even in full-access mode', () => {
    expect(getAIToolApprovalDecision('gitlab_commit_files', 'bypass-everything')).toMatchObject({
      classification: 'update',
      approvalPolicy: 'requires_approval',
      requiresApproval: true,
    });
    expect(getAIToolApprovalDecision('gitlab_update_ci_config', 'bypass-everything')).toMatchObject({
      classification: 'update',
      approvalPolicy: 'requires_approval',
      requiresApproval: true,
    });
    expect(getAIToolApprovalDecision('gitlab_update_project_settings', 'bypass-everything')).toMatchObject({
      classification: 'update',
      approvalPolicy: 'requires_approval',
      requiresApproval: true,
    });
    expect(getAIToolApprovalDecision('gitlab_add_connector_projects', 'bypass-everything')).toMatchObject({
      classification: 'update',
      approvalPolicy: 'requires_approval',
      requiresApproval: true,
    });
  });

  it('does not require unnecessary frontend approval for read tools in full-access mode', () => {
    expect(getAIToolApprovalDecision('gitlab_read_file', 'bypass-everything')).toMatchObject({
      classification: 'read',
      approvalPolicy: 'auto_approved',
      requiresApproval: false,
    });
  });

  it('marks protected/default branch operations for explicit approval text without exposing secrets', () => {
    const metadata = buildGitLabApprovalMetadata({
      connector: { id: 'connector-1', name: 'Main GitLab', baseUrl: 'https://gitlab.example.com' },
      project: { remoteId: '10', fullPath: 'org/app', name: 'app' },
      branch: 'main',
      defaultBranch: true,
      protectedBranch: true,
      operations: [
        { action: 'commit_file', filePath: '.gitlab-ci.yml' },
        { action: 'set_variable', settingsKey: 'SECRET_TOKEN', description: 'secret=raw-token' },
      ],
    });

    expect(metadata).toMatchObject({
      provider: 'gitlab',
      branch: 'main',
      protectedBranch: true,
      defaultBranch: true,
      requiresExplicitApprovalText: true,
    });
    expect(JSON.stringify(metadata)).not.toContain('raw-token');
  });
});
