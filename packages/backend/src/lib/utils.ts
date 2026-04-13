import { and, type SQL } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export function generateId(length = 21): string {
  return nanoid(length);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function removeUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([_, value]) => value !== undefined)) as Partial<T>;
}

/** Combine an array of optional SQL conditions into a single AND clause. */
export function buildWhere(conditions: (SQL | undefined)[]): SQL | undefined {
  const active = conditions.filter(Boolean) as SQL[];
  return active.length > 0 ? and(...active) : undefined;
}

export function escapeLike(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function sanitizeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function isPrivateUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (!['http:', 'https:'].includes(url.protocol)) return true;
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host === '::1' || host === '::' || host === '0.0.0.0') return true;
    if (/^0x/i.test(host) || /^0\d/.test(host)) return true; // octal/hex IPv4 literals
    if (host.startsWith('127.')) return true;
    if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.')) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    if (host.startsWith('100.') && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return true;
    if (host.includes('::ffff:')) return true;
    if (host.startsWith('fd') || host.startsWith('fc')) return true;
    if (host.startsWith('fe80')) return true;
    if (/^\d+$/.test(host)) return true;
    if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return true;
    return false;
  } catch {
    return true;
  }
}
