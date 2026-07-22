import { describe, expect, it } from 'vitest';
import { computeEffectiveUserAccess, type GroupScopeRecord } from './live-session-user.js';

function groupMap(...groups: GroupScopeRecord[]) {
  return new Map(groups.map((group) => [group.id, group]));
}

describe('computeEffectiveUserAccess', () => {
  it('keeps group, additional, and effective scopes distinct', () => {
    const access = computeEffectiveUserAccess(
      'operators',
      groupMap(
        { id: 'base', parentId: null, name: 'base', scopes: ['nodes:details:node-1'] },
        { id: 'operators', parentId: 'base', name: 'operators', scopes: ['nodes:logs:node-1'] }
      ),
      ['nodes:console:node-1']
    );

    expect(access.groupScopes).toEqual(['nodes:details:node-1', 'nodes:logs:node-1']);
    expect(access.additionalScopes).toEqual(['nodes:console:node-1']);
    expect(access.scopes).toEqual(['nodes:console:node-1', 'nodes:details:node-1', 'nodes:logs:node-1']);
  });

  it('preserves an additional resource grant even when a broad group scope currently covers it', () => {
    const access = computeEffectiveUserAccess(
      'operators',
      groupMap({ id: 'operators', parentId: null, name: 'operators', scopes: ['nodes:console'] }),
      ['nodes:console:node-1']
    );

    expect(access.additionalScopes).toEqual(['nodes:console:node-1']);
    expect(access.scopes).toEqual(['nodes:console']);
  });
});
