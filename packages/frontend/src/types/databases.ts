// Databases
export type DatabaseType = "postgres" | "redis";
export type DatabaseHealthStatus = "online" | "offline" | "degraded" | "unknown";

export interface DatabaseHealthEntry {
  ts: string;
  status: DatabaseHealthStatus;
  responseMs?: number;
  slow?: boolean;
}

export interface PostgresDatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslEnabled: boolean;
}

export interface RedisDatabaseConfig {
  host: string;
  port: number;
  username: string | null;
  password: string;
  db: number;
  tlsEnabled: boolean;
}

export interface DatabaseConnection {
  id: string;
  name: string;
  type: DatabaseType;
  description: string | null;
  tags: string[];
  manualSizeLimitMb: number | null;
  host: string;
  port: number;
  databaseName: string | null;
  username: string | null;
  tlsEnabled: boolean;
  healthStatus: DatabaseHealthStatus;
  lastHealthCheckAt: string | null;
  lastError: string | null;
  healthHistory?: DatabaseHealthEntry[];
  folderId?: string | null;
  sortOrder?: number;
  hasStoredPassword: boolean;
  config: PostgresDatabaseConfig | RedisDatabaseConfig;
  createdById: string;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseMetricSnapshot {
  timestamp: string;
  databaseId: string;
  type: DatabaseType;
  name: string;
  status: DatabaseHealthStatus;
  responseMs: number;
  metrics: Record<string, number | null>;
}

export interface PostgresTableColumn {
  name: string;
  dataType: string;
  udtName: string;
  udtSchema: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  hasDefault: boolean;
}

export interface PostgresTableMetadata {
  schema: string;
  table: string;
  columns: PostgresTableColumn[];
  primaryKey: string[];
  hasPrimaryKey: boolean;
}

export interface RedisKeyRecord {
  key: string;
  type: string;
  ttlSeconds: number;
}
