import { describe, expect, it } from 'vitest';
import { ALERT_CATEGORIES, evaluateWindowRatio, eventSupportsThreshold } from './notification.constants.js';

describe('evaluateWindowRatio', () => {
  it('requires full window coverage before threshold can pass', () => {
    const now = 1_000_000;
    const result = evaluateWindowRatio(
      [
        { timestamp: now - 40_000, breached: true },
        { timestamp: now - 20_000, breached: true },
        { timestamp: now, breached: true },
      ],
      'breach',
      100,
      60_000,
      now
    );

    expect(result.hasCoverage).toBe(false);
    expect(result.thresholdMet).toBe(false);
  });

  it('fires only when breach ratio meets the configured threshold', () => {
    const now = 1_000_000;
    const result = evaluateWindowRatio(
      [
        { timestamp: now - 60_000, breached: true },
        { timestamp: now - 40_000, breached: true },
        { timestamp: now - 20_000, breached: false },
        { timestamp: now, breached: true },
      ],
      'breach',
      75,
      60_000,
      now
    );

    expect(result.hasCoverage).toBe(true);
    expect(result.sampleCount).toBe(4);
    expect(result.matchingSamples).toBe(3);
    expect(result.ratioPercent).toBe(75);
    expect(result.thresholdMet).toBe(true);
  });

  it('does not fire when breach ratio is below threshold', () => {
    const now = 1_000_000;
    const result = evaluateWindowRatio(
      [
        { timestamp: now - 60_000, breached: true },
        { timestamp: now - 40_000, breached: false },
        { timestamp: now - 20_000, breached: false },
        { timestamp: now, breached: true },
      ],
      'breach',
      75,
      60_000,
      now
    );

    expect(result.hasCoverage).toBe(true);
    expect(result.ratioPercent).toBe(50);
    expect(result.thresholdMet).toBe(false);
  });

  it('evaluates clear ratio symmetrically for resolve windows', () => {
    const now = 1_000_000;
    const result = evaluateWindowRatio(
      [
        { timestamp: now - 60_000, breached: false },
        { timestamp: now - 40_000, breached: false },
        { timestamp: now - 20_000, breached: true },
        { timestamp: now, breached: false },
      ],
      'clear',
      75,
      60_000,
      now
    );

    expect(result.hasCoverage).toBe(true);
    expect(result.matchingSamples).toBe(3);
    expect(result.ratioPercent).toBe(75);
    expect(result.thresholdMet).toBe(true);
  });

  it('marks only stateful events as threshold-capable', () => {
    expect(eventSupportsThreshold('node', 'offline')).toBe(true);
    expect(eventSupportsThreshold('proxy', 'health.degraded')).toBe(true);
    expect(eventSupportsThreshold('database_postgres', 'health.online')).toBe(true);
    expect(eventSupportsThreshold('container', 'started')).toBe(false);
    expect(eventSupportsThreshold('certificate', 'issued')).toBe(false);
  });

  it('defines certificate days-until-expiry as an immediate threshold metric', () => {
    const certificateCategory = ALERT_CATEGORIES.find((category) => category.id === 'certificate');
    const metric = certificateCategory?.metrics.find((m) => m.id === 'days_until_expiry');

    expect(metric).toMatchObject({
      label: 'Days Until Expiry',
      unit: 'days',
      defaultOperator: '<=',
      defaultValue: 14,
      defaultDurationSeconds: 0,
      defaultResolveAfterSeconds: 0,
    });
  });
});
