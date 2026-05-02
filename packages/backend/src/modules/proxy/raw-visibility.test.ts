import { describe, expect, it } from 'vitest';
import {
  redactFolderTreeRawProxyConfigForBrowserResponse,
  redactGroupedRawProxyConfigForBrowserResponse,
  redactRawProxyConfigForBrowser,
  stripFolderTreeRawProxyConfigForProgrammaticResponse,
  stripGroupedRawProxyConfigForProgrammaticResponse,
  stripRawProxyConfigForProgrammatic,
} from './raw-visibility.js';

const rawHost = {
  id: 'host-1',
  domainNames: ['app.example.com'],
  rawConfig: 'server { proxy_set_header Authorization secret; }',
  rawConfigEnabled: true,
  forwardHost: 'app',
};

describe('proxy raw visibility serializers', () => {
  it('strips raw content and raw mode marker for programmatic host responses', () => {
    const result = stripRawProxyConfigForProgrammatic(rawHost);

    expect(result).toMatchObject({ id: 'host-1', domainNames: ['app.example.com'], forwardHost: 'app' });
    expect(result).not.toHaveProperty('rawConfig');
    expect(result).not.toHaveProperty('rawConfigEnabled');
  });

  it('redacts raw content but preserves raw mode marker for browser responses without raw-read', () => {
    const result = redactRawProxyConfigForBrowser(rawHost);

    expect(result.rawConfig).toBeNull();
    expect(result.rawConfigEnabled).toBe(true);
  });

  it('strips raw fields from nested grouped host trees for programmatic responses', () => {
    const result = stripGroupedRawProxyConfigForProgrammaticResponse({
      folders: [
        {
          id: 'folder-1',
          hosts: [rawHost],
          children: [
            {
              id: 'folder-2',
              hosts: [{ ...rawHost, id: 'host-2' }],
              children: [],
            },
          ],
        },
      ],
      ungroupedHosts: [{ ...rawHost, id: 'host-3' }],
      totalHosts: 3,
    } as any);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('rawConfig');
    expect(serialized).not.toContain('rawConfigEnabled');
    expect(serialized).not.toContain('proxy_set_header Authorization');
  });

  it('redacts raw content but preserves raw mode marker from grouped browser trees without raw-read', () => {
    const result = redactGroupedRawProxyConfigForBrowserResponse(
      {
        folders: [
          {
            id: 'folder-1',
            hosts: [rawHost],
            children: [],
          },
        ],
        ungroupedHosts: [{ ...rawHost, id: 'host-2' }],
        totalHosts: 2,
      } as any,
      () => false
    );

    expect((result.folders[0] as any).hosts[0].rawConfig).toBeNull();
    expect((result.folders[0] as any).hosts[0].rawConfigEnabled).toBe(true);
    expect(result.ungroupedHosts[0].rawConfig).toBeNull();
    expect(result.ungroupedHosts[0].rawConfigEnabled).toBe(true);
    expect(JSON.stringify(result)).not.toContain('proxy_set_header Authorization');
  });

  it('keeps raw content in grouped browser trees only for raw-readable hosts', () => {
    const result = redactGroupedRawProxyConfigForBrowserResponse(
      {
        folders: [
          {
            id: 'folder-1',
            hosts: [rawHost],
            children: [],
          },
        ],
        ungroupedHosts: [{ ...rawHost, id: 'host-2' }],
        totalHosts: 2,
      } as any,
      (host) => host.id === 'host-1'
    );

    expect((result.folders[0] as any).hosts[0].rawConfig).toBe(rawHost.rawConfig);
    expect((result.folders[0] as any).hosts[0].rawConfigEnabled).toBe(true);
    expect(result.ungroupedHosts[0].rawConfig).toBeNull();
    expect(result.ungroupedHosts[0].rawConfigEnabled).toBe(true);
  });

  it('strips raw fields from folder tree hosts for programmatic responses', () => {
    const result = stripFolderTreeRawProxyConfigForProgrammaticResponse([
      {
        id: 'folder-1',
        hosts: [rawHost],
        children: [{ id: 'folder-2', hosts: [{ ...rawHost, id: 'host-2' }], children: [] }],
      },
    ] as any);

    expect(JSON.stringify(result)).not.toContain('rawConfig');
    expect(JSON.stringify(result)).not.toContain('rawConfigEnabled');
    expect(JSON.stringify(result)).not.toContain('proxy_set_header Authorization');
  });

  it('redacts raw content from folder tree hosts for browser responses without raw-read', () => {
    const result = redactFolderTreeRawProxyConfigForBrowserResponse(
      [
        {
          id: 'folder-1',
          hosts: [rawHost],
          children: [{ id: 'folder-2', hosts: [{ ...rawHost, id: 'host-2' }], children: [] }],
        },
      ] as any,
      () => false
    );

    expect(result[0].hosts[0].rawConfig).toBeNull();
    expect(result[0].hosts[0].rawConfigEnabled).toBe(true);
    expect(result[0].children[0].hosts[0].rawConfig).toBeNull();
    expect(result[0].children[0].hosts[0].rawConfigEnabled).toBe(true);
    expect(JSON.stringify(result)).not.toContain('proxy_set_header Authorization');
  });
});
