import type { Env } from '@/config/env.js';
import { AppError } from '@/middleware/error-handler.js';

export class LoggingFeatureService {
  private available = false;

  constructor(private readonly env: Env) {}

  isEnabled(): boolean {
    return this.env.CLICKHOUSE_URL.trim().length > 0;
  }

  isAvailable(): boolean {
    return this.isEnabled() && this.available;
  }

  markAvailable(): void {
    this.available = true;
  }

  markUnavailable(_reason: string): void {
    this.available = false;
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
