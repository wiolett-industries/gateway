import type { LoggingFieldDefinition } from '@/db/schema/index.js';
import { AppError } from '@/middleware/error-handler.js';
import { type LoggingSearchExpression, type LoggingSearchRequest, SEVERITY_NUMBER } from './logging-storage.types.js';

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
  const paramIndex = { value: 1000 };
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
    where.push(buildMessageClause('Message', 'message', params.query.messageMatch ?? 'contains'));
    queryParams.message = params.query.message;
  }
  if (params.query.expression) {
    where.push(
      buildExpressionClause({
        expression: params.query.expression,
        queryParams,
        index: paramIndex,
        fieldSchema: params.fieldSchema,
        schemaMode: params.schemaMode,
      })
    );
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

function buildExpressionClause(params: {
  expression: LoggingSearchExpression;
  queryParams: Record<string, unknown>;
  index: { value: number };
  fieldSchema: LoggingFieldDefinition[];
  schemaMode: 'loose' | 'strip' | 'reject';
}): string {
  const { expression, queryParams, index, fieldSchema, schemaMode } = params;
  if (expression.type === 'and' || expression.type === 'or') {
    const children = expression.children
      .map((child) => buildExpressionClause({ expression: child, queryParams, index, fieldSchema, schemaMode }))
      .filter(Boolean);
    if (children.length === 0) return '1';
    return `(${children.join(expression.type === 'and' ? ' AND ' : ' OR ')})`;
  }
  if (expression.type === 'not') {
    return `(NOT ${buildExpressionClause({ expression: expression.child, queryParams, index, fieldSchema, schemaMode })})`;
  }
  const id = index.value++;
  if (expression.type === 'text') {
    const valueName = `exprText${id}`;
    queryParams[valueName] = expression.value;
    return buildMessageClause('Message', valueName, expression.match ?? 'contains');
  }
  if (expression.type === 'label') {
    const keyName = `exprLabelKey${id}`;
    const valueName = `exprLabelValue${id}`;
    queryParams[keyName] = expression.key;
    if (expression.op === 'exists') return `mapContains(Labels, {${keyName}: String})`;
    queryParams[valueName] = expression.value ?? '';
    const comparison = expression.op === 'neq' ? '!=' : '=';
    return `(mapContains(Labels, {${keyName}: String}) AND Labels[{${keyName}: String}] ${comparison} {${valueName}: String})`;
  }
  if (expression.type === 'field') {
    const definition = fieldSchema.find((field) => field.location === 'field' && field.key === expression.key);
    if (!definition && schemaMode !== 'loose') {
      throw new AppError(400, 'UNKNOWN_FIELD', `Unknown logging field filter: ${expression.key}`);
    }
    const bucket: string[] = [];
    addFieldFilter(
      bucket,
      queryParams,
      id,
      expression.key,
      definition?.type ?? inferFilterType(expression.value),
      expression.op,
      expression.value
    );
    return bucket[0] ?? '1';
  }
  if (expression.type === 'severity') {
    const valueName = `exprSeverity${id}`;
    if (expression.op === 'eq') {
      queryParams[valueName] = expression.value;
      return `Severity = {${valueName}: String}`;
    }
    queryParams[valueName] = SEVERITY_NUMBER[expression.value];
    return `SeverityNumber ${opToSql(expression.op, ['gt', 'gte', 'lt', 'lte'])} {${valueName}: UInt8}`;
  }
  if (
    expression.type === 'service' ||
    expression.type === 'source' ||
    expression.type === 'traceId' ||
    expression.type === 'spanId' ||
    expression.type === 'requestId'
  ) {
    const valueName = `exprAttr${id}`;
    queryParams[valueName] = expression.value;
    const column = expressionColumn(expression.type);
    return `${column} ${expression.op === 'neq' ? '!=' : '='} {${valueName}: String}`;
  }
  throw new AppError(400, 'INVALID_LOGGING_QUERY', 'Invalid logging search expression');
}

function expressionColumn(type: 'service' | 'source' | 'traceId' | 'spanId' | 'requestId'): string {
  return (
    {
      service: 'Service',
      source: 'Source',
      traceId: 'TraceId',
      spanId: 'SpanId',
      requestId: 'RequestId',
    } as const
  )[type];
}

function buildMessageClause(column: string, valueName: string, match: 'contains' | 'startsWith' | 'endsWith'): string {
  if (match === 'startsWith') return `startsWith(lower(${column}), lower({${valueName}: String}))`;
  if (match === 'endsWith') return `endsWith(lower(${column}), lower({${valueName}: String}))`;
  return `positionCaseInsensitive(${column}, {${valueName}: String}) > 0`;
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
    } else if (op === 'neq') {
      where.push(`FieldStrings[{${keyName}: String}] != {${valueName}: String}`);
    } else {
      throw new AppError(400, 'INVALID_FIELD_OPERATOR', 'Invalid string field operator');
    }
    queryParams[valueName] = String(value);
    return;
  }
  if (type === 'number') {
    const opSql = opToSql(op, ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']);
    where.push(`FieldNumbers[{${keyName}: String}] ${opSql} {${valueName}: Float64}`);
    queryParams[valueName] = Number(value);
    return;
  }
  if (type === 'boolean') {
    if (op !== 'eq' && op !== 'neq')
      throw new AppError(400, 'INVALID_FIELD_OPERATOR', 'Invalid boolean field operator');
    where.push(`FieldBooleans[{${keyName}: String}] ${op === 'neq' ? '!=' : '='} {${valueName}: UInt8}`);
    queryParams[valueName] = value === true ? 1 : 0;
    return;
  }
  if (type === 'datetime') {
    const opSql = opToSql(op, ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']);
    where.push(`FieldDatetimes[{${keyName}: String}] ${opSql} {${valueName}: DateTime64(3)}`);
    queryParams[valueName] = normalizeDateTime(String(value));
  }
}

function opToSql(op: string, allowed: string[]): string {
  if (!allowed.includes(op)) throw new AppError(400, 'INVALID_FIELD_OPERATOR', 'Invalid field operator');
  return ({ eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' } as Record<string, string>)[op]!;
}

function inferFilterType(value: unknown): 'string' | 'number' | 'boolean' {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

function normalizeDateTime(value: string): string {
  return new Date(value).toISOString().replace('T', ' ').replace('Z', '');
}
