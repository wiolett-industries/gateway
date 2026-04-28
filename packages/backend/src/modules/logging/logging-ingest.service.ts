import type { EventBusService } from '@/services/event-bus.service.js';
import type { LoggingClickHouseService } from './logging-clickhouse.service.js';
import type { LoggingMetadataService } from './logging-metadata.service.js';
import type { LoggingValidationError, LoggingValidationService } from './logging-validation.service.js';

export interface LoggingIngestResult {
  accepted: number;
  rejected: number;
  errors: LoggingValidationError[];
}

export class LoggingIngestService {
  private eventBus?: EventBusService;

  constructor(
    private readonly validation: LoggingValidationService,
    private readonly storage: LoggingClickHouseService,
    private readonly metadata: LoggingMetadataService
  ) {}

  setEventBus(eventBus: EventBusService): void {
    this.eventBus = eventBus;
  }

  async ingest(params: {
    body: unknown;
    contentLength?: string;
    logs: unknown[];
    environment: {
      id: string;
      retentionDays: number;
      schemaMode: 'loose' | 'strip' | 'reject';
      fieldSchema: any[];
    };
  }): Promise<LoggingIngestResult> {
    this.validation.enforceBodySize(params.contentLength, params.body);
    const result = this.validation.validateBatch({
      logs: params.logs,
      environmentId: params.environment.id,
      retentionDays: params.environment.retentionDays,
      schemaMode: params.environment.schemaMode,
      fieldSchema: params.environment.fieldSchema,
    });
    if (result.rows.length > 0) {
      await this.storage.insertLogs(result.rows);
      this.metadata.enqueue(params.environment.id, result.rows);
      this.eventBus?.publish('logging.logs.ingested', {
        environmentId: params.environment.id,
        accepted: result.rows.length,
      });
    }
    return {
      accepted: result.rows.length,
      rejected: result.errors.length,
      errors: result.errors,
    };
  }
}
