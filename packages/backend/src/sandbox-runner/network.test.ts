import dns from 'node:dns/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertFetchUrlAllowed,
  isBlockedNetworkAddress,
  readResponseBodyCapped,
  setSandboxNetworkTransportForTests,
} from './network.js';

async function* bodyFrom(value: string) {
  yield Buffer.from(value);
}

function networkResponse(status: number, headers: Record<string, string> = {}, body = '') {
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Found',
    headers: new Headers(headers),
    body: bodyFrom(body),
    close: vi.fn(),
  };
}

describe('sandbox runner network bridge', () => {
  afterEach(() => {
    setSandboxNetworkTransportForTests(null);
    vi.restoreAllMocks();
  });

  it('rejects redirects to blocked network addresses before following them', async () => {
    const transport = vi.fn().mockResolvedValueOnce(networkResponse(302, { location: 'http://127.0.0.1/secret' }));
    setSandboxNetworkTransportForTests(transport);

    await expect(readResponseBodyCapped('http://93.184.216.34/file', 1024)).rejects.toThrow('blocked network address');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('follows allowed redirects with capped response reads', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(networkResponse(302, { location: '/final' }))
      .mockResolvedValueOnce(networkResponse(200, { 'content-type': 'text/plain' }, 'ok'));
    setSandboxNetworkTransportForTests(transport);

    const result = await readResponseBodyCapped('http://93.184.216.34/start', 1024);

    expect(result.status).toBe(200);
    expect(result.contentType).toBe('text/plain');
    expect(result.buffer.toString('utf8')).toBe('ok');
    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ url: new URL('http://93.184.216.34/final') }),
      expect.any(AbortSignal)
    );
  });

  it('limits redirect chains', async () => {
    const transport = vi.fn();
    for (let i = 0; i < 6; i += 1) {
      transport.mockResolvedValueOnce(networkResponse(302, { location: `http://93.184.216.34/next-${i}` }));
    }
    setSandboxNetworkTransportForTests(transport);

    await expect(readResponseBodyCapped('http://93.184.216.34/start', 1024)).rejects.toThrow('too many redirects');
    expect(transport).toHaveBeenCalledTimes(6);
  });

  it('pins the validated DNS address for the actual request transport', async () => {
    const lookup = vi
      .spyOn(dns, 'lookup')
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as unknown as Awaited<
        ReturnType<typeof dns.lookup>
      >);
    const transport = vi.fn().mockResolvedValueOnce(networkResponse(200, { 'content-type': 'text/plain' }, 'ok'));
    setSandboxNetworkTransportForTests(transport);

    await expect(readResponseBodyCapped('http://rebind.test/file', 1024)).resolves.toMatchObject({ status: 200 });

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ address: '93.184.216.34', family: 4 }),
      expect.any(AbortSignal)
    );
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
