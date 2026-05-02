import { describe, expect, it } from 'vitest';
import { stripGroupedRawConfigForProgrammaticResponse } from './folder.routes.js';

describe('folder route programmatic responses', () => {
  it('strips raw proxy config fields from nested and ungrouped grouped hosts', () => {
    const result = stripGroupedRawConfigForProgrammaticResponse({
      folders: [
        {
          id: 'folder-1',
          name: 'Folder',
          parentId: null,
          sortOrder: 0,
          depth: 0,
          createdById: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          hosts: [
            {
              id: 'host-1',
              rawConfig: 'server {}',
              rawConfigEnabled: true,
              domainNames: ['a.example.com'],
            },
          ],
          children: [
            {
              id: 'folder-2',
              name: 'Child',
              parentId: 'folder-1',
              sortOrder: 0,
              depth: 1,
              createdById: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              hosts: [
                {
                  id: 'host-2',
                  rawConfig: 'server {}',
                  rawConfigEnabled: true,
                  domainNames: ['b.example.com'],
                },
              ],
              children: [],
            },
          ],
        },
      ],
      ungroupedHosts: [
        {
          id: 'host-3',
          rawConfig: 'server {}',
          rawConfigEnabled: true,
          domainNames: ['c.example.com'],
        },
      ],
      totalHosts: 3,
    } as any);

    expect(result.folders[0].hosts[0]).not.toHaveProperty('rawConfig');
    expect(result.folders[0].hosts[0]).not.toHaveProperty('rawConfigEnabled');
    expect(result.folders[0].children[0].hosts[0]).not.toHaveProperty('rawConfig');
    expect(result.folders[0].children[0].hosts[0]).not.toHaveProperty('rawConfigEnabled');
    expect(result.ungroupedHosts[0]).not.toHaveProperty('rawConfig');
    expect(result.ungroupedHosts[0]).not.toHaveProperty('rawConfigEnabled');
    expect(JSON.stringify(result)).not.toContain('rawConfig');
    expect(JSON.stringify(result)).not.toContain('rawConfigEnabled');
    expect(JSON.stringify(result)).not.toContain('server {}');
  });
});
