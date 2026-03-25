import { z } from 'zod';

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // OIDC
  OIDC_ISSUER: z.string().url(),
  OIDC_CLIENT_ID: z.string(),
  OIDC_CLIENT_SECRET: z.string(),
  OIDC_REDIRECT_URI: z.string().url(),
  OIDC_SCOPES: z.string().default('openid email profile'),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(500),

  // Session
  SESSION_SECRET: z.string().min(32),
  SESSION_EXPIRY: z.coerce.number().default(2592000), // 30 days

  // App
  APP_URL: z.string().url().default('http://localhost:3000'),

  // PKI Master Key — 32 bytes as 64-char hex string for envelope encryption
  PKI_MASTER_KEY: z
    .string()
    .min(64)
    .regex(/^[0-9a-fA-F]+$/),

  // PKI defaults
  DEFAULT_CRL_VALIDITY_HOURS: z.coerce.number().default(24),
  DEFAULT_OCSP_VALIDITY_MINUTES: z.coerce.number().default(60),
  EXPIRY_WARNING_DAYS: z.coerce.number().default(30),
  EXPIRY_CRITICAL_DAYS: z.coerce.number().default(7),

  // ACME
  ACME_EMAIL: z.string().email().default('admin@example.com'),
  ACME_STAGING: z.coerce.boolean().default(false),

  // Background Jobs
  HEALTH_CHECK_INTERVAL_SECONDS: z.coerce.number().default(30),
  ACME_RENEWAL_CRON: z.string().default('0 3 * * *'), // 3 AM daily
  EXPIRY_CHECK_CRON: z.string().default('0 6 * * *'), // 6 AM daily

  // Nginx
  NGINX_CONFIG_PATH: z.string().default('/etc/nginx-config'),
  NGINX_CERTS_PATH: z.string().default('/etc/nginx-certs'),
  NGINX_LOGS_PATH: z.string().default('/var/log/nginx-logs'),
  ACME_CHALLENGE_PATH: z.string().default('/var/www/acme-challenge'),
  DOCKER_SOCKET_PATH: z.string().default('/var/run/docker.sock'),
  NGINX_CONTAINER_NAME: z.string().default('gateway-nginx-1'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    throw new Error('Invalid environment variables');
  }

  cachedEnv = result.data;
  return cachedEnv;
}

export function isDevelopment(): boolean {
  return getEnv().NODE_ENV === 'development';
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production';
}

export function isTest(): boolean {
  return getEnv().NODE_ENV === 'test';
}
