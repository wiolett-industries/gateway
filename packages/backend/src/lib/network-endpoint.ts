import { isIP } from 'node:net';

export function formatHostPort(host: string, port: number): string {
  return `${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}

export function isValidUpstreamHost(host: string): boolean {
  return isIP(host) !== 0 || /^[a-zA-Z0-9._-]+$/.test(host);
}
