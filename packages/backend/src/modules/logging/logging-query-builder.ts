import type { LoggingFieldDefinition } from '@/db/schema/index.js';
import { AppError } from '@/middleware/error-handler.js';
import type { LoggingSearchRequest } from './logging-storage.types.js';

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateClickHouseIdentifier(identifier: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new AppError(400, 'INVALID_CLICKHOUSE_IDENTIFIER', `Invalid ClickHouse identifier: ${identifier}`);
  }
  return identifier;
}

export function quoteClickHouseIdentifier(identifier: string): string {
  return `\`${validateClickHouseIdentifier(identifier)}\``;
}

export function buildCursor(timestamp: string, eventId: string): string {
  return Buffer.from(JSON.stringify([timestamp, eventId]), 'utf8').toString('base64url');
}

export function parseCursor(cursor: string | null | undefined): { timestamp: string; eventId: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return { timestamp: parsed[0], eventId: parsed[1] };
    }
  } catch {
    // Fall through to invalid cursor.
  }
  throw new AppError(400, 'INVALID_CURSOR', 'Invalid logging search cursor');
}

export function buildSearchQuery(params: {
  database: string;
  table: string;
  environmentId: string;
  query: LoggingSearchRequest;
  fieldSchema: LoggingFieldDefinition[];
  schemaMode: 'loose' | 'strip' | 'reject';
}) {
  const tableName = `${quoteClickHouseIdentifier(params.database)}.${quoteClickHouseIdentifier(params.table)}`;
  const where = ['EnvironmentId = {environmentId: UUID}'];
  const queryParams: Record<string, unknown> = { environmentId: params.environmentId };
  const cursor = parseCursor(params.query.cursor);

  if (params.query.from) {
    where.push('Timestamp >= {from: DateTime64(3)}');
    queryParams.from = normalizeDateTime(params.query.from);
  }
  if (params.query.to) {
    where.push('Timestamp <= {to: DateTime64(3)}');
    queryParams.to = normalizeDateTime(params.query.to);
  }
  if (params.query.severities?.length) {
    where.push('Severity IN {severities: Array(String)}');
    queryParams.severities = params.query.severities;
  }
  if (params.query.services?.length) {
    where.push('Service IN {services: Array(String)}');
    queryParams.services = params.query.services;
  }
  if (params.query.sources?.length) {
    where.push('Source IN {sources: Array(String)}');
    queryParams.sources = params.query.sources;
  }
  if (params.query.message) {
    where.push('positionCaseInsensitive(Message, {message: String}) > 0');
    queryParams.message = params.query.message;
  }
  for (const attr of ['traceId', 'spanId', 'requestId'] as const) {
    if (params.query[attr]) {
      const column = attr === 'traceId' ? 'TraceId' : attr === 'spanId' ? 'SpanId' : 'RequestId';
      where.push(`${column} = {${attr}: String}`);
      queryParams[attr] = params.query[attr];
    }
  }
  let i = 0;
  for (const [key, value] of Object.entries(params.query.labels ?? {})) {
    where.push(`Labels[{labelKey${i}: String}] = {labelValue${i}: String}`);
    queryParams[`labelKey${i}`] = key;
    queryParams[`labelValue${i}`] = value;
    i += 1;
  }
  for (const [key, filter] of Object.entries(params.query.fields ?? {})) {
    const definition = params.fieldSchema.find((field) => field.location === 'field' && field.key === key);
    if (!definition && params.schemaMode !== 'loose') {
      throw new AppError(400, 'UNKNOWN_FIELD', `Unknown logging field filter: ${key}`);
    }
    const type = definition?.type ?? inferFilterType(filter.value);
    addFieldFilter(where, queryParams, i, key, type, filter.op, filter.value);
    i += 1;
  }
  if (cursor) {
    where.push('(Timestamp, EventId) < ({cursorTimestamp: DateTime64(3)}, {cursorEventId: UUID})');
    queryParams.cursorTimestamp = normalizeDateTime(cursor.timestamp);
    queryParams.cursorEventId = cursor.eventId;
  }

  const limit = params.query.limit + 1;
  queryParams.limit = limit;
  return {
    query: `
      SELECT
        toString(EventId) AS eventId,
        toString(Timestamp) AS timestamp,
        toString(IngestedAt) AS ingestedAt,
        toString(EnvironmentId) AS environmentId,
        Severity AS severity,
        Message AS message,
        Service AS service,
        Source AS source,
        TraceId AS traceId,
        SpanId AS spanId,
        RequestId AS requestId,
        Labels AS labels,
        FieldStrings AS fieldStrings,
        FieldNumbers AS fieldNumbers,
        FieldBooleans AS fieldBooleans,
        FieldDatetimes AS fieldDatetimes,
        FieldsJson AS fieldsJson
      FROM ${tableName}
      WHERE ${where.join(' AND ')}
      ORDER BY Timestamp DESC, EventId DESC
      LIMIT {limit: UInt32}
    `,
    queryParams,
  };
}

function addFieldFilter(
  where: string[],
  queryParams: Record<string, unknown>,
  index: number,
  key: string,
  type: string,
  op: string,
  value: unknown
): void {
  const keyName = `fieldKey${index}`;
  const valueName = `fieldValue${index}`;
  queryParams[keyName] = key;
  if (type === 'json') throw new AppError(400, 'UNSUPPORTED_FIELD_FILTER', 'JSON fields are not filterable');
  if (type === 'string') {
    if (op === 'contains') {
      where.push(`positionCaseInsensitive(FieldStrings[{${keyName}: String}], {${valueName}: String}) > 0`);
    } else if (op === 'eq') {
      where.push(`FieldStrings[{${keyName}: String}] = {${valueName}: String}`);
    } else {
      throw new AppError(400, 'INVALID_FIELD_OPERATOR', 'Invalid string field operator');
    }
    queryParams[valueName] = String(value);
    return;
  }
  if (type === 'number') {
    const opSql = opToSql(op, ['eq', 'gt', 'gte', 'lt', 'lte']);
    where.push(`FieldNumbers[{${keyName}: String}] ${opSql} {${valueName}: Float64}`);
    queryParams[valueName] = Number(value);
    return;
  }
  if (type === 'boolean') {
    if (op !== 'eq') throw new AppError(400, 'INVALID_FIELD_OPERATOR', 'Invalid boolean field operator');
    where.push(`FieldBooleans[{${keyName}: String}] = {${valueName}: UInt8}`);
    queryParams[valueName] = value === true ? 1 : 0;
    return;
  }
  if (type === 'datetime') {
    const opSql = opToSql(op, ['eq', 'gt', 'gte', 'lt', 'lte']);
    where.push(`FieldDatetimes[{${keyName}: String}] ${opSql} {${valueName}: DateTime64(3)}`);
    queryParams[valueName] = normalizeDateTime(String(value));
  }
}

function opToSql(op: string, allowed: string[]): string {
  if (!allowed.includes(op)) throw new AppError(400, 'INVALID_FIELD_OPERATOR', 'Invalid field operator');
  return ({ eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' } as Record<string, string>)[op]!;
}

function inferFilterType(value: unknown): 'string' | 'number' | 'boolean' {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

function normalizeDateTime(value: string): string {
  return new Date(value).toISOString().replace('T', ' ').replace('Z', '');
}
