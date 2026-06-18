import { AppError } from '@/middleware/error-handler.js';

export type DatabaseType = 'postgres' | 'redis';
export type DatabaseOperation = 'connect' | 'query';

const DATABASE_CONNECTIVITY_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EPIPE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const POSTGRES_CONNECTIVITY_CODES = new Set(['3D000']);
const POSTGRES_QUERY_CODES = new Set(['22007', '22P02', '42601', '42703', '42883', '42P01']);
const POSTGRES_QUERY_CODE_PREFIXES = ['22', '23'];
const POSTGRES_QUERY_MESSAGE_PATTERNS = [
  /invalid input/i,
  /syntax error/i,
  /violates .* constraint/i,
  /duplicate key/i,
  /null value .* violates/i,
  /does not exist/i,
  /cannot cast/i,
  /malformed/i,
];
const REDIS_QUERY_MESSAGES = [/unknown command/i, /wrong number of arguments/i, /wrongtype/i];

export function mapDatabaseDriverError(
  error: unknown,
  provider: DatabaseType,
  operation: DatabaseOperation
): AppError | null {
  if (error instanceof AppError) return error;
  if (!(error instanceof Error)) return null;

  const driverError = error as Error & {
    code?: string;
    errno?: string | number;
    severity?: string;
    detail?: string;
    schema?: string;
    table?: string;
    column?: string;
  };
  const code =
    typeof driverError.code === 'string'
      ? driverError.code
      : typeof driverError.errno === 'string'
        ? driverError.errno
        : undefined;
  const message = driverError.message || `${provider} ${operation} failed`;
  const lowerMessage = message.toLowerCase();

  if (
    (provider === 'postgres' &&
      (code === '28P01' ||
        lowerMessage.includes('password authentication failed') ||
        lowerMessage.includes('no pg_hba.conf entry'))) ||
    (provider === 'redis' &&
      (lowerMessage.includes('wrongpass') ||
        lowerMessage.includes('authentication required') ||
        lowerMessage.includes('invalid username-password') ||
        lowerMessage.includes('auth <password> called without any password configured') ||
        lowerMessage.includes('noauth')))
  ) {
    return new AppError(401, 'DATABASE_AUTH_FAILED', message);
  }

  if (
    DATABASE_CONNECTIVITY_ERROR_CODES.has(code ?? '') ||
    (provider === 'postgres' && POSTGRES_CONNECTIVITY_CODES.has(code ?? '')) ||
    lowerMessage.includes('database does not exist') ||
    lowerMessage.includes('getaddrinfo') ||
    lowerMessage.includes('connect timeout') ||
    lowerMessage.includes('connection terminated unexpectedly') ||
    lowerMessage.includes('server does not support ssl') ||
    lowerMessage.includes('self signed certificate') ||
    lowerMessage.includes('certificate has expired') ||
    lowerMessage.includes('unable to verify the first certificate') ||
    lowerMessage.includes('connection is closed')
  ) {
    return new AppError(422, 'DATABASE_CONNECTION_FAILED', message);
  }

  if (
    operation === 'query' &&
    ((provider === 'postgres' && POSTGRES_QUERY_CODES.has(code ?? '')) ||
      (provider === 'redis' && REDIS_QUERY_MESSAGES.some((pattern) => pattern.test(message))))
  ) {
    return new AppError(400, 'DATABASE_QUERY_FAILED', message);
  }

  if (
    operation === 'query' &&
    provider === 'postgres' &&
    ((typeof code === 'string' && POSTGRES_QUERY_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))) ||
      ((typeof driverError.severity === 'string' ||
        typeof driverError.detail === 'string' ||
        typeof driverError.schema === 'string' ||
        typeof driverError.table === 'string' ||
        typeof driverError.column === 'string') &&
        POSTGRES_QUERY_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))))
  ) {
    return new AppError(400, 'DATABASE_QUERY_FAILED', message);
  }

  return null;
}
