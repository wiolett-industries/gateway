import type pg from 'pg';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type { DatabaseOperation } from './database-error-mapping.js';
import { postgresParameterSql, quoteIdent } from './postgres-row-sql.js';

export interface PostgresTableMetadata {
  schema: string;
  table: string;
  columns: Array<{
    name: string;
    dataType: string;
    udtName: string;
    udtSchema: string;
    nullable: boolean;
    isPrimaryKey: boolean;
    hasDefault: boolean;
  }>;
  primaryKey: string[];
  hasPrimaryKey: boolean;
}

export interface PostgresRowOperationContext {
  withPostgresPool<T>(id: string, operation: DatabaseOperation, fn: (pool: pg.Pool) => Promise<T>): Promise<T>;
  getPostgresTableMetadata(id: string, schema: string, table: string): Promise<PostgresTableMetadata>;
  auditLog: AuditService['log'];
  emitChange(id: string, action: string, extra?: Record<string, unknown>): void;
}

export async function insertPostgresRow(
  context: PostgresRowOperationContext,
  id: string,
  schema: string,
  table: string,
  values: Record<string, unknown>,
  userId: string
) {
  return context.withPostgresPool(id, 'query', async (pool) => {
    const metadata = await context.getPostgresTableMetadata(id, schema, table);
    const columnByName = new Map(metadata.columns.map((column) => [column.name, column]));
    const allowedColumns = metadata.columns.map((column) => column.name).filter((name) => name in values);
    if (allowedColumns.length === 0) {
      throw new AppError(400, 'INVALID_ROW', 'At least one column value is required');
    }

    const params = allowedColumns.map((column) => values[column]);
    const schemaSql = quoteIdent(schema);
    const tableSql = quoteIdent(table);
    const sql = `insert into ${schemaSql}.${tableSql} (${allowedColumns.map(quoteIdent).join(', ')})
        values (${allowedColumns
          .map((column, index) => postgresParameterSql(index + 1, columnByName.get(column)!))
          .join(', ')})
        returning *`;
    const result = await pool.query(sql, params);
    await context.auditLog({
      userId,
      action: 'database.postgres.row.insert',
      resourceType: 'database',
      resourceId: id,
      details: { schema, table, columns: allowedColumns },
    });
    context.emitChange(id, 'data.updated', { provider: 'postgres', schema, table });
    return result.rows[0] ?? null;
  });
}

export async function updatePostgresRow(
  context: PostgresRowOperationContext,
  id: string,
  schema: string,
  table: string,
  primaryKey: Record<string, unknown>,
  values: Record<string, unknown>,
  userId: string
) {
  return context.withPostgresPool(id, 'query', async (pool) => {
    const metadata = await context.getPostgresTableMetadata(id, schema, table);
    const columnByName = new Map(metadata.columns.map((column) => [column.name, column]));
    if (!metadata.hasPrimaryKey) {
      throw new AppError(400, 'PRIMARY_KEY_REQUIRED', 'Row updates require a primary key');
    }

    const keyColumns = metadata.primaryKey;
    for (const keyColumn of keyColumns) {
      if (!(keyColumn in primaryKey)) {
        throw new AppError(400, 'PRIMARY_KEY_REQUIRED', `Missing primary key column "${keyColumn}"`);
      }
    }

    const updateColumns = metadata.columns
      .map((column) => column.name)
      .filter((column) => column in values && !keyColumns.includes(column));
    if (updateColumns.length === 0) {
      throw new AppError(400, 'INVALID_ROW', 'No editable columns provided');
    }

    const params = [
      ...updateColumns.map((column) => values[column]),
      ...keyColumns.map((column) => primaryKey[column]),
    ];
    const setSql = updateColumns
      .map((column, index) => `${quoteIdent(column)} = ${postgresParameterSql(index + 1, columnByName.get(column)!)}`)
      .join(', ');
    const whereSql = keyColumns
      .map(
        (column, index) =>
          `${quoteIdent(column)} = ${postgresParameterSql(updateColumns.length + index + 1, columnByName.get(column)!)}`
      )
      .join(' and ');

    const result = await pool.query(
      `update ${quoteIdent(schema)}.${quoteIdent(table)}
            set ${setSql}
          where ${whereSql}
        returning *`,
      params
    );
    await context.auditLog({
      userId,
      action: 'database.postgres.row.update',
      resourceType: 'database',
      resourceId: id,
      details: { schema, table, primaryKey: Object.keys(primaryKey), columns: updateColumns },
    });
    context.emitChange(id, 'data.updated', { provider: 'postgres', schema, table });
    return result.rows[0] ?? null;
  });
}

export async function deletePostgresRow(
  context: PostgresRowOperationContext,
  id: string,
  schema: string,
  table: string,
  primaryKey: Record<string, unknown>,
  userId: string
) {
  return context.withPostgresPool(id, 'query', async (pool) => {
    const metadata = await context.getPostgresTableMetadata(id, schema, table);
    const columnByName = new Map(metadata.columns.map((column) => [column.name, column]));
    if (!metadata.hasPrimaryKey) {
      throw new AppError(400, 'PRIMARY_KEY_REQUIRED', 'Row deletes require a primary key');
    }
    const keyColumns = metadata.primaryKey;
    for (const keyColumn of keyColumns) {
      if (!(keyColumn in primaryKey)) {
        throw new AppError(400, 'PRIMARY_KEY_REQUIRED', `Missing primary key column "${keyColumn}"`);
      }
    }
    const params = keyColumns.map((column) => primaryKey[column]);
    const whereSql = keyColumns
      .map((column, index) => `${quoteIdent(column)} = ${postgresParameterSql(index + 1, columnByName.get(column)!)}`)
      .join(' and ');
    await pool.query(`delete from ${quoteIdent(schema)}.${quoteIdent(table)} where ${whereSql}`, params);
    await context.auditLog({
      userId,
      action: 'database.postgres.row.delete',
      resourceType: 'database',
      resourceId: id,
      details: { schema, table, primaryKey: Object.keys(primaryKey) },
    });
    context.emitChange(id, 'data.updated', { provider: 'postgres', schema, table });
    return { success: true };
  });
}
