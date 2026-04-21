import { describe, expect, it } from 'vitest';
import { AppError } from '@/middleware/error-handler.js';
import { mapDatabaseDriverError } from './databases.service.js';

describe('mapDatabaseDriverError', () => {
  it('maps postgres authentication failures to 401', () => {
    const error = Object.assign(new Error('password authentication failed for user "doadmin"'), {
      code: '28P01',
    });
    const mapped = mapDatabaseDriverError(error, 'postgres', 'connect');

    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped?.statusCode).toBe(401);
    expect(mapped?.code).toBe('DATABASE_AUTH_FAILED');
  });

  it('maps redis authentication failures to 401', () => {
    const error = new Error('WRONGPASS invalid username-password pair or user is disabled.');
    const mapped = mapDatabaseDriverError(error, 'redis', 'connect');

    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped?.statusCode).toBe(401);
    expect(mapped?.code).toBe('DATABASE_AUTH_FAILED');
  });

  it('maps network and connectivity failures to 422', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    });
    const mapped = mapDatabaseDriverError(error, 'postgres', 'connect');

    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped?.statusCode).toBe(422);
    expect(mapped?.code).toBe('DATABASE_CONNECTION_FAILED');
  });

  it('maps postgres query syntax errors to 400', () => {
    const error = Object.assign(new Error('syntax error at or near "FROM"'), {
      code: '42601',
    });
    const mapped = mapDatabaseDriverError(error, 'postgres', 'query');

    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped?.statusCode).toBe(400);
    expect(mapped?.code).toBe('DATABASE_QUERY_FAILED');
  });

  it('returns null for unknown errors', () => {
    const mapped = mapDatabaseDriverError(new Error('unexpected socket blowup'), 'postgres', 'connect');
    expect(mapped).toBeNull();
  });
});
