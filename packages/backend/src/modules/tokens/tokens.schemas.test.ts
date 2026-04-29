import { describe, expect, it } from 'vitest';
import { CreateTokenSchema } from './tokens.schemas.js';

describe('CreateTokenSchema', () => {
  it('rejects user-only AI scopes for API tokens', () => {
    const result = CreateTokenSchema.safeParse({
      name: 'CI token',
      scopes: ['nodes:list', 'feat:ai:use'],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'One or more scopes cannot be granted to API tokens'
    );
  });

  it('rejects admin:system for API tokens', () => {
    const result = CreateTokenSchema.safeParse({
      name: 'CI token',
      scopes: ['nodes:list', 'admin:system'],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'One or more scopes cannot be granted to API tokens'
    );
  });

  it('allows non-AI scopes for API tokens', () => {
    const result = CreateTokenSchema.safeParse({
      name: 'CI token',
      scopes: ['nodes:list', 'mcp:use'],
    });

    expect(result.success).toBe(true);
  });
});
