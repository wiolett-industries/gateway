import { describe, expect, it } from 'vitest';
import { AppError } from '@/middleware/error-handler.js';
import { validateContainerRuntimeLimits } from './docker-runtime-limits.js';

describe('validateContainerRuntimeLimits', () => {
  const capacity = {
    cpuCores: 4,
    memoryBytes: 8 * 1024 * 1024 * 1024,
    swapBytes: 2 * 1024 * 1024 * 1024,
  };

  it('allows limits that fit within node capacity', () => {
    expect(() =>
      validateContainerRuntimeLimits(
        {
          nanoCPUs: 2 * 1e9,
          memoryLimit: 4 * 1024 * 1024 * 1024,
          memorySwap: 5 * 1024 * 1024 * 1024,
        },
        {},
        capacity
      )
    ).not.toThrow();
  });

  it('rejects CPU limits above node capacity', () => {
    expect(() =>
      validateContainerRuntimeLimits(
        {
          nanoCPUs: 5 * 1e9,
        },
        {},
        capacity
      )
    ).toThrowError(AppError);
  });

  it('rejects memory limits above node capacity', () => {
    expect(() =>
      validateContainerRuntimeLimits(
        {
          memoryLimit: 9 * 1024 * 1024 * 1024,
        },
        {},
        capacity
      )
    ).toThrowError(AppError);
  });

  it('rejects memory+swap above node memory plus swap', () => {
    expect(() =>
      validateContainerRuntimeLimits(
        {
          memoryLimit: 7 * 1024 * 1024 * 1024,
          memorySwap: 11 * 1024 * 1024 * 1024,
        },
        {},
        capacity
      )
    ).toThrowError(AppError);
  });

  it('rejects memory+swap lower than memory limit', () => {
    expect(() =>
      validateContainerRuntimeLimits(
        {
          memoryLimit: 2 * 1024 * 1024 * 1024,
          memorySwap: 1 * 1024 * 1024 * 1024,
        },
        {},
        capacity
      )
    ).toThrowError(AppError);
  });

  it('rejects swap when no memory limit is set', () => {
    expect(() =>
      validateContainerRuntimeLimits(
        {
          memorySwap: 512 * 1024 * 1024,
        },
        {},
        capacity
      )
    ).toThrowError(AppError);
  });

  it('uses current runtime values when only part of the config changes', () => {
    expect(() =>
      validateContainerRuntimeLimits(
        {
          memorySwap: 9 * 1024 * 1024 * 1024,
        },
        {
          memoryLimit: 8 * 1024 * 1024 * 1024,
        },
        capacity
      )
    ).not.toThrow();
  });

  it('does not validate stale swap state during CPU-only updates', () => {
    expect(() =>
      validateContainerRuntimeLimits(
        {
          nanoCPUs: 2 * 1e9,
        },
        {
          memorySwap: -1,
        },
        capacity
      )
    ).not.toThrow();
  });

  it('uses current CPU quota/period when NanoCPUs is not populated', () => {
    expect(() =>
      validateContainerRuntimeLimits(
        {
          memoryLimit: 2 * 1024 * 1024 * 1024,
        },
        {
          cpuQuota: 150000,
          cpuPeriod: 100000,
        },
        capacity
      )
    ).not.toThrow();
  });
});
