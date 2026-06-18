import { AppError } from '@/middleware/error-handler.js';

const POSTGRES_CASTABLE_DATA_TYPES = new Set([
  'smallint',
  'integer',
  'bigint',
  'numeric',
  'real',
  'double precision',
  'boolean',
  'date',
  'time without time zone',
  'time with time zone',
  'timestamp without time zone',
  'timestamp with time zone',
  'uuid',
  'json',
  'jsonb',
  'bytea',
  'inet',
  'cidr',
  'macaddr',
  'xml',
]);

export interface PostgresColumnTypeMeta {
  dataType: string;
  udtName: string;
  udtSchema?: string;
}

function normalizeDatabaseTypeName(typeName: string) {
  return typeName.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function quoteIdent(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(identifier)) {
    throw new AppError(400, 'INVALID_IDENTIFIER', `Invalid identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function postgresParameterCastSql(column: PostgresColumnTypeMeta): string | null {
  const normalizedDataType = normalizeDatabaseTypeName(column.dataType);
  if (normalizedDataType === 'user-defined') {
    if (!column.udtName) return null;
    const schemaPrefix = column.udtSchema ? `${quoteIdent(column.udtSchema)}.` : '';
    return `${schemaPrefix}${quoteIdent(column.udtName)}`;
  }
  if (normalizedDataType === 'array') {
    if (!column.udtName) return null;
    const elementType = column.udtName.startsWith('_') ? column.udtName.slice(1) : column.udtName;
    if (!elementType) return null;
    const schemaPrefix = column.udtSchema ? `${quoteIdent(column.udtSchema)}.` : '';
    return `${schemaPrefix}${quoteIdent(elementType)}[]`;
  }
  return POSTGRES_CASTABLE_DATA_TYPES.has(normalizedDataType) ? normalizedDataType : null;
}

export function postgresParameterSql(index: number, column: PostgresColumnTypeMeta) {
  const castSql = postgresParameterCastSql(column);
  return castSql ? `$${index}::${castSql}` : `$${index}`;
}
