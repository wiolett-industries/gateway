export type GatewayLogSeverity = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type GatewayJsonObject = { [key: string]: GatewayLogValue };
export type GatewayJsonArray = GatewayLogValue[];
export type GatewayLogValue = string | number | boolean | Date | null | GatewayJsonObject | GatewayJsonArray;

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

export type GatewayLog = NormalizedGatewayLogEvent;
export type GatewayLogFailureReason = 'permanent_failure' | 'retry_exhausted';

export interface GatewayLogFailureInfo {
  reason: GatewayLogFailureReason;
  error?: unknown;
  status?: number;
}

export enum GatewayLoggerHook {
  SHUTDOWN = 'shutdown',
}

export interface GatewayLoggerHooks {
  install(hook: GatewayLoggerHook): () => void;
  uninstall(hook: GatewayLoggerHook): void;
}

export interface GatewayLoggerOptions extends GatewayLogContext {
  endpoint: string;
  token: string;
  batching?: GatewayBatchingOptions;
  retry?: GatewayRetryOptions;
  fetch?: typeof fetch;
  onError?: (error: unknown, logs?: readonly GatewayLog[], failure?: GatewayLogFailureInfo) => void;
  onDrop?: (log: GatewayLog, reason: GatewayLogDropReason) => void;
  onFallback?: (logs: readonly GatewayLog[], failure: GatewayLogFailureInfo) => void | Promise<void>;
}

export type GatewayLogDropReason = 'queue_full' | 'closed' | 'invalid_event' | 'permanent_failure' | 'retry_exhausted';

export interface GatewayLoggerMethods {
  readonly hooks: GatewayLoggerHooks;
  trace(message: string, options?: GatewayLogOptions): void;
  debug(message: string, options?: GatewayLogOptions): void;
  info(message: string, options?: GatewayLogOptions): void;
  warn(message: string, options?: GatewayLogOptions): void;
  error(message: string, options?: GatewayLogOptions): void;
  fatal(message: string, options?: GatewayLogOptions): void;
  log(event: GatewayLogEvent): void;
  child(context: GatewayLogContext): GatewayLoggerMethods;
  createTrace(context?: GatewayTraceContext): GatewayTraceLogger;
  withContext<T>(context: GatewayLogContext, fn: (logger: GatewayLoggerMethods) => T | Promise<T>): Promise<T>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface GatewayTraceContext extends GatewayLogContext {
  name?: string;
  traceId?: string;
}

export interface GatewaySpanContext extends GatewayLogContext {
  name?: string;
  spanId?: string;
}

export interface GatewayTraceLogger extends GatewayLoggerMethods {
  readonly traceId: string;
  createSpan(context?: GatewaySpanContext | string): GatewaySpanLogger;
  end(message?: string, options?: GatewayLogOptions): Promise<void>;
}

export interface GatewaySpanLogger extends GatewayLoggerMethods {
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
