import { describe, expect, it } from 'vitest';
import { imageRepositoryFromRef, isGatewayReleaseTag, selectLatestGatewayRelease } from './update.service.js';

describe('UpdateService release selection', () => {
  describe('isGatewayReleaseTag', () => {
    it('accepts plain gateway tags', () => {
      expect(isGatewayReleaseTag('v2.1.2')).toBe(true);
      expect(isGatewayReleaseTag('2.1.2')).toBe(true);
    });

    it('rejects daemon-suffixed tags', () => {
      expect(isGatewayReleaseTag('v2.1.1-docker')).toBe(false);
      expect(isGatewayReleaseTag('v2.1.1-nginx')).toBe(false);
      expect(isGatewayReleaseTag('v2.1.1-monitoring')).toBe(false);
    });
  });

  describe('selectLatestGatewayRelease', () => {
    it('ignores daemon release tags and selects the latest plain gateway tag', () => {
      const latest = selectLatestGatewayRelease([
        {
          tag_name: 'v2.1.1-docker',
          description: 'docker',
          _links: { self: 'docker' },
        },
        {
          tag_name: 'v2.1.2',
          description: 'gateway',
          _links: { self: 'gateway' },
        },
        {
          tag_name: 'v2.1.1-monitoring',
          description: 'monitoring',
          _links: { self: 'monitoring' },
        },
      ]);

      expect(latest?.tag_name).toBe('v2.1.2');
    });

    it('returns null when only daemon tags exist', () => {
      const latest = selectLatestGatewayRelease([
        {
          tag_name: 'v2.1.1-docker',
          description: 'docker',
          _links: { self: 'docker' },
        },
        {
          tag_name: 'v2.1.1-nginx',
          description: 'nginx',
          _links: { self: 'nginx' },
        },
      ]);

      expect(latest).toBeNull();
    });
  });
});

describe('imageRepositoryFromRef', () => {
  it('removes a mutable tag after a registry port', () => {
    expect(imageRepositoryFromRef('registry.example.com:5050/wiolett/gateway:v2.3.0')).toBe(
      'registry.example.com:5050/wiolett/gateway'
    );
  });

  it('removes a digest from an immutable image reference', () => {
    expect(imageRepositoryFromRef('registry.example.com/wiolett/gateway@sha256:abc')).toBe(
      'registry.example.com/wiolett/gateway'
    );
  });

  it('keeps untagged image references unchanged', () => {
    expect(imageRepositoryFromRef('registry.example.com/wiolett/gateway')).toBe('registry.example.com/wiolett/gateway');
  });
});
