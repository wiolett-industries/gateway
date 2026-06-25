import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertFetchUrlAllowed, isBlockedNetworkAddress, readResponseBodyCapped } from './network.js';

describe('sandbox runner network bridge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects redirects to blocked network addresses before following them', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/secret' },
      })
    );

    await expect(readResponseBodyCapped('http://93.184.216.34/file', 1024)).rejects.toThrow('blocked network address');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://93.184.216.34/file',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('follows allowed redirects with capped response reads', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: '/final' },
        })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }));

    const result = await readResponseBodyCapped('http://93.184.216.34/start', 1024);

    expect(result.status).toBe(200);
    expect(result.contentType).toBe('text/plain');
    expect(result.buffer.toString('utf8')).toBe('ok');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://93.184.216.34/final',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('limits redirect chains', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    for (let i = 0; i < 6; i += 1) {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: `http://93.184.216.34/next-${i}` },
        })
      );
    }

    await expect(readResponseBodyCapped('http://93.184.216.34/start', 1024)).rejects.toThrow('too many redirects');
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('rejects localhost and private address inputs', async () => {
    await expect(assertFetchUrlAllowed('http://localhost/test')).rejects.toThrow('localhost URLs are not allowed');
    expect(isBlockedNetworkAddress('10.0.0.1')).toBe(true);
    expect(isBlockedNetworkAddress('192.168.1.10')).toBe(true);
    expect(isBlockedNetworkAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedNetworkAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedNetworkAddress('::ffff:c0a8:0101')).toBe(true);
    expect(isBlockedNetworkAddress('::ffff:5db8:d822')).toBe(false);
    expect(isBlockedNetworkAddress('fe80::1')).toBe(true);
    expect(isBlockedNetworkAddress('fe90::1')).toBe(true);
    expect(isBlockedNetworkAddress('febf::1')).toBe(true);
    expect(isBlockedNetworkAddress('fec0::1')).toBe(false);
    expect(isBlockedNetworkAddress('93.184.216.34')).toBe(false);
  });
});
