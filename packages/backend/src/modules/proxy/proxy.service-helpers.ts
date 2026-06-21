import { getEnv } from '@/config/env.js';
import { AppError } from '@/middleware/error-handler.js';

export type HealthCheckBodyMatchMode = 'includes' | 'exact' | 'starts_with' | 'ends_with';

export type ProxyValidationOptions = {
  bypassAdvancedValidation?: boolean;
  bypassRawValidation?: boolean;
};

export type ProxyValidationInput = boolean | ProxyValidationOptions;

export interface CertPaths {
  sslCertPath: string | null;
  sslKeyPath: string | null;
  sslChainPath: string | null;
}

const STATUS_PAGE_SYSTEM_HOST_ROLLBACK_FIELDS = [
  'type',
  'domainNames',
  'enabled',
  'forwardHost',
  'forwardPort',
  'forwardScheme',
  'sslEnabled',
  'sslForced',
  'http2Support',
  'websocketSupport',
  'sslCertificateId',
  'internalCertificateId',
  'redirectUrl',
  'redirectStatusCode',
  'customHeaders',
  'cacheEnabled',
  'cacheOptions',
  'rateLimitEnabled',
  'rateLimitOptions',
  'customRewrites',
  'advancedConfig',
  'rawConfig',
  'rawConfigEnabled',
  'accessListId',
  'folderId',
  'nginxTemplateId',
  'templateVariables',
  'nodeId',
  'healthCheckEnabled',
  'healthCheckUrl',
  'healthCheckInterval',
  'healthCheckExpectedStatus',
  'healthCheckExpectedBody',
  'healthCheckBodyMatchMode',
  'healthCheckSlowThreshold',
  'healthStatus',
  'isSystem',
  'systemKind',
  'updatedAt',
] as const;

type StatusPageSystemHostRollbackField = (typeof STATUS_PAGE_SYSTEM_HOST_ROLLBACK_FIELDS)[number];

export function buildStatusPageSystemHostRollbackData(
  existing: Record<StatusPageSystemHostRollbackField, unknown>
): Record<StatusPageSystemHostRollbackField, unknown> {
  return Object.fromEntries(STATUS_PAGE_SYSTEM_HOST_ROLLBACK_FIELDS.map((field) => [field, existing[field]])) as Record<
    StatusPageSystemHostRollbackField,
    unknown
  >;
}

export function matchesExpectedBody(body: string, expectedBody: string, mode: HealthCheckBodyMatchMode): boolean {
  switch (mode) {
    case 'exact':
      return body === expectedBody;
    case 'starts_with':
      return body.startsWith(expectedBody);
    case 'ends_with':
      return body.endsWith(expectedBody);
    default:
      return body.includes(expectedBody);
  }
}

export function normalizeProxyValidationOptions(validationOptions: ProxyValidationInput = {}): ProxyValidationOptions {
  return typeof validationOptions === 'boolean'
    ? { bypassAdvancedValidation: validationOptions, bypassRawValidation: false }
    : validationOptions;
}

export function rawConfigAuditDetails(input: { rawConfig?: unknown }, options: ProxyValidationOptions) {
  if (input.rawConfig === undefined) return {};
  return {
    rawConfigChanged: true,
    rawValidationBypassed: options.bypassRawValidation === true,
  };
}

export function stripProxyHealthHistory<T extends { healthHistory?: unknown }>(host: T): Omit<T, 'healthHistory'> {
  const { healthHistory: _healthHistory, ...rest } = host;
  return rest;
}

export function getStatusPageUpstream(upstreamUrl: string | null | undefined): {
  host: string;
  port: number;
  scheme: 'http' | 'https';
} {
  const env = getEnv();
  if (!upstreamUrl) {
    return { host: '127.0.0.1', port: env.PORT, scheme: 'http' };
  }

  const url = new URL(upstreamUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError(400, 'STATUS_PAGE_UPSTREAM_INVALID', 'Status page upstream must use http or https');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new AppError(
      400,
      'STATUS_PAGE_UPSTREAM_INVALID',
      'Status page upstream must not include path, query, or hash'
    );
  }
  const scheme = url.protocol === 'https:' ? 'https' : 'http';
  const port = url.port ? Number(url.port) : scheme === 'https' ? 443 : 80;
  return { host: url.hostname, port, scheme };
}

export const __testOnly = {
  buildStatusPageSystemHostRollbackData,
  getStatusPageUpstream,
  matchesExpectedBody,
  normalizeProxyValidationOptions,
  rawConfigAuditDetails,
  stripProxyHealthHistory,
};
