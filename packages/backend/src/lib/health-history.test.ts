import { describe, expect, it } from 'vitest';
import {
  compactHealthHistory,
  HEALTH_HISTORY_BUCKET_MS,
  HEALTH_HISTORY_MAX_BUCKETS,
  HEALTH_HISTORY_RECENT_WINDOW_MS,
} from './health-history.js';

describe('compactHealthHistory', () => {
  it('keeps recent samples and compacts older samples into severity-preserving buckets', () => {
    const nowMs = Date.parse('2026-04-29T12:00:00.000Z');
    const entries = [
      { ts: new Date(nowMs - 36 * 60 * 1000).toISOString(), status: 'online', responseMs: 20 },
      { ts: new Date(nowMs - 29 * 60 * 1000).toISOString(), status: 'offline', responseMs: 5 },
      { ts: new Date(nowMs - 29 * 60 * 1000 + 30_000).toISOString(), status: 'online', responseMs: 10 },
      { ts: new Date(nowMs - 60_000).toISOString(), status: 'online', responseMs: 15 },
    ];

    const compacted = compactHealthHistory(entries, { nowMs });

    expect(compacted).toHaveLength(3);
    expect(compacted[0]).toMatchObject({ status: 'online', responseMs: 20 });
    expect(compacted[1]).toMatchObject({ status: 'offline', responseMs: 10 });
    expect(compacted[2]).toMatchObject({ status: 'online', responseMs: 15 });
  });

  it('keeps only the latest compacted older buckets', () => {
    const nowMs = Date.parse('2026-04-29T12:00:00.000Z');
    const oldestTs = new Date(nowMs - 10 * HEALTH_HISTORY_BUCKET_MS).toISOString();
    const middleTs = new Date(nowMs - 9 * HEALTH_HISTORY_BUCKET_MS).toISOString();
    const retainedTs = new Date(nowMs - 8 * HEALTH_HISTORY_BUCKET_MS).toISOString();

    expect(
      compactHealthHistory(
        [
          { ts: oldestTs, status: 'offline' },
          { ts: middleTs, status: 'degraded' },
          { ts: retainedTs, status: 'online' },
        ],
        { nowMs, maxBuckets: 2 }
      )
    ).toEqual([
      { ts: middleTs, status: 'degraded', slow: true },
      { ts: retainedTs, status: 'online' },
    ]);
  });

  it('keeps at most one recent sample per second', () => {
    const nowMs = Date.parse('2026-04-29T12:00:00.000Z');
    const recentMs = nowMs - HEALTH_HISTORY_RECENT_WINDOW_MS + 10_000;

    const compacted = compactHealthHistory(
      [
        { ts: new Date(recentMs).toISOString(), status: 'online' },
        { ts: new Date(recentMs + 200).toISOString(), status: 'degraded' },
        { ts: new Date(recentMs + 800).toISOString(), status: 'online' },
      ],
      { nowMs }
    );

    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toMatchObject({ status: 'degraded', slow: true });
  });

  it('keeps dense sixteen-hour history as full five-minute buckets', () => {
    const nowMs = Date.parse('2026-04-29T12:00:00.000Z');
    const entries = Array.from({ length: 16 * 60 * 2 }, (_, index) => ({
      ts: new Date(nowMs - (index + 1) * 30_000).toISOString(),
      status: 'online',
    })).reverse();

    const compacted = compactHealthHistory(entries, { nowMs });

    expect(compacted.length).toBeGreaterThanOrEqual(190);
    expect(compacted.length).toBeLessThanOrEqual(HEALTH_HISTORY_MAX_BUCKETS + 300);
  });
});
