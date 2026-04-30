import { type ClickHouseClient, createClient } from '@clickhouse/client';
import type { Env } from '@/config/env.js';
import { createChildLogger } from '@/lib/logger.js';
import { AppError } from '@/middleware/error-handler.js';
import {
  buildCursor,
  buildSearchQuery,
  quoteClickHouseIdentifier,
  validateClickHouseIdentifier,
} from './logging-query-builder.js';
import type {
  LoggingClickHouseRow,
  LoggingFacets,
  LoggingSearchRequest,
  LoggingSearchResult,
} from './logging-storage.types.js';

const logger = createChildLogger('LoggingClickHouse');

export class LoggingClickHouseService {
  private readonly client: ClickHouseClient | null;
  private readonly database: string;
  private readonly table: string;

  constructor(env: Env) {
    this.database = validateClickHouseIdentifier(env.CLICKHOUSE_DATABASE);
    this.table = validateClickHouseIdentifier(env.CLICKHOUSE_LOGS_TABLE);
    this.client = env.CLICKHOUSE_URL
      ? createClient({
          url: env.CLICKHOUSE_URL,
          username: env.CLICKHOUSE_USERNAME,
          password: env.CLICKHOUSE_PASSWORD,
          request_timeout: env.CLICKHOUSE_REQUEST_TIMEOUT_MS,
          clickhouse_settings: {
            async_insert: 1,
            wait_for_async_insert: 1,
          },
        })
      : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    const result = await this.client.ping();
    return result.success;
  }

  async ensureSchema(): Promise<void> {
    if (!this.client) return;
    const database = quoteClickHouseIdentifier(this.database);
    const table = `${database}.${quoteClickHouseIdentifier(this.table)}`;
    await this.client.command({ query: `CREATE DATABASE IF NOT EXISTS ${database}` });
    await this.client.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${table}
        (
          EventId UUID DEFAULT generateUUIDv4(),
          Timestamp DateTime64(3, 'UTC') CODEC(Delta(8), ZSTD(1)),
          TimestampTime DateTime DEFAULT toDateTime(Timestamp),
          IngestedAt DateTime64(3, 'UTC') DEFAULT now64(3),
          EnvironmentId UUID,
          RetentionDays UInt16,
          Service LowCardinality(String),
          Source LowCardinality(String),
          Severity LowCardinality(String),
          SeverityNumber UInt8,
          Message String CODEC(ZSTD(1)),
          TraceId String CODEC(ZSTD(1)),
          SpanId String CODEC(ZSTD(1)),
          RequestId String CODEC(ZSTD(1)),
          Labels Map(LowCardinality(String), String) CODEC(ZSTD(1)),
          FieldStrings Map(LowCardinality(String), String) CODEC(ZSTD(1)),
          FieldNumbers Map(LowCardinality(String), Float64) CODEC(ZSTD(1)),
          FieldBooleans Map(LowCardinality(String), UInt8) CODEC(ZSTD(1)),
          FieldDatetimes Map(LowCardinality(String), DateTime64(3, 'UTC')) CODEC(Delta(8), ZSTD(1)),
          FieldsJson String CODEC(ZSTD(1)),
          INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
          INDEX idx_request_id RequestId TYPE bloom_filter(0.001) GRANULARITY 1,
          INDEX idx_message lower(Message) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 8,
          INDEX idx_label_keys mapKeys(Labels) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_label_values mapValues(Labels) TYPE bloom_filter(0.01) GRANULARITY 1
        )
        ENGINE = MergeTree
        PARTITION BY toDate(TimestampTime)
        ORDER BY (EnvironmentId, Service, SeverityNumber, TimestampTime, EventId)
        TTL TimestampTime + toIntervalDay(RetentionDays)
      `,
    });
  }

  async insertLogs(rows: LoggingClickHouseRow[]): Promise<void> {
    if (!this.client) throw unavailable();
    if (rows.length === 0) return;
    try {
      await this.client.insert({
        table: `${quoteClickHouseIdentifier(this.database)}.${quoteClickHouseIdentifier(this.table)}`,
        values: rows,
        format: 'JSONEachRow',
      });
    } catch (error) {
      logger.error('ClickHouse insert failed', { error });
      throw unavailable();
    }
  }

  async deleteEnvironmentLogs(environmentId: string): Promise<void> {
    if (!this.client) return;
    const table = `${quoteClickHouseIdentifier(this.database)}.${quoteClickHouseIdentifier(this.table)}`;
    try {
      await this.client.command({
        query: `ALTER TABLE ${table} DELETE WHERE EnvironmentId = {environmentId: UUID}`,
        query_params: { environmentId },
        clickhouse_settings: { mutations_sync: '1' },
      });
    } catch (error) {
      logger.error('ClickHouse environment log cleanup failed', { environmentId, error });
      throw unavailable();
    }
  }

  async searchLogs(params: {
    environmentId: string;
    query: LoggingSearchRequest;
    fieldSchema: any[];
    schemaMode: 'loose' | 'strip' | 'reject';
  }): Promise<{ data: LoggingSearchResult[]; nextCursor: string | null }> {
    if (!this.client) throw unavailable();
    const built = buildSearchQuery({
      database: this.database,
      table: this.table,
      environmentId: params.environmentId,
      query: params.query,
      fieldSchema: params.fieldSchema,
      schemaMode: params.schemaMode,
    });
    try {
      const result = await this.client.query({
        query: built.query,
        format: 'JSONEachRow',
        query_params: built.queryParams,
      });
      const raw = (await result.json()) as any[];
      const page = raw.slice(0, params.query.limit).map(mapSearchRow);
      const hasMore = raw.length > params.query.limit;
      const last = page[page.length - 1];
      return {
        data: page,
        nextCursor: hasMore && last ? buildCursor(last.timestamp, last.eventId) : null,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('ClickHouse search failed', { error });
      throw unavailable();
    }
  }

  async getFacets(
    environmentId: string,
    range?: { from?: string; to?: string },
    fieldSchema: any[] = []
  ): Promise<LoggingFacets> {
    if (!this.client) throw unavailable();
    const table = `${quoteClickHouseIdentifier(this.database)}.${quoteClickHouseIdentifier(this.table)}`;
    const rangeSql = [
      'EnvironmentId = {environmentId: UUID}',
      range?.from ? 'Timestamp >= {from: DateTime64(3)}' : '',
      range?.to ? 'Timestamp <= {to: DateTime64(3)}' : '',
    ].filter(Boolean);
    const queryParams: Record<string, unknown> = { environmentId };
    if (range?.from) queryParams.from = range.from.replace('T', ' ').replace('Z', '');
    if (range?.to) queryParams.to = range.to.replace('T', ' ').replace('Z', '');
    try {
      const [services, sources, severities] = await Promise.all([
        this.client.query({
          query: `SELECT Service AS value FROM ${table} WHERE ${rangeSql.join(' AND ')} AND Service != '' GROUP BY Service ORDER BY count() DESC LIMIT 100`,
          format: 'JSONEachRow',
          query_params: queryParams,
        }),
        this.client.query({
          query: `SELECT Source AS value FROM ${table} WHERE ${rangeSql.join(' AND ')} AND Source != '' GROUP BY Source ORDER BY count() DESC LIMIT 100`,
          format: 'JSONEachRow',
          query_params: queryParams,
        }),
        this.client.query({
          query: `SELECT Severity AS severity, count() AS count FROM ${table} WHERE ${rangeSql.join(' AND ')} GROUP BY Severity`,
          format: 'JSONEachRow',
          query_params: queryParams,
        }),
      ]);
      const labelValues: Record<string, string[]> = {};
      for (const label of fieldSchema.filter((field) => field.location === 'label')) {
        const result = await this.client.query({
          query: `SELECT Labels[{labelKey: String}] AS value FROM ${table} WHERE ${rangeSql.join(' AND ')} AND mapContains(Labels, {labelKey: String}) GROUP BY value ORDER BY count() DESC LIMIT 100`,
          format: 'JSONEachRow',
          query_params: { ...queryParams, labelKey: label.key },
        });
        labelValues[label.key] = ((await result.json()) as Array<{ value: string }>).map((row) => row.value);
      }
      return {
        services: ((await services.json()) as Array<{ value: string }>).map((row) => row.value),
        sources: ((await sources.json()) as Array<{ value: string }>).map((row) => row.value),
        severities: ((await severities.json()) as Array<{ severity: any; count: string | number }>).map((row) => ({
          severity: row.severity,
          count: Number(row.count),
        })),
        labels: labelValues,
      };
    } catch (error) {
      logger.error('ClickHouse facets failed', { error });
      throw unavailable();
    }
  }

  async close(): Promise<void> {
    await this.client?.close();
  }
}

function mapSearchRow(row: any): LoggingSearchResult {
  const fieldsJson = safeJson(row.fieldsJson);
  return {
    eventId: row.eventId,
    timestamp: new Date(`${row.timestamp}Z`).toISOString(),
    ingestedAt: new Date(`${row.ingestedAt}Z`).toISOString(),
    environmentId: row.environmentId,
    severity: row.severity,
    message: row.message,
    service: row.service,
    source: row.source,
    traceId: row.traceId,
    spanId: row.spanId,
    requestId: row.requestId,
    labels: row.labels ?? {},
    fields: {
      ...(row.fieldStrings ?? {}),
      ...(row.fieldNumbers ?? {}),
      ...Object.fromEntries(Object.entries(row.fieldBooleans ?? {}).map(([key, value]) => [key, value === 1])),
      ...(row.fieldDatetimes ?? {}),
      ...(fieldsJson && typeof fieldsJson === 'object' ? fieldsJson : {}),
    },
  };
}

function safeJson(value: string) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function unavailable(): AppError {
  return new AppError(503, 'LOGGING_UNAVAILABLE', 'External logging storage is unavailable');
}
