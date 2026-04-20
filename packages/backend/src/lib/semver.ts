/**
 * Minimal semver comparison — no npm dependency needed.
 * Handles versions like "1.2.3", "v1.2.3".
 */

export function parseSemver(version: string): [number, number, number] | null {
  const clean = version.replace(/^v/, '');
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

/** Returns 1 if a > b, -1 if a < b, 0 if equal. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}

/** Returns true if both versions share the same major and are fewer than 2 minors apart. */
export function isMinorCompatible(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return true; // unknown versions (dev) are compatible
  return pa[0] === pb[0] && Math.abs(pa[1] - pb[1]) < 2;
}
