import type { Env } from '@/config/env.js';
import { AppError } from '@/middleware/error-handler.js';

export class LoggingFeatureService {
  private available = false;
  private unavailableReason: string | null = null;

  constructor(private readonly env: Env) {}

  isEnabled(): boolean {
    return this.env.CLICKHOUSE_URL.trim().length > 0;
  }

  isAvailable(): boolean {
    return this.isEnabled() && this.available;
  }

  markAvailable(): void {
    this.available = true;
    this.unavailableReason = null;
  }

  markUnavailable(reason: string): void {
    this.available = false;
    this.unavailableReason = reason;
  }

  getStatus() {
    return {
      enabled: this.isEnabled(),
      available: this.isAvailable(),
      reason: this.unavailableReason,
      config: {
        database: this.env.CLICKHOUSE_DATABASE,
        table: this.env.CLICKHOUSE_LOGS_TABLE,
        requestTimeoutMs: this.env.CLICKHOUSE_REQUEST_TIMEOUT_MS,
        ingestMaxBodyBytes: this.env.LOGGING_INGEST_MAX_BODY_BYTES,
        ingestMaxBatchSize: this.env.LOGGING_INGEST_MAX_BATCH_SIZE,
        ingestMaxMessageBytes: this.env.LOGGING_INGEST_MAX_MESSAGE_BYTES,
        ingestMaxLabels: this.env.LOGGING_INGEST_MAX_LABELS,
        ingestMaxFields: this.env.LOGGING_INGEST_MAX_FIELDS,
        ingestMaxKeyLength: this.env.LOGGING_INGEST_MAX_KEY_LENGTH,
        ingestMaxValueBytes: this.env.LOGGING_INGEST_MAX_VALUE_BYTES,
        ingestMaxJsonDepth: this.env.LOGGING_INGEST_MAX_JSON_DEPTH,
        rateLimitWindowSeconds: this.env.LOGGING_RATE_LIMIT_WINDOW_SECONDS,
        globalRequestsPerWindow: this.env.LOGGING_GLOBAL_REQUESTS_PER_WINDOW,
        globalEventsPerWindow: this.env.LOGGING_GLOBAL_EVENTS_PER_WINDOW,
        tokenRequestsPerWindow: this.env.LOGGING_TOKEN_REQUESTS_PER_WINDOW,
        tokenEventsPerWindow: this.env.LOGGING_TOKEN_EVENTS_PER_WINDOW,
      },
    };
  }

  requireEnabled(): void {
    if (!this.isEnabled()) {
      throw new AppError(503, 'LOGGING_DISABLED', 'External logging is disabled');
    }
  }

  requireAvailableForStorage(): void {
    this.requireEnabled();
    if (!this.available) {
      throw new AppError(503, 'LOGGING_UNAVAILABLE', 'External logging storage is unavailable');
    }
  }
}
