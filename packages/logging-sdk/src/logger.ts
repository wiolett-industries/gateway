import { mergeContext, normalizeEvent } from './context.js';
import { createSpanId, createTraceId } from './ids.js';
import { GatewayLogQueue } from './queue.js';
import { createGatewayTransport } from './transport.js';
import type {
  GatewayBatchingOptions,
  GatewayLogContext,
  GatewayLogEvent,
  GatewayLoggerHooks,
  GatewayLoggerMethods,
  GatewayLoggerOptions,
  GatewayLogOptions,
  GatewayLogSeverity,
  GatewayRetryOptions,
  GatewaySpanContext,
  GatewaySpanLogger,
  GatewayTraceContext,
  GatewayTraceLogger,
} from './types.js';
import { GatewayLoggerHook } from './types.js';

interface GatewayLoggerState {
  context: GatewayLogContext;
  queue: GatewayLogQueue;
  hooks: GatewayLoggerHookRegistry;
}

const loggerState = new WeakMap<GatewayLogger, GatewayLoggerState>();

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

export class GatewayLogger implements GatewayLoggerMethods {
  constructor(options: GatewayLoggerOptions) {
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
      onFallback: options.onFallback,
    });
    loggerState.set(this, {
      context: {
        service: options.service,
        source: options.source,
        traceId: options.traceId,
        spanId: options.spanId,
        requestId: options.requestId,
        labels: options.labels,
        fields: options.fields,
      },
      queue,
      hooks: new GatewayLoggerHookRegistry(queue),
    });
  }

  get hooks(): GatewayLoggerHooks {
    return getLoggerState(this).hooks;
  }

  trace(message: string, options?: GatewayLogOptions): void {
    this.emit('trace', message, options);
  }

  debug(message: string, options?: GatewayLogOptions): void {
    this.emit('debug', message, options);
  }

  info(message: string, options?: GatewayLogOptions): void {
    this.emit('info', message, options);
  }

  warn(message: string, options?: GatewayLogOptions): void {
    this.emit('warn', message, options);
  }

  error(message: string, options?: GatewayLogOptions): void {
    this.emit('error', message, options);
  }

  fatal(message: string, options?: GatewayLogOptions): void {
    this.emit('fatal', message, options);
  }

  log(event: GatewayLogEvent): void {
    const state = getLoggerState(this);
    const merged = mergeContext(state.context, event);
    state.queue.enqueue(
      normalizeEvent({
        ...merged,
        severity: event.severity,
        message: event.message,
        timestamp: event.timestamp,
      })
    );
  }

  child(context: GatewayLogContext): GatewayLogger {
    const state = getLoggerState(this);
    return createLoggerFromState({
      context: mergeContext(state.context, context),
      queue: state.queue,
      hooks: state.hooks,
    });
  }

  createTrace(context?: GatewayTraceContext): GatewayTraceLogger {
    const state = getLoggerState(this);
    return new GatewayTraceLoggerImpl(state.context, state.queue, state.hooks, context);
  }

  async withContext<T>(context: GatewayLogContext, fn: (logger: GatewayLogger) => T | Promise<T>): Promise<T> {
    return fn(this.child(context));
  }

  flush(): Promise<void> {
    return getLoggerState(this).queue.flush();
  }

  close(): Promise<void> {
    return getLoggerState(this).queue.close();
  }

  private emit(severity: GatewayLogSeverity, message: string, options?: GatewayLogOptions): void {
    const state = getLoggerState(this);
    const merged = mergeContext(state.context, options);
    state.queue.enqueue(normalizeEvent({ ...merged, severity, message, timestamp: options?.timestamp }));
  }
}

function createLoggerFromState(state: GatewayLoggerState): GatewayLogger {
  const logger = Object.create(GatewayLogger.prototype) as GatewayLogger;
  loggerState.set(logger, state);
  return logger;
}

function getLoggerState(logger: GatewayLogger): GatewayLoggerState {
  const state = loggerState.get(logger);
  if (!state) {
    throw new TypeError('GatewayLogger was not initialized');
  }
  return state;
}

function normalizeBatchingOptions(options: GatewayBatchingOptions | undefined): Required<GatewayBatchingOptions> {
  const batching = { ...DEFAULT_BATCHING, ...options };
  if (batching.enabled) return batching;
  return { ...batching, maxBatchSize: 1, flushDebounceMs: 0 };
}

class GatewayTraceLoggerImpl implements GatewayTraceLogger {
  readonly traceId: string;
  private readonly base: GatewayLogger;
  private readonly context: GatewayLogContext;

  constructor(
    parentContext: GatewayLogContext,
    private readonly queue: GatewayLogQueue,
    private readonly hooksRegistry: GatewayLoggerHookRegistry,
    traceContext?: GatewayTraceContext
  ) {
    this.traceId = traceContext?.traceId ?? parentContext.traceId ?? createTraceId();
    const fields = traceContext?.name ? { ...traceContext.fields, traceName: traceContext.name } : traceContext?.fields;
    this.context = mergeContext(parentContext, traceContext, { traceId: this.traceId, fields });
    this.base = createLoggerFromState({ context: this.context, queue, hooks: hooksRegistry });
  }

  get hooks(): GatewayLoggerHooks {
    return this.base.hooks;
  }

  trace(message: string, options?: GatewayLogOptions): void {
    this.base.trace(message, options);
  }

  debug(message: string, options?: GatewayLogOptions): void {
    this.base.debug(message, options);
  }

  info(message: string, options?: GatewayLogOptions): void {
    this.base.info(message, options);
  }

  warn(message: string, options?: GatewayLogOptions): void {
    this.base.warn(message, options);
  }

  error(message: string, options?: GatewayLogOptions): void {
    this.base.error(message, options);
  }

  fatal(message: string, options?: GatewayLogOptions): void {
    this.base.fatal(message, options);
  }

  log(event: GatewayLogEvent): void {
    this.base.log(event);
  }

  child(context: GatewayLogContext): GatewayLoggerMethods {
    return this.base.child(context);
  }

  createTrace(context?: GatewayTraceContext): GatewayTraceLogger {
    return this.base.createTrace(context);
  }

  async withContext<T>(context: GatewayLogContext, fn: (logger: GatewayLoggerMethods) => T | Promise<T>): Promise<T> {
    return this.base.withContext(context, fn);
  }

  flush(): Promise<void> {
    return this.base.flush();
  }

  close(): Promise<void> {
    return this.base.close();
  }

  createSpan(spanContext?: GatewaySpanContext | string): GatewaySpanLogger {
    return new GatewaySpanLoggerImpl(this.context, this.queue, this.hooksRegistry, spanContext);
  }

  async end(message = 'Trace ended', options?: GatewayLogOptions): Promise<void> {
    this.info(message, options);
    await this.flush();
  }
}

class GatewaySpanLoggerImpl implements GatewaySpanLogger {
  readonly traceId: string;
  readonly spanId: string;
  private readonly base: GatewayLogger;

  constructor(
    traceContext: GatewayLogContext,
    queue: GatewayLogQueue,
    hooks: GatewayLoggerHookRegistry,
    spanContext?: GatewaySpanContext | string
  ) {
    const normalizedContext: GatewaySpanContext | undefined =
      typeof spanContext === 'string' ? { name: spanContext } : spanContext;
    this.traceId = traceContext.traceId ?? createTraceId();
    this.spanId = normalizedContext?.spanId ?? createSpanId();
    const fields = normalizedContext?.name
      ? { ...normalizedContext.fields, spanName: normalizedContext.name }
      : normalizedContext?.fields;
    this.base = createLoggerFromState({
      context: mergeContext(traceContext, normalizedContext, { traceId: this.traceId, spanId: this.spanId, fields }),
      queue,
      hooks,
    });
  }

  get hooks(): GatewayLoggerHooks {
    return this.base.hooks;
  }

  trace(message: string, options?: GatewayLogOptions): void {
    this.base.trace(message, options);
  }

  debug(message: string, options?: GatewayLogOptions): void {
    this.base.debug(message, options);
  }

  info(message: string, options?: GatewayLogOptions): void {
    this.base.info(message, options);
  }

  warn(message: string, options?: GatewayLogOptions): void {
    this.base.warn(message, options);
  }

  error(message: string, options?: GatewayLogOptions): void {
    this.base.error(message, options);
  }

  fatal(message: string, options?: GatewayLogOptions): void {
    this.base.fatal(message, options);
  }

  log(event: GatewayLogEvent): void {
    this.base.log(event);
  }

  child(context: GatewayLogContext): GatewayLoggerMethods {
    return this.base.child(context);
  }

  createTrace(context?: GatewayTraceContext): GatewayTraceLogger {
    return this.base.createTrace(context);
  }

  async withContext<T>(context: GatewayLogContext, fn: (logger: GatewayLoggerMethods) => T | Promise<T>): Promise<T> {
    return this.base.withContext(context, fn);
  }

  flush(): Promise<void> {
    return this.base.flush();
  }

  close(): Promise<void> {
    return this.base.close();
  }

  async end(message = 'Span ended', options?: GatewayLogOptions): Promise<void> {
    this.info(message, options);
    await this.flush();
  }
}

class GatewayLoggerHookRegistry implements GatewayLoggerHooks {
  private readonly installedHooks = new Map<GatewayLoggerHook, () => void>();

  constructor(private readonly queue: GatewayLogQueue) {}

  install(hook: GatewayLoggerHook): () => void {
    if (!this.installedHooks.has(hook)) {
      this.installedHooks.set(hook, this.createHookUninstaller(hook));
    }
    return () => this.uninstall(hook);
  }

  uninstall(hook: GatewayLoggerHook): void {
    const uninstall = this.installedHooks.get(hook);
    if (!uninstall) return;
    this.installedHooks.delete(hook);
    uninstall();
  }

  private createHookUninstaller(hook: GatewayLoggerHook): () => void {
    switch (hook) {
      case GatewayLoggerHook.SHUTDOWN:
        return this.installShutdownHook();
    }
  }

  private installShutdownHook(): () => void {
    const handler = () => {
      void this.queue.close();
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
}
