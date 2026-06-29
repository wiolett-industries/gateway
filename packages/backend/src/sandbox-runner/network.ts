import { Buffer } from 'node:buffer';
import dns from 'node:dns/promises';
import type { IncomingMessage, RequestOptions } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const MAX_REDIRECTS = 5;

type ResolvedFetchTarget = {
  url: URL;
  address: string;
  family: 4 | 6;
};

type NetworkResponse = {
  status: number;
  statusText: string;
  headers: Headers;
  body: AsyncIterable<Buffer>;
  close: () => void;
};

type NetworkTransport = (target: ResolvedFetchTarget, signal: AbortSignal) => Promise<NetworkResponse>;

let networkTransport: NetworkTransport = requestResolvedUrl;

export function setSandboxNetworkTransportForTests(transport: NetworkTransport | null): void {
  networkTransport = transport ?? requestResolvedUrl;
}

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
      const target = await resolveFetchUrl(currentUrl);
      const response = await networkTransport(target, controller.signal);
      if (isRedirectStatus(response.status)) {
        if (redirects >= MAX_REDIRECTS) throw new Error(`too many redirects (max ${MAX_REDIRECTS})`);
        const location = response.headers.get('location');
        if (!location) throw new Error(`redirect response missing location header (${response.status})`);
        response.close();
        currentUrl = new URL(location, target.url).toString();
        redirects += 1;
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        response.close();
        throw new Error(`fetch failed (${response.status} ${response.statusText})`);
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength && Number(contentLength) > limitBytes) {
        response.close();
        throw new Error(`download exceeds ${limitBytes} byte limit`);
      }

      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of response.body) {
        total += chunk.byteLength;
        if (total > limitBytes) {
          response.close();
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
  await resolveFetchUrl(rawUrl);
}

async function resolveFetchUrl(rawUrl: string): Promise<ResolvedFetchTarget> {
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
  const addresses: Array<{ address: string; family?: number }> =
    net.isIP(hostname) !== 0
      ? [{ address: hostname, family: net.isIPv4(hostname) ? 4 : 6 }]
      : await dns.lookup(hostname, { all: true, verbatim: true }).catch((error) => {
          throw new Error(`failed to resolve URL hostname: ${error instanceof Error ? error.message : String(error)}`);
        });

  for (const { address } of addresses) {
    if (isBlockedNetworkAddress(address)) {
      throw new Error(`URL resolves to a blocked network address: ${address}`);
    }
  }
  const first = addresses[0];
  if (!first) throw new Error('failed to resolve URL hostname: no addresses returned');
  return {
    url: parsed,
    address: first.address,
    family: first.family === 6 || net.isIPv6(first.address) ? 6 : 4,
  };
}

async function requestResolvedUrl(target: ResolvedFetchTarget, signal: AbortSignal): Promise<NetworkResponse> {
  const client = target.url.protocol === 'https:' ? https : http;
  const options: RequestOptions & { servername?: string } = {
    protocol: target.url.protocol,
    hostname: target.url.hostname,
    port: target.url.port || (target.url.protocol === 'https:' ? 443 : 80),
    path: `${target.url.pathname}${target.url.search}`,
    method: 'GET',
    headers: { host: target.url.host },
    family: target.family,
    lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
    servername:
      target.url.protocol === 'https:' && net.isIP(target.url.hostname) === 0 ? target.url.hostname : undefined,
  };

  return new Promise((resolve, reject) => {
    const request = client.request(options, (response) => resolve(toNetworkResponse(response)));
    const onAbort = () => request.destroy(new Error('fetch aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    request.once('error', (error) => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
    request.once('close', () => signal.removeEventListener('abort', onAbort));
    request.end();
  });
}

function toNetworkResponse(response: IncomingMessage): NetworkResponse {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, String(value));
    }
  }
  return {
    status: response.statusCode ?? 0,
    statusText: response.statusMessage ?? '',
    headers,
    body: response,
    close: () => response.destroy(),
  };
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
