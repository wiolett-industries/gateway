import { describe, expect, it } from 'vitest';
import { classifyAIToolForApproval, getAIToolApprovalDecision } from './ai-approval-policy.js';

describe('AI backend approval policy', () => {
  it('never asks for system assistant tools', () => {
    for (const toolName of [
      'ask_question',
      'discover_tools',
      'internal_documentation',
      'get_current_context',
      'wait',
      'send_comment',
      'search_chats',
      'find_in_chat',
      'read_chat_slice',
      'list_projects',
    ]) {
      expect(getAIToolApprovalDecision(toolName, 'always-ask')).toEqual({
        classification: 'system-never-ask',
        approvalPolicy: 'system_skipped',
        requiresApproval: false,
      });
    }
  });

  it('asks for every non-system tool in always-ask mode', () => {
    expect(getAIToolApprovalDecision('list_proxy_hosts', 'always-ask')).toMatchObject({
      classification: 'read',
      approvalPolicy: 'requires_approval',
      requiresApproval: true,
    });
    expect(getAIToolApprovalDecision('create_proxy_host', 'always-ask')).toMatchObject({
      classification: 'create',
      requiresApproval: true,
    });
  });

  it('normal mode auto-approves reads and asks for mutations', () => {
    expect(getAIToolApprovalDecision('list_proxy_hosts', 'normal')).toMatchObject({
      classification: 'read',
      approvalPolicy: 'auto_approved',
      requiresApproval: false,
    });
    expect(getAIToolApprovalDecision('update_proxy_host', 'normal')).toMatchObject({
      classification: 'update',
      approvalPolicy: 'requires_approval',
      requiresApproval: true,
    });
  });

  it('bypass-non-destructive mode still asks for delete and execute classes', () => {
    expect(getAIToolApprovalDecision('create_proxy_host', 'bypass-non-destructive')).toMatchObject({
      classification: 'create',
      approvalPolicy: 'auto_approved',
      requiresApproval: false,
    });
    expect(getAIToolApprovalDecision('delete_proxy_host', 'bypass-non-destructive')).toMatchObject({
      classification: 'delete',
      approvalPolicy: 'requires_approval',
      requiresApproval: true,
    });
    expect(getAIToolApprovalDecision('execute_node_console_command', 'bypass-non-destructive')).toMatchObject({
      classification: 'execute',
      approvalPolicy: 'requires_approval',
      requiresApproval: true,
    });
  });

  it('bypass-everything mode auto-approves policy-eligible tools', () => {
    expect(getAIToolApprovalDecision('delete_proxy_host', 'bypass-everything')).toMatchObject({
      classification: 'delete',
      approvalPolicy: 'auto_approved',
      requiresApproval: false,
    });
  });

  it('classifies mutating manage tools from registry metadata', () => {
    expect(classifyAIToolForApproval('manage_license')).toBe('update');
    expect(classifyAIToolForApproval('find_resource')).toBe('read');
  });
});
