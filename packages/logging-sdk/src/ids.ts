import { randomUUID } from 'node:crypto';

export function createTraceId(): string {
  return randomUUID();
}

export function createSpanId(): string {
  return randomUUID();
}
