import { describe, expect, it } from 'vitest';
import { CreateTokenSchema, UpdateTokenSchema } from './tokens.schemas.js';

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

  it('allows delegable scopes for API tokens', () => {
    const result = CreateTokenSchema.safeParse({
      name: 'CI token',
      scopes: ['nodes:list', 'proxy:list'],
    });

    expect(result.success).toBe(true);
  });

  it('rejects mcp:use for API tokens', () => {
    const result = CreateTokenSchema.safeParse({
      name: 'CI token',
      scopes: ['nodes:list', 'mcp:use'],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'One or more scopes cannot be granted to API tokens'
    );
  });
});

describe('UpdateTokenSchema', () => {
  it('allows updating scopes without renaming the token', () => {
    const result = UpdateTokenSchema.safeParse({
      scopes: ['nodes:list', 'proxy:list'],
    });

    expect(result.success).toBe(true);
  });

  it('rejects an update without any fields', () => {
    const result = UpdateTokenSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain('At least one field is required');
  });
});
