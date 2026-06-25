import { Buffer } from 'node:buffer';
import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_REDIRECTS = 5;

export async function readResponseBodyCapped(
  url: string,
  limitBytes: number
): Promise<{
  status: number;
  contentType: string | null;
  buffer: Buffer;
}> {
  let currentUrl = url;
  let redirects = 0;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    while (true) {
      await assertFetchUrlAllowed(currentUrl);
      const response = await fetch(currentUrl, { signal: controller.signal, redirect: 'manual' });
      if (isRedirectStatus(response.status)) {
        if (redirects >= MAX_REDIRECTS) throw new Error(`too many redirects (max ${MAX_REDIRECTS})`);
        const location = response.headers.get('location');
        if (!location) throw new Error(`redirect response missing location header (${response.status})`);
        await response.body?.cancel().catch(() => {});
        currentUrl = new URL(location, currentUrl).toString();
        redirects += 1;
        continue;
      }

      if (!response.ok) {
        throw new Error(`fetch failed (${response.status} ${response.statusText})`);
      }
      if (!response.body) throw new Error('fetch response body is not readable');

      const contentLength = response.headers.get('content-length');
      if (contentLength && Number(contentLength) > limitBytes) {
        throw new Error(`download exceeds ${limitBytes} byte limit`);
      }

      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.byteLength;
        if (total > limitBytes) {
          await reader.cancel().catch(() => {});
          throw new Error(`download exceeds ${limitBytes} byte limit`);
        }
        chunks.push(chunk);
      }
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        buffer: Buffer.concat(chunks, total),
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export async function assertFetchUrlAllowed(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('url must be a valid HTTP or HTTPS URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('url must use http or https');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('localhost URLs are not allowed');
  }
  const addresses =
    net.isIP(hostname) !== 0
      ? [{ address: hostname }]
      : await dns.lookup(hostname, { all: true, verbatim: true }).catch((error) => {
          throw new Error(`failed to resolve URL hostname: ${error instanceof Error ? error.message : String(error)}`);
        });

  for (const { address } of addresses) {
    if (isBlockedNetworkAddress(address)) {
      throw new Error(`URL resolves to a blocked network address: ${address}`);
    }
  }
}

export function isBlockedNetworkAddress(address: string): boolean {
  const ipv4Mapped = address.match(/^::ffff:(.+)$/i);
  if (ipv4Mapped?.[1]) {
    const mappedAddress = ipv4Mapped[1];
    if (net.isIPv4(mappedAddress)) return isBlockedNetworkAddress(mappedAddress);
    const hextets = mappedAddress.split(':');
    if (hextets.length === 2) {
      const high = Number.parseInt(hextets[0], 16);
      const low = Number.parseInt(hextets[1], 16);
      if (Number.isFinite(high) && Number.isFinite(low)) {
        return isBlockedNetworkAddress(`${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`);
      }
    }
    return true;
  }

  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map((part) => Number(part));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (!net.isIPv6(address)) return true;
  const normalized = address.toLowerCase();
  const firstHextet = Number.parseInt(normalized.split(':', 1)[0] || '0', 16);
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) ||
    normalized.startsWith('ff')
  );
}
