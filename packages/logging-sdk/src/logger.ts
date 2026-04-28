import { mergeContext, normalizeEvent } from './context.js';
import { createSpanId, createTraceId } from './ids.js';
import { GatewayLogQueue } from './queue.js';
import { createGatewayTransport } from './transport.js';
import type {
  GatewayBatchingOptions,
  GatewayLogContext,
  GatewayLogEvent,
  GatewayLogger,
  GatewayLoggerOptions,
  GatewayLogOptions,
  GatewayLogSeverity,
  GatewayRetryOptions,
  GatewaySpanContext,
  GatewaySpanLogger,
  GatewayTraceContext,
  GatewayTraceLogger,
} from './types.js';

const DEFAULT_BATCHING: Required<GatewayBatchingOptions> = {
  enabled: true,
  maxBatchSize: 100,
  flushIntervalMs: 5000,
  flushDebounceMs: 250,
  maxQueueSize: 10_000,
  overflow: 'drop-oldest',
};

const DEFAULT_RETRY: Required<GatewayRetryOptions> = {
  maxAttempts: 5,
  minDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: true,
};

export function createGatewayLogger(options: GatewayLoggerOptions): GatewayLogger {
  const batching = normalizeBatchingOptions(options.batching);
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

function normalizeBatchingOptions(options: GatewayBatchingOptions | undefined): Required<GatewayBatchingOptions> {
  const batching = { ...DEFAULT_BATCHING, ...options };
  if (batching.enabled) return batching;
  return { ...batching, maxBatchSize: 1, flushDebounceMs: 0 };
}

function createLoggerInstance(context: GatewayLogContext, queue: GatewayLogQueue): GatewayLogger {
  const emit = (severity: GatewayLogSeverity, message: string, options?: GatewayLogOptions) => {
    const merged = mergeContext(context, options);
    queue.enqueue(normalizeEvent({ ...merged, severity, message, timestamp: options?.timestamp }));
  };

  const logger: GatewayLogger = {
    trace: (message, options) => emit('trace', message, options),
    debug: (message, options) => emit('debug', message, options),
    info: (message, options) => emit('info', message, options),
    warn: (message, options) => emit('warn', message, options),
    error: (message, options) => emit('error', message, options),
    fatal: (message, options) => emit('fatal', message, options),
    log: (event: GatewayLogEvent) => {
      const merged = mergeContext(context, event);
      queue.enqueue(
        normalizeEvent({
          ...merged,
          severity: event.severity,
          message: event.message,
          timestamp: event.timestamp,
        })
      );
    },
    child: (childContext) => createLoggerInstance(mergeContext(context, childContext), queue),
    createTrace: (traceContext) => createTraceLogger(context, queue, traceContext),
    withContext: async (childContext, fn) => fn(createLoggerInstance(mergeContext(context, childContext), queue)),
    flush: () => queue.flush(),
    close: () => queue.close(),
    installShutdownHooks: () => installShutdownHooks(queue),
  };

  return logger;
}

function createTraceLogger(
  parentContext: GatewayLogContext,
  queue: GatewayLogQueue,
  traceContext?: GatewayTraceContext
): GatewayTraceLogger {
  const traceId = traceContext?.traceId ?? parentContext.traceId ?? createTraceId();
  const fields = traceContext?.name ? { ...traceContext.fields, traceName: traceContext.name } : traceContext?.fields;
  const context = mergeContext(parentContext, traceContext, { traceId, fields });
  const base = createLoggerInstance(context, queue);

  return {
    ...base,
    traceId,
    createSpan: (spanContext) => createSpanLogger(context, queue, spanContext),
    async end(message = 'Trace ended', options?: GatewayLogOptions) {
      base.info(message, options);
      await base.flush();
    },
  };
}

function createSpanLogger(
  traceContext: GatewayLogContext,
  queue: GatewayLogQueue,
  spanContext?: GatewaySpanContext | string
): GatewaySpanLogger {
  const normalizedContext: GatewaySpanContext | undefined =
    typeof spanContext === 'string' ? { name: spanContext } : spanContext;
  const traceId = traceContext.traceId ?? createTraceId();
  const spanId = normalizedContext?.spanId ?? createSpanId();
  const fields = normalizedContext?.name
    ? { ...normalizedContext.fields, spanName: normalizedContext.name }
    : normalizedContext?.fields;
  const context = mergeContext(traceContext, normalizedContext, { traceId, spanId, fields });
  const base = createLoggerInstance(context, queue);

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
