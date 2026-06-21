import type pg from 'pg';
import { AppError } from '@/middleware/error-handler.js';

const POSTGRES_COLUMN_TYPE_SQL = new Map<string, string>([
  ['text', 'text'],
  ['varchar(255)', 'varchar(255)'],
  ['varchar(1024)', 'varchar(1024)'],
  ['char(1)', 'char(1)'],
  ['boolean', 'boolean'],
  ['smallint', 'smallint'],
  ['integer', 'integer'],
  ['bigint', 'bigint'],
  ['numeric', 'numeric'],
  ['numeric(12,2)', 'numeric(12,2)'],
  ['real', 'real'],
  ['double precision', 'double precision'],
  ['date', 'date'],
  ['time', 'time'],
  ['time with time zone', 'time with time zone'],
  ['timestamp', 'timestamp'],
  ['timestamp with time zone', 'timestamp with time zone'],
  ['uuid', 'uuid'],
  ['json', 'json'],
  ['jsonb', 'jsonb'],
  ['bytea', 'bytea'],
  ['inet', 'inet'],
  ['cidr', 'cidr'],
  ['macaddr', 'macaddr'],
  ['xml', 'xml'],
]);

export function normalizePostgresColumnType(dataType: string): string {
  return dataType.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function postgresColumnTypeSql(dataType: string): string | undefined {
  return POSTGRES_COLUMN_TYPE_SQL.get(normalizePostgresColumnType(dataType));
}

export async function ensurePostgresBaseTable(pool: pg.Pool, schema: string, table: string) {
  const tableInfo = await pool.query<{ table_type: string }>(
    `select table_type
       from information_schema.tables
      where table_schema = $1 and table_name = $2`,
    [schema, table]
  );
  const tableType = tableInfo.rows[0]?.table_type;
  if (!tableType) {
    throw new AppError(404, 'TABLE_NOT_FOUND', 'Table not found');
  }
  if (tableType === 'VIEW') {
    throw new AppError(400, 'VIEW_NOT_EDITABLE', 'Columns cannot be changed for views');
  }
}
