import { describe, expect, it } from 'vitest';
import { formatHostPort, isValidUpstreamHost } from './network-endpoint.js';

describe('network endpoint formatting', () => {
  it('brackets IPv6 literals for URLs and Nginx upstreams', () => {
    expect(formatHostPort('fd00::10', 8080)).toBe('[fd00::10]:8080');
    expect(formatHostPort('docker.internal', 8080)).toBe('docker.internal:8080');
  });

  it('accepts IPv6 and existing Docker-style hostnames', () => {
    expect(isValidUpstreamHost('fd00::10')).toBe(true);
    expect(isValidUpstreamHost('docker_node.internal')).toBe(true);
    expect(isValidUpstreamHost('bad host')).toBe(false);
  });
});
