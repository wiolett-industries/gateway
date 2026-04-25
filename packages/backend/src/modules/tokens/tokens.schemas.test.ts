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
      'AI scopes are user-only and cannot be granted to API tokens'
    );
  });

  it('allows non-AI scopes for API tokens', () => {
    const result = CreateTokenSchema.safeParse({
      name: 'CI token',
      scopes: ['nodes:list'],
    });

    expect(result.success).toBe(true);
  });
});
