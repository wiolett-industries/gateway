export const HEALTH_HISTORY_BUCKET_MS = 5 * 60 * 1000;
export const HEALTH_HISTORY_RECENT_WINDOW_MS = 5 * 60 * 1000;
export const HEALTH_HISTORY_RECENT_BUCKET_MS = 1000;
export const HEALTH_HISTORY_MAX_BUCKETS = 192;

export interface HealthHistoryEntry {
  ts: string;
  status: string;
  responseMs?: number;
  slow?: boolean;
}

interface ParsedHealthHistoryEntry<T extends HealthHistoryEntry> {
  entry: T;
  time: number;
}

function severity(entry: HealthHistoryEntry): number {
  if (entry.status === 'offline' || entry.status === 'outage' || entry.status === 'error') return 3;
  if (entry.status === 'degraded' || entry.status === 'recovering' || entry.slow) return 2;
  if (entry.status === 'unknown' || entry.status === 'disabled' || entry.status === 'pending') return 1;
  return 0;
}

function mergeBucket<T extends HealthHistoryEntry>(entries: ParsedHealthHistoryEntry<T>[]): T {
  const sorted = [...entries].sort((a, b) => a.time - b.time);
  const worst = sorted.reduce((selected, candidate) =>
    severity(candidate.entry) > severity(selected.entry) ? candidate : selected
  );
  const latest = sorted[sorted.length - 1]!;
  const maxResponseMs = sorted.reduce<number | undefined>((max, item) => {
    if (item.entry.responseMs == null) return max;
    return max == null ? item.entry.responseMs : Math.max(max, item.entry.responseMs);
  }, undefined);
  const hasSlow = sorted.some((item) => item.entry.slow);

  return {
    ...latest.entry,
    status: worst.entry.status,
    ...(maxResponseMs == null ? {} : { responseMs: maxResponseMs }),
    ...(hasSlow || severity(worst.entry) === 2 ? { slow: true } : {}),
  };
}

export function compactHealthHistory<T extends HealthHistoryEntry>(
  history: T[],
  options: {
    nowMs?: number;
    bucketMs?: number;
    recentWindowMs?: number;
    recentBucketMs?: number;
    maxBuckets?: number;
  } = {}
): T[] {
  const nowMs = options.nowMs ?? Date.now();
  const bucketMs = options.bucketMs ?? HEALTH_HISTORY_BUCKET_MS;
  const recentWindowMs = options.recentWindowMs ?? HEALTH_HISTORY_RECENT_WINDOW_MS;
  const recentBucketMs = options.recentBucketMs ?? HEALTH_HISTORY_RECENT_BUCKET_MS;
  const maxBuckets = options.maxBuckets ?? HEALTH_HISTORY_MAX_BUCKETS;
  const recentStart = nowMs - recentWindowMs;

  const parsed = history
    .map((entry) => ({ entry, time: new Date(entry.ts).getTime() }))
    .filter((item): item is ParsedHealthHistoryEntry<T> => Number.isFinite(item.time) && item.time <= nowMs)
    .sort((a, b) => a.time - b.time);

  const recent = parsed.filter((item) => item.time >= recentStart);
  const older = parsed.filter((item) => item.time < recentStart);
  const buckets = new Map<number, ParsedHealthHistoryEntry<T>[]>();
  const recentBuckets = new Map<number, ParsedHealthHistoryEntry<T>[]>();

  for (const item of older) {
    const bucket = Math.floor(item.time / bucketMs);
    const entries = buckets.get(bucket);
    if (entries) {
      entries.push(item);
    } else {
      buckets.set(bucket, [item]);
    }
  }

  for (const item of recent) {
    const bucket = Math.floor(item.time / recentBucketMs);
    const entries = recentBuckets.get(bucket);
    if (entries) {
      entries.push(item);
    } else {
      recentBuckets.set(bucket, [item]);
    }
  }

  const compactedOlder = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .slice(-maxBuckets)
    .map(([, entries]) => mergeBucket(entries));

  return [...compactedOlder, ...Array.from(recentBuckets.values()).map((entries) => mergeBucket(entries))].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );
}
