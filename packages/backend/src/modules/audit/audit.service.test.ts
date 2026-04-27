import { describe, expect, it } from 'vitest';
import { auditLog } from '@/db/schema/index.js';

describe('auditLog schema', () => {
  it('stores resource IDs as text so Docker IDs can be audited', () => {
    expect(auditLog.resourceId.getSQLType()).toBe('text');
  });
});
