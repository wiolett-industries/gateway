import { describe, expect, it } from 'vitest';
import { redactOneTimeSecretToolResult } from './ai-secret-result-redaction.js';

describe('redactOneTimeSecretToolResult', () => {
  it('redacts one-time API token secrets from persistence/model copies', () => {
    expect(
      redactOneTimeSecretToolResult('manage_api_token', {
        id: 'token-1',
        name: 'Deploy',
        scopes: ['nodes:details'],
        token: 'gw_secret',
      })
    ).toEqual({
      id: 'token-1',
      name: 'Deploy',
      scopes: ['nodes:details'],
      token: '[REDACTED_ONE_TIME_SECRET]',
      tokenRedacted: true,
    });
  });

  it('leaves normal user-owned content and non-secret tool output unchanged', () => {
    const userContent = { content: 'my token-like note should stay searchable' };
    expect(redactOneTimeSecretToolResult('search_chats', userContent)).toBe(userContent);
    expect(redactOneTimeSecretToolResult('manage_api_token', { id: 'token-1', name: 'Deploy' })).toEqual({
      id: 'token-1',
      name: 'Deploy',
    });
  });
});
