# Logging SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` by default, or `subagent-driven-development` when the `multi-agent-workflows` plugin is installed and you want same-session multi-agent execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-party TypeScript SDK package for external services to send structured logs into Gateway with contextual child loggers, trace/span helpers, automatic debounced batching, retries, and rate-limit handling.

**Architecture:** Create a new `packages/logging-sdk` workspace package that is Node-first and ingest-only. The public logger API builds immutable context layers for service/source/labels/fields and passes normalized events into an internal in-memory delivery queue. A background flusher sends batches to Gateway, retries transient failures with capped backoff, pauses on `429` rate-limit responses, and exposes `flush()`/`close()` for lifecycle control.

**Tech Stack:** TypeScript, Node 24 global `fetch`, Vitest, pnpm workspace, Nx project targets, Gateway logging ingest HTTP API.

---

## Decisions

- Package name: `@wiolett/gateway-logger`.
- Scope: ingest SDK only. Do not include environment, schema, token, search, or metadata management in this package.
- Runtime target: Node/server first. Do not add browser-specific APIs or browser token guidance in this implementation.
- Delivery default: automatic batching with debounce. Do not send a request per log event.
- Queue overflow default: drop oldest queued logs and call `onDrop`.
- Merge precedence: root context -> child context -> trace/span context -> per-event context.
- Retry policy: retry network failures, `408`, `425`, `429`, and `5xx`; do not retry `400`, `401`, `403`, or validation responses.
- Rate-limit handling: use `Retry-After` response header first, then `details.retryAfterSeconds`, then retry backoff.
- Lifecycle: `flush()` sends queued events now; `close()` flushes, stops timers, and prevents further logging.

## File Structure

- Create `packages/logging-sdk/package.json`
  - Workspace package metadata and scripts.
- Create `packages/logging-sdk/project.json`
  - Nx targets for build, test, lint, and typecheck.
- Create `packages/logging-sdk/tsconfig.json`
  - SDK TypeScript build settings with declaration output.
- Create `packages/logging-sdk/vitest.config.ts`
  - Node Vitest config.
- Create `packages/logging-sdk/biome.json`
  - Local lint config matching backend/frontend style.
- Create `packages/logging-sdk/src/index.ts`
  - Public exports.
- Create `packages/logging-sdk/src/types.ts`
  - Public API types and internal normalized types.
- Create `packages/logging-sdk/src/context.ts`
  - Context normalization and merge helpers.
- Create `packages/logging-sdk/src/ids.ts`
  - Trace/span/event id generation helpers.
- Create `packages/logging-sdk/src/transport.ts`
  - HTTP ingest transport and response classification.
- Create `packages/logging-sdk/src/retry.ts`
  - Backoff, jitter, and rate-limit delay helpers.
- Create `packages/logging-sdk/src/queue.ts`
  - In-memory queue, debounce scheduling, flushing, retry loop, close behavior.
- Create `packages/logging-sdk/src/logger.ts`
  - `GatewayLogger`, child loggers, severity methods, `createTrace`, `withContext`, shutdown hooks.
- Create `packages/logging-sdk/src/trace.ts`
  - Trace/span logger wrappers.
- Create tests under `packages/logging-sdk/src/*.test.ts`
  - Focused unit tests for each behavior.
- Modify root `package.json`
  - Add `dev:logging-sdk`, `build:logging-sdk`, and optionally include SDK in root `build`.
- Modify `README.md`
  - Add SDK install/import and usage examples.

## Task 1: Package Scaffolding

**Files:**
- Create: `packages/logging-sdk/package.json`
- Create: `packages/logging-sdk/project.json`
- Create: `packages/logging-sdk/tsconfig.json`
- Create: `packages/logging-sdk/vitest.config.ts`
- Create: `packages/logging-sdk/biome.json`
- Create: `packages/logging-sdk/src/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Create package metadata**

Create `packages/logging-sdk/package.json`:

```json
{
  "name": "@wiolett/gateway-logger",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.9",
    "@types/node": "^22.10.5",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Add Nx project config**

Create `packages/logging-sdk/project.json`:

```json
{
  "name": "logging-sdk",
  "root": "packages/logging-sdk",
  "sourceRoot": "packages/logging-sdk/src",
  "targets": {
    "build": {
      "command": "pnpm --filter @wiolett/gateway-logger build",
      "inputs": ["{projectRoot}/src/**/*", "{projectRoot}/tsconfig.json", "{projectRoot}/package.json"],
      "outputs": ["{projectRoot}/dist"],
      "cache": true
    },
    "test": {
      "command": "pnpm --filter @wiolett/gateway-logger test",
      "inputs": ["{projectRoot}/src/**/*", "{projectRoot}/vitest.config.*", "{projectRoot}/package.json"],
      "cache": true
    },
    "lint": {
      "command": "pnpm --filter @wiolett/gateway-logger lint",
      "inputs": [
        "{projectRoot}/src/**/*",
        "{projectRoot}/biome.json",
        "{projectRoot}/package.json",
        "{projectRoot}/vitest.config.*"
      ],
      "cache": true
    },
    "typecheck": {
      "command": "pnpm --filter @wiolett/gateway-logger typecheck",
      "inputs": ["{projectRoot}/src/**/*", "{projectRoot}/tsconfig.json"],
      "cache": true
    }
  }
}
```

- [ ] **Step 3: Add TypeScript config**

Create `packages/logging-sdk/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "types": ["node", "vitest/globals"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noEmit": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 4: Add test and lint config**

Create `packages/logging-sdk/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

Create `packages/logging-sdk/biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.9/schema.json",
  "extends": ["../backend/biome.json"]
}
```

- [ ] **Step 5: Add initial export**

Create `packages/logging-sdk/src/index.ts`:

```ts
export type {
  GatewayLogContext,
  GatewayLogEvent,
  GatewayLoggerOptions,
  GatewayLogSeverity,
  GatewayLogger,
  GatewayTraceLogger,
  GatewaySpanLogger,
} from './types.js';

export { createGatewayLogger } from './logger.js';
```

- [ ] **Step 6: Wire root scripts**

Modify root `package.json` scripts:

```json
{
  "build": "nx run-many -t build -p backend frontend status-page logging-sdk",
  "build:logging-sdk": "nx run logging-sdk:build",
  "test:logging-sdk": "nx run logging-sdk:test",
  "typecheck:logging-sdk": "nx run logging-sdk:typecheck"
}
```

- [ ] **Step 7: Verify package discovery**

Run:

```bash
pnpm --filter @wiolett/gateway-logger typecheck
```

Expected: typecheck reaches TypeScript and fails only if later files are missing during incremental execution. After this task is complete with placeholder exports adjusted by Task 2, it must pass.

## Task 2: Public Types And Context Merging

**Files:**
- Create: `packages/logging-sdk/src/types.ts`
- Create: `packages/logging-sdk/src/context.ts`
- Test: `packages/logging-sdk/src/context.test.ts`
- Modify: `packages/logging-sdk/src/index.ts`

- [ ] **Step 1: Define SDK types**

Create `packages/logging-sdk/src/types.ts`:

```ts
export type GatewayLogSeverity = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type GatewayLogValue = string | number | boolean | Date | null | Record<string, unknown> | unknown[];

export interface GatewayLogContext {
  service?: string;
  source?: string;
  traceId?: string;
  spanId?: string;
  requestId?: string;
  labels?: Record<string, string | number | boolean | null | undefined>;
  fields?: Record<string, GatewayLogValue | undefined>;
}

export interface GatewayLogEvent extends GatewayLogContext {
  timestamp?: string | Date;
  severity: GatewayLogSeverity;
  message: string;
}

export interface GatewayLogOptions extends GatewayLogContext {
  timestamp?: string | Date;
}

export interface GatewayBatchingOptions {
  enabled?: boolean;
  maxBatchSize?: number;
  flushIntervalMs?: number;
  flushDebounceMs?: number;
  maxQueueSize?: number;
  overflow?: 'drop-oldest' | 'drop-newest';
}

export interface GatewayRetryOptions {
  maxAttempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
}

export interface GatewayLoggerOptions extends GatewayLogContext {
  endpoint: string;
  token: string;
  batching?: GatewayBatchingOptions;
  retry?: GatewayRetryOptions;
  fetch?: typeof fetch;
  onError?: (error: unknown) => void;
  onDrop?: (event: GatewayLogEvent, reason: GatewayLogDropReason) => void;
}

export type GatewayLogDropReason =
  | 'queue_full'
  | 'closed'
  | 'invalid_event'
  | 'permanent_failure'
  | 'retry_exhausted';

export interface GatewayLogger {
  trace(message: string, options?: GatewayLogOptions): void;
  debug(message: string, options?: GatewayLogOptions): void;
  info(message: string, options?: GatewayLogOptions): void;
  warn(message: string, options?: GatewayLogOptions): void;
  error(message: string, options?: GatewayLogOptions): void;
  fatal(message: string, options?: GatewayLogOptions): void;
  log(event: GatewayLogEvent): void;
  child(context: GatewayLogContext): GatewayLogger;
  createTrace(context?: GatewayTraceContext): GatewayTraceLogger;
  withContext<T>(context: GatewayLogContext, fn: (logger: GatewayLogger) => T | Promise<T>): Promise<T>;
  flush(): Promise<void>;
  close(): Promise<void>;
  installShutdownHooks(): () => void;
}

export interface GatewayTraceContext extends GatewayLogContext {
  name?: string;
  traceId?: string;
}

export interface GatewaySpanContext extends GatewayLogContext {
  name?: string;
  spanId?: string;
}

export interface GatewayTraceLogger extends GatewayLogger {
  readonly traceId: string;
  createSpan(context?: GatewaySpanContext | string): GatewaySpanLogger;
  end(message?: string, options?: GatewayLogOptions): Promise<void>;
}

export interface GatewaySpanLogger extends GatewayLogger {
  readonly traceId: string;
  readonly spanId: string;
  end(message?: string, options?: GatewayLogOptions): Promise<void>;
}

export interface NormalizedGatewayLogEvent {
  timestamp?: string;
  severity: GatewayLogSeverity;
  message: string;
  service?: string;
  source?: string;
  traceId?: string;
  spanId?: string;
  requestId?: string;
  labels?: Record<string, string>;
  fields?: Record<string, unknown>;
}
```

- [ ] **Step 2: Write context merge tests**

Create `packages/logging-sdk/src/context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mergeContext, normalizeEvent } from './context.js';

describe('logging sdk context', () => {
  it('merges root, child, and event context with event values taking precedence', () => {
    const merged = mergeContext(
      {
        service: 'api',
        source: 'main',
        labels: { region: 'eu', app: 'billing' },
        fields: { version: '2.4.1', provider: 'root' },
      },
      {
        service: 'billing-api',
        labels: { module: 'payments' },
        fields: { provider: 'stripe' },
      },
      {
        labels: { region: 'us' },
        fields: { statusCode: 502 },
      }
    );

    expect(merged).toEqual({
      service: 'billing-api',
      source: 'main',
      labels: { region: 'us', app: 'billing', module: 'payments' },
      fields: { version: '2.4.1', provider: 'stripe', statusCode: 502 },
    });
  });

  it('normalizes labels to strings and dates to ISO strings', () => {
    const normalized = normalizeEvent({
      severity: 'info',
      message: 'hello',
      timestamp: new Date('2026-04-28T12:00:00.000Z'),
      labels: { ok: true, count: 3, skip: undefined },
      fields: { at: new Date('2026-04-28T12:01:00.000Z') },
    });

    expect(normalized).toEqual({
      severity: 'info',
      message: 'hello',
      timestamp: '2026-04-28T12:00:00.000Z',
      labels: { ok: 'true', count: '3' },
      fields: { at: '2026-04-28T12:01:00.000Z' },
    });
  });
});
```

- [ ] **Step 3: Implement context helpers**

Create `packages/logging-sdk/src/context.ts`:

```ts
import type { GatewayLogContext, GatewayLogEvent, NormalizedGatewayLogEvent } from './types.js';

export function mergeContext(...contexts: Array<GatewayLogContext | undefined>): GatewayLogContext {
  const merged: GatewayLogContext = {};

  for (const context of contexts) {
    if (!context) continue;
    if (context.service !== undefined) merged.service = context.service;
    if (context.source !== undefined) merged.source = context.source;
    if (context.traceId !== undefined) merged.traceId = context.traceId;
    if (context.spanId !== undefined) merged.spanId = context.spanId;
    if (context.requestId !== undefined) merged.requestId = context.requestId;
    if (context.labels) {
      merged.labels = { ...(merged.labels ?? {}), ...context.labels };
    }
    if (context.fields) {
      merged.fields = { ...(merged.fields ?? {}), ...context.fields };
    }
  }

  return merged;
}

export function normalizeEvent(event: GatewayLogEvent): NormalizedGatewayLogEvent {
  const normalized: NormalizedGatewayLogEvent = {
    severity: event.severity,
    message: event.message,
  };

  if (event.timestamp) normalized.timestamp = normalizeTimestamp(event.timestamp);
  if (event.service) normalized.service = event.service;
  if (event.source) normalized.source = event.source;
  if (event.traceId) normalized.traceId = event.traceId;
  if (event.spanId) normalized.spanId = event.spanId;
  if (event.requestId) normalized.requestId = event.requestId;

  const labels = normalizeLabels(event.labels);
  if (labels) normalized.labels = labels;

  const fields = normalizeFields(event.fields);
  if (fields) normalized.fields = fields;

  return normalized;
}

function normalizeTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeLabels(labels: GatewayLogContext['labels']): Record<string, string> | undefined {
  if (!labels) return undefined;
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value === undefined || value === null) continue;
    normalized[key] = String(value);
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeFields(fields: GatewayLogContext['fields']): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    normalized[key] = value instanceof Date ? value.toISOString() : value;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}
```

- [ ] **Step 4: Verify context tests**

Run:

```bash
pnpm --filter @wiolett/gateway-logger test -- context
```

Expected: PASS.

## Task 3: Transport, Retry, And Rate-Limit Classification

**Files:**
- Create: `packages/logging-sdk/src/transport.ts`
- Create: `packages/logging-sdk/src/retry.ts`
- Test: `packages/logging-sdk/src/transport.test.ts`
- Test: `packages/logging-sdk/src/retry.test.ts`

- [ ] **Step 1: Write transport tests**

Create `packages/logging-sdk/src/transport.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createGatewayTransport } from './transport.js';

describe('gateway transport', () => {
  it('posts single events to /api/logging/ingest and batches to /api/logging/ingest/batch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: 1, rejected: 0, errors: [] }), { status: 200 }));
    const transport = createGatewayTransport({
      endpoint: 'https://gateway.example.com',
      token: 'gwl_test',
      fetch: fetchMock,
    });

    await transport.send([{ severity: 'info', message: 'one' }]);
    await transport.send([
      { severity: 'info', message: 'one' },
      { severity: 'warn', message: 'two' },
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://gateway.example.com/api/logging/ingest',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://gateway.example.com/api/logging/ingest/batch',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('classifies 429 with retry-after as retryable rate limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'LOGGING_RATE_LIMIT_EXCEEDED', details: { retryAfterSeconds: 9 } }), {
        status: 429,
        headers: { 'Retry-After': '7' },
      })
    );
    const transport = createGatewayTransport({
      endpoint: 'https://gateway.example.com/',
      token: 'gwl_test',
      fetch: fetchMock,
    });

    const result = await transport.send([{ severity: 'info', message: 'one' }]);

    expect(result).toEqual({ ok: false, retryable: true, rateLimited: true, retryAfterMs: 7000, status: 429 });
  });

  it('classifies validation failures as permanent failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'INVALID_BODY' }), { status: 400 }));
    const transport = createGatewayTransport({
      endpoint: 'https://gateway.example.com',
      token: 'gwl_test',
      fetch: fetchMock,
    });

    const result = await transport.send([{ severity: 'info', message: 'one' }]);

    expect(result).toMatchObject({ ok: false, retryable: false, status: 400 });
  });
});
```

- [ ] **Step 2: Implement transport**

Create `packages/logging-sdk/src/transport.ts`:

```ts
import type { NormalizedGatewayLogEvent } from './types.js';

export interface GatewayTransportOptions {
  endpoint: string;
  token: string;
  fetch?: typeof fetch;
}

export type GatewayTransportResult =
  | { ok: true; accepted: number; rejected: number }
  | {
      ok: false;
      retryable: boolean;
      rateLimited: boolean;
      retryAfterMs?: number;
      status?: number;
      error?: unknown;
    };

export interface GatewayTransport {
  send(events: NormalizedGatewayLogEvent[]): Promise<GatewayTransportResult>;
}

export function createGatewayTransport(options: GatewayTransportOptions): GatewayTransport {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint.replace(/\/+$/, '');

  return {
    async send(events) {
      if (events.length === 0) return { ok: true, accepted: 0, rejected: 0 };

      const path = events.length === 1 ? '/api/logging/ingest' : '/api/logging/ingest/batch';
      const body = events.length === 1 ? events[0] : { logs: events };

      try {
        const response = await fetchImpl(`${endpoint}${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        const payload = await readJson(response);
        if (response.ok) {
          return {
            ok: true,
            accepted: typeof payload?.accepted === 'number' ? payload.accepted : events.length,
            rejected: typeof payload?.rejected === 'number' ? payload.rejected : 0,
          };
        }

        return {
          ok: false,
          retryable: isRetryableStatus(response.status),
          rateLimited: response.status === 429,
          retryAfterMs: getRetryAfterMs(response, payload),
          status: response.status,
          error: payload,
        };
      } catch (error) {
        return { ok: false, retryable: true, rateLimited: false, error };
      }
    },
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function getRetryAfterMs(response: Response, payload: any): number | undefined {
  const header = response.headers.get('Retry-After');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  }

  const retryAfterSeconds = payload?.details?.retryAfterSeconds;
  if (typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return retryAfterSeconds * 1000;
  }

  return undefined;
}
```

- [ ] **Step 3: Write retry tests**

Create `packages/logging-sdk/src/retry.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { calculateRetryDelayMs, sleep } from './retry.js';

describe('retry helpers', () => {
  it('uses exponential backoff capped by max delay', () => {
    expect(calculateRetryDelayMs({ attempt: 1, minDelayMs: 500, maxDelayMs: 30_000, jitter: false })).toBe(500);
    expect(calculateRetryDelayMs({ attempt: 3, minDelayMs: 500, maxDelayMs: 30_000, jitter: false })).toBe(2000);
    expect(calculateRetryDelayMs({ attempt: 10, minDelayMs: 500, maxDelayMs: 30_000, jitter: false })).toBe(30_000);
  });

  it('sleeps for the requested delay', async () => {
    vi.useFakeTimers();
    const promise = sleep(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 4: Implement retry helpers**

Create `packages/logging-sdk/src/retry.ts`:

```ts
export interface RetryDelayInput {
  attempt: number;
  minDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

export function calculateRetryDelayMs(input: RetryDelayInput): number {
  const exponent = Math.max(0, input.attempt - 1);
  const baseDelay = Math.min(input.maxDelayMs, input.minDelayMs * 2 ** exponent);
  if (!input.jitter) return baseDelay;
  return Math.floor(baseDelay * (0.5 + Math.random() * 0.5));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
```

- [ ] **Step 5: Verify transport and retry tests**

Run:

```bash
pnpm --filter @wiolett/gateway-logger test -- transport retry
```

Expected: PASS.

## Task 4: Queue, Debounced Auto-Flush, Retries, And Rate Limits

**Files:**
- Create: `packages/logging-sdk/src/queue.ts`
- Test: `packages/logging-sdk/src/queue.test.ts`

- [ ] **Step 1: Write queue behavior tests**

Create `packages/logging-sdk/src/queue.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { GatewayLogQueue } from './queue.js';
import type { GatewayTransport } from './transport.js';
import type { NormalizedGatewayLogEvent } from './types.js';

const event = (message: string): NormalizedGatewayLogEvent => ({ severity: 'info', message });

describe('gateway log queue', () => {
  it('debounces automatic sends instead of sending on every log', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue({ ok: true, accepted: 3, rejected: 0 });
    const queue = new GatewayLogQueue({
      transport: { send } as GatewayTransport,
      maxBatchSize: 100,
      flushIntervalMs: 60_000,
      flushDebounceMs: 250,
      maxQueueSize: 1000,
      overflow: 'drop-oldest',
      retry: { maxAttempts: 3, minDelayMs: 100, maxDelayMs: 1000, jitter: false },
    });

    queue.enqueue(event('one'));
    queue.enqueue(event('two'));
    queue.enqueue(event('three'));

    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(249);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith([event('one'), event('two'), event('three')]);

    vi.useRealTimers();
  });

  it('flushes immediately when max batch size is reached', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue({ ok: true, accepted: 2, rejected: 0 });
    const queue = new GatewayLogQueue({
      transport: { send } as GatewayTransport,
      maxBatchSize: 2,
      flushIntervalMs: 60_000,
      flushDebounceMs: 250,
      maxQueueSize: 1000,
      overflow: 'drop-oldest',
      retry: { maxAttempts: 3, minDelayMs: 100, maxDelayMs: 1000, jitter: false },
    });

    queue.enqueue(event('one'));
    queue.enqueue(event('two'));
    await vi.runOnlyPendingTimersAsync();

    expect(send).toHaveBeenCalledWith([event('one'), event('two')]);
    vi.useRealTimers();
  });

  it('backs off when rate limited and retries the same batch', async () => {
    vi.useFakeTimers();
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, retryable: true, rateLimited: true, retryAfterMs: 1000, status: 429 })
      .mockResolvedValueOnce({ ok: true, accepted: 1, rejected: 0 });
    const queue = new GatewayLogQueue({
      transport: { send } as GatewayTransport,
      maxBatchSize: 100,
      flushIntervalMs: 60_000,
      flushDebounceMs: 10,
      maxQueueSize: 1000,
      overflow: 'drop-oldest',
      retry: { maxAttempts: 3, minDelayMs: 100, maxDelayMs: 1000, jitter: false },
    });

    queue.enqueue(event('one'));
    await vi.advanceTimersByTimeAsync(10);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('drops oldest event when queue is full', () => {
    const onDrop = vi.fn();
    const queue = new GatewayLogQueue({
      transport: { send: vi.fn() } as unknown as GatewayTransport,
      maxBatchSize: 100,
      flushIntervalMs: 60_000,
      flushDebounceMs: 250,
      maxQueueSize: 2,
      overflow: 'drop-oldest',
      retry: { maxAttempts: 3, minDelayMs: 100, maxDelayMs: 1000, jitter: false },
      onDrop,
    });

    queue.enqueue(event('one'));
    queue.enqueue(event('two'));
    queue.enqueue(event('three'));

    expect(onDrop).toHaveBeenCalledWith(event('one'), 'queue_full');
  });
});
```

- [ ] **Step 2: Implement the queue**

Create `packages/logging-sdk/src/queue.ts`:

```ts
import { calculateRetryDelayMs, sleep } from './retry.js';
import type { GatewayTransport } from './transport.js';
import type { GatewayLogDropReason, GatewayRetryOptions, NormalizedGatewayLogEvent } from './types.js';

export interface GatewayLogQueueOptions {
  transport: GatewayTransport;
  maxBatchSize: number;
  flushIntervalMs: number;
  flushDebounceMs: number;
  maxQueueSize: number;
  overflow: 'drop-oldest' | 'drop-newest';
  retry: Required<GatewayRetryOptions>;
  onError?: (error: unknown) => void;
  onDrop?: (event: NormalizedGatewayLogEvent, reason: GatewayLogDropReason) => void;
}

export class GatewayLogQueue {
  private readonly events: NormalizedGatewayLogEvent[] = [];
  private debounceTimer: NodeJS.Timeout | undefined;
  private intervalTimer: NodeJS.Timeout | undefined;
  private flushInFlight: Promise<void> | undefined;
  private closed = false;

  constructor(private readonly options: GatewayLogQueueOptions) {
    this.intervalTimer = setInterval(() => {
      void this.flush();
    }, options.flushIntervalMs);
    this.intervalTimer.unref?.();
  }

  enqueue(event: NormalizedGatewayLogEvent): void {
    if (this.closed) {
      this.options.onDrop?.(event, 'closed');
      return;
    }

    if (this.events.length >= this.options.maxQueueSize) {
      if (this.options.overflow === 'drop-oldest') {
        const dropped = this.events.shift();
        if (dropped) this.options.onDrop?.(dropped, 'queue_full');
      } else {
        this.options.onDrop?.(event, 'queue_full');
        return;
      }
    }

    this.events.push(event);

    if (this.events.length >= this.options.maxBatchSize) {
      this.scheduleFlush(0);
      return;
    }

    this.scheduleFlush(this.options.flushDebounceMs);
  }

  async flush(): Promise<void> {
    if (this.flushInFlight) return this.flushInFlight;
    this.clearDebounceTimer();
    this.flushInFlight = this.flushLoop().finally(() => {
      this.flushInFlight = undefined;
    });
    return this.flushInFlight;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.clearDebounceTimer();
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    await this.flush();
  }

  private scheduleFlush(delayMs: number): void {
    this.clearDebounceTimer();
    this.debounceTimer = setTimeout(() => {
      void this.flush();
    }, delayMs);
    this.debounceTimer.unref?.();
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
  }

  private async flushLoop(): Promise<void> {
    while (this.events.length > 0) {
      const batch = this.events.splice(0, this.options.maxBatchSize);
      const sent = await this.sendWithRetry(batch);
      if (!sent) break;
    }
  }

  private async sendWithRetry(batch: NormalizedGatewayLogEvent[]): Promise<boolean> {
    for (let attempt = 1; attempt <= this.options.retry.maxAttempts; attempt += 1) {
      const result = await this.options.transport.send(batch);
      if (result.ok) return true;

      if (!result.retryable) {
        for (const event of batch) this.options.onDrop?.(event, 'permanent_failure');
        this.options.onError?.(result.error);
        return true;
      }

      if (attempt >= this.options.retry.maxAttempts) {
        for (const event of batch) this.options.onDrop?.(event, 'retry_exhausted');
        this.options.onError?.(result.error);
        return true;
      }

      const delayMs =
        result.retryAfterMs ??
        calculateRetryDelayMs({
          attempt,
          minDelayMs: this.options.retry.minDelayMs,
          maxDelayMs: this.options.retry.maxDelayMs,
          jitter: this.options.retry.jitter,
        });
      await sleep(delayMs);
    }

    return true;
  }
}
```

- [ ] **Step 3: Verify queue tests**

Run:

```bash
pnpm --filter @wiolett/gateway-logger test -- queue
```

Expected: PASS.

## Task 5: Logger, Child Loggers, Traces, And Spans

**Files:**
- Create: `packages/logging-sdk/src/ids.ts`
- Create: `packages/logging-sdk/src/logger.ts`
- Create: `packages/logging-sdk/src/trace.ts`
- Test: `packages/logging-sdk/src/logger.test.ts`
- Test: `packages/logging-sdk/src/trace.test.ts`
- Modify: `packages/logging-sdk/src/index.ts`

- [ ] **Step 1: Add id helpers**

Create `packages/logging-sdk/src/ids.ts`:

```ts
import { randomUUID } from 'node:crypto';

export function createTraceId(): string {
  return randomUUID();
}

export function createSpanId(): string {
  return randomUUID();
}
```

- [ ] **Step 2: Write logger tests**

Create `packages/logging-sdk/src/logger.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createGatewayLogger } from './logger.js';

describe('gateway logger', () => {
  it('queues severity helper events with merged context', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: 1, rejected: 0, errors: [] }), { status: 200 }));
    const logger = createGatewayLogger({
      endpoint: 'https://gateway.example.com',
      token: 'gwl_test',
      service: 'api',
      labels: { app: 'billing' },
      fetch: fetchMock,
      batching: { flushDebounceMs: 10 },
    });

    const payments = logger.child({
      service: 'billing-api',
      labels: { module: 'payments' },
      fields: { provider: 'stripe' },
    });
    payments.error('Capture failed', {
      labels: { region: 'us' },
      fields: { statusCode: 502 },
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      severity: 'error',
      message: 'Capture failed',
      service: 'billing-api',
      labels: { app: 'billing', module: 'payments', region: 'us' },
      fields: { provider: 'stripe', statusCode: 502 },
    });
    await logger.close();
    vi.useRealTimers();
  });

  it('flush sends queued logs manually', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: 1, rejected: 0, errors: [] }), { status: 200 }));
    const logger = createGatewayLogger({
      endpoint: 'https://gateway.example.com',
      token: 'gwl_test',
      fetch: fetchMock,
      batching: { flushIntervalMs: 60_000, flushDebounceMs: 60_000 },
    });

    logger.info('hello');
    await logger.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await logger.close();
  });
});
```

- [ ] **Step 3: Implement logger**

Create `packages/logging-sdk/src/logger.ts`:

```ts
import { mergeContext, normalizeEvent } from './context.js';
import { GatewayLogQueue } from './queue.js';
import { createGatewayTransport } from './transport.js';
import { createTraceLogger } from './trace.js';
import type {
  GatewayLogContext,
  GatewayLogEvent,
  GatewayLogger,
  GatewayLoggerOptions,
  GatewayLogOptions,
  GatewayLogSeverity,
  GatewayTraceContext,
  GatewayTraceLogger,
} from './types.js';

const DEFAULT_BATCHING = {
  enabled: true,
  maxBatchSize: 100,
  flushIntervalMs: 5000,
  flushDebounceMs: 250,
  maxQueueSize: 10_000,
  overflow: 'drop-oldest' as const,
};

const DEFAULT_RETRY = {
  maxAttempts: 5,
  minDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: true,
};

export function createGatewayLogger(options: GatewayLoggerOptions): GatewayLogger {
  const batching = { ...DEFAULT_BATCHING, ...options.batching };
  const retry = { ...DEFAULT_RETRY, ...options.retry };
  const transport = createGatewayTransport({
    endpoint: options.endpoint,
    token: options.token,
    fetch: options.fetch,
  });
  const queue = new GatewayLogQueue({
    transport,
    maxBatchSize: batching.maxBatchSize,
    flushIntervalMs: batching.flushIntervalMs,
    flushDebounceMs: batching.flushDebounceMs,
    maxQueueSize: batching.maxQueueSize,
    overflow: batching.overflow,
    retry,
    onError: options.onError,
    onDrop: options.onDrop,
  });

  return createLoggerInstance(
    {
      service: options.service,
      source: options.source,
      traceId: options.traceId,
      spanId: options.spanId,
      requestId: options.requestId,
      labels: options.labels,
      fields: options.fields,
    },
    queue
  );
}

export function createLoggerInstance(context: GatewayLogContext, queue: GatewayLogQueue): GatewayLogger {
  const emit = (severity: GatewayLogSeverity, message: string, options?: GatewayLogOptions) => {
    const event = normalizeEvent({
      ...mergeContext(context, options),
      severity,
      message,
      timestamp: options?.timestamp,
    });
    queue.enqueue(event);
  };

  const logger: GatewayLogger = {
    trace: (message, options) => emit('trace', message, options),
    debug: (message, options) => emit('debug', message, options),
    info: (message, options) => emit('info', message, options),
    warn: (message, options) => emit('warn', message, options),
    error: (message, options) => emit('error', message, options),
    fatal: (message, options) => emit('fatal', message, options),
    log: (event: GatewayLogEvent) => {
      queue.enqueue(normalizeEvent({ ...mergeContext(context, event), severity: event.severity, message: event.message, timestamp: event.timestamp }));
    },
    child: (childContext) => createLoggerInstance(mergeContext(context, childContext), queue),
    createTrace: (traceContext?: GatewayTraceContext): GatewayTraceLogger =>
      createTraceLogger(createLoggerInstance(mergeContext(context, traceContext), queue), mergeContext(context, traceContext), queue),
    withContext: async (childContext, fn) => fn(createLoggerInstance(mergeContext(context, childContext), queue)),
    flush: () => queue.flush(),
    close: () => queue.close(),
    installShutdownHooks: () => installShutdownHooks(queue),
  };

  return logger;
}

function installShutdownHooks(queue: GatewayLogQueue): () => void {
  const handler = () => {
    void queue.close();
  };
  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);
  process.once('beforeExit', handler);

  return () => {
    process.off('SIGINT', handler);
    process.off('SIGTERM', handler);
    process.off('beforeExit', handler);
  };
}
```

- [ ] **Step 4: Write trace tests**

Create `packages/logging-sdk/src/trace.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createGatewayLogger } from './logger.js';

describe('gateway trace logger', () => {
  it('adds trace id to trace logs and trace plus span id to span logs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: 2, rejected: 0, errors: [] }), { status: 200 }));
    const logger = createGatewayLogger({
      endpoint: 'https://gateway.example.com',
      token: 'gwl_test',
      fetch: fetchMock,
      batching: { maxBatchSize: 2, flushDebounceMs: 60_000 },
    });

    const trace = logger.createTrace({ traceId: 'trace_123', labels: { flow: 'checkout' } });
    const span = trace.createSpan({ spanId: 'span_456', labels: { provider: 'stripe' } });
    trace.info('Checkout started');
    span.error('Capture failed');
    await logger.flush();

    const payload = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(payload.logs).toEqual([
      expect.objectContaining({ traceId: 'trace_123', labels: { flow: 'checkout' } }),
      expect.objectContaining({ traceId: 'trace_123', spanId: 'span_456', labels: { flow: 'checkout', provider: 'stripe' } }),
    ]);
    await logger.close();
  });
});
```

- [ ] **Step 5: Implement trace wrappers**

Create `packages/logging-sdk/src/trace.ts`:

```ts
import { createSpanId, createTraceId } from './ids.js';
import { mergeContext } from './context.js';
import { createLoggerInstance } from './logger.js';
import type { GatewayLogContext, GatewayLogger, GatewayLogOptions, GatewaySpanContext, GatewaySpanLogger, GatewayTraceLogger } from './types.js';
import type { GatewayLogQueue } from './queue.js';

export function createTraceLogger(base: GatewayLogger, context: GatewayLogContext, queue: GatewayLogQueue): GatewayTraceLogger {
  const traceId = context.traceId ?? createTraceId();
  const traceContext = mergeContext(context, { traceId });
  const logger = createLoggerInstance(traceContext, queue);

  return {
    ...logger,
    traceId,
    createSpan(spanContext?: GatewaySpanContext | string) {
      const normalizedContext = typeof spanContext === 'string' ? { name: spanContext } : spanContext;
      const spanId = normalizedContext?.spanId ?? createSpanId();
      const merged = mergeContext(traceContext, normalizedContext, {
        spanId,
        fields: normalizedContext?.name ? { spanName: normalizedContext.name } : undefined,
      });
      return createSpanLogger(createLoggerInstance(merged, queue), traceId, spanId);
    },
    async end(message = 'Trace ended', options?: GatewayLogOptions) {
      base.info(message, mergeContext(traceContext, options));
      await base.flush();
    },
  };
}

function createSpanLogger(base: GatewayLogger, traceId: string, spanId: string): GatewaySpanLogger {
  return {
    ...base,
    traceId,
    spanId,
    async end(message = 'Span ended', options?: GatewayLogOptions) {
      base.info(message, options);
      await base.flush();
    },
  };
}
```

- [ ] **Step 6: Update exports**

Modify `packages/logging-sdk/src/index.ts` to export all public types and `createGatewayLogger`.

- [ ] **Step 7: Verify logger and trace tests**

Run:

```bash
pnpm --filter @wiolett/gateway-logger test -- logger trace
```

Expected: PASS.

## Task 6: SDK Documentation

**Files:**
- Create: `packages/logging-sdk/README.md`
- Modify: `README.md`

- [ ] **Step 1: Add package README**

Create `packages/logging-sdk/README.md` with:

```md
# Gateway Logging SDK

Node-first TypeScript SDK for sending external application logs into Gateway.

## Usage

```ts
import { createGatewayLogger } from "@wiolett/gateway-logger";

const logger = createGatewayLogger({
  endpoint: "https://gateway.example.com",
  token: process.env.GATEWAY_LOGGING_TOKEN!,
  service: "api",
  source: "main",
  labels: { app: "billing", region: "eu" },
  fields: { version: "2.4.1" },
  batching: {
    maxBatchSize: 100,
    flushDebounceMs: 250,
    flushIntervalMs: 5000,
    maxQueueSize: 10000,
    overflow: "drop-oldest",
  },
});

const payments = logger.child({
  service: "billing-api",
  labels: { module: "payments" },
  fields: { provider: "stripe" },
});

payments.error("Payment capture failed", {
  labels: { region: "us" },
  fields: { statusCode: 502, durationMs: 1834 },
});

const trace = logger.createTrace({ requestId: "req_123" });
trace.info("Checkout started");
const span = trace.createSpan("stripe.capture");
span.error("Capture failed");
await span.end();
await trace.end();

await logger.flush();
await logger.close();
```

## Delivery

- Logs are queued in memory.
- The SDK flushes automatically after `flushDebounceMs`.
- The SDK also flushes periodically every `flushIntervalMs`.
- Reaching `maxBatchSize` schedules an immediate flush.
- Transient errors are retried with capped exponential backoff.
- `429` responses pause delivery using `Retry-After` or Gateway's `details.retryAfterSeconds`.
- Permanent validation/auth failures are not retried.
```

- [ ] **Step 2: Add root README reference**

Modify root `README.md` logging section with a short SDK example and a note that `gwl_` tokens are server-side secrets.

## Task 7: Full Verification

**Files:**
- All files created or modified by this plan.

- [ ] **Step 1: Run SDK tests**

Run:

```bash
pnpm --filter @wiolett/gateway-logger test
```

Expected: PASS.

- [ ] **Step 2: Run SDK typecheck**

Run:

```bash
pnpm --filter @wiolett/gateway-logger typecheck
```

Expected: PASS.

- [ ] **Step 3: Build SDK**

Run:

```bash
pnpm --filter @wiolett/gateway-logger build
```

Expected: PASS and `packages/logging-sdk/dist/index.js` plus declarations are emitted.

- [ ] **Step 4: Lint SDK**

Run:

```bash
pnpm --filter @wiolett/gateway-logger lint
```

Expected: PASS.

- [ ] **Step 5: Run root workspace build target**

Run:

```bash
pnpm run build:logging-sdk
```

Expected: PASS.

## Self-Review Notes

- Requirements covered:
  - Global labels and fields: Task 2 context types and merge helpers.
  - Specialized instances: Task 5 `child()`.
  - Trace-specific logging: Task 5 `createTrace()` and `createSpan()`.
  - Manual flush: Task 4 queue and Task 5 logger `flush()`.
  - Automatic flush: Task 4 debounce and interval queue tests.
  - No request per single log: Task 4 debounce test.
  - Retries on errors: Task 3 classification and Task 4 retry loop.
  - Rate-limit handling: Task 3 `Retry-After` parsing and Task 4 rate-limit backoff test.
- No management APIs are included, matching approved ingest-only scope.
- The implementation is Node-first and keeps `gwl_` tokens out of browser guidance.
- Tests prove behavior at the module boundary rather than relying only on build success.
