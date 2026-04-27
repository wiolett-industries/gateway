import { AppError } from '@/middleware/error-handler.js';
import type { LoggingClickHouseService } from './logging-clickhouse.service.js';
import type { LoggingEnvironmentService } from './logging-environment.service.js';
import type { LoggingSearchRequest } from './logging-storage.types.js';

export class LoggingSearchService {
  constructor(
    private readonly environments: LoggingEnvironmentService,
    private readonly storage: LoggingClickHouseService
  ) {}

  async search(environmentId: string, query: LoggingSearchRequest) {
    const environment = await this.environments.get(environmentId);
    if (!environment.enabled) throw new AppError(404, 'LOGGING_ENVIRONMENT_NOT_FOUND', 'Logging environment not found');
    return this.storage.searchLogs({
      environmentId,
      query,
      fieldSchema: environment.fieldSchema,
      schemaMode: environment.schemaMode,
    });
  }

  async facets(environmentId: string, range?: { from?: string; to?: string }) {
    const environment = await this.environments.get(environmentId);
    if (!environment.enabled) throw new AppError(404, 'LOGGING_ENVIRONMENT_NOT_FOUND', 'Logging environment not found');
    return this.storage.getFacets(environmentId, range, environment.fieldSchema);
  }
}
