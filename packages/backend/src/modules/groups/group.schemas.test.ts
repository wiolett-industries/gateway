import { describe, expect, it } from 'vitest';
import { CreateGroupSchema, UpdateGroupSchema } from './group.schemas.js';

const VALID_GROUP = {
  name: 'custom-operators',
  description: 'Custom operators',
  scopes: ['nodes:list'],
};

describe('group schemas', () => {
  it('rejects admin:system for custom groups', () => {
    expect(CreateGroupSchema.safeParse({ ...VALID_GROUP, scopes: ['admin:system'] }).success).toBe(false);
    expect(UpdateGroupSchema.safeParse({ scopes: ['admin:system'] }).success).toBe(false);
  });

  it('allows valid custom group scopes', () => {
    expect(CreateGroupSchema.safeParse(VALID_GROUP).success).toBe(true);
    expect(UpdateGroupSchema.safeParse({ scopes: ['logs:schemas:view:schema-1'] }).success).toBe(true);
  });
});
