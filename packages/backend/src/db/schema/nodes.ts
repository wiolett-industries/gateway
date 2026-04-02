import { boolean, index, jsonb, pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const nodeTypeEnum = pgEnum('node_type', ['nginx', 'bastion', 'monitoring']);
export const nodeStatusEnum = pgEnum('node_status', ['pending', 'online', 'offline', 'error']);

export interface NodeCapabilities {
  nginxVersion?: string;
  configDir?: string;
  daemonType?: string;
  [key: string]: unknown;
}

export interface NodeHealthReport {
  nginxRunning: boolean;
  configValid: boolean;
  nginxUptimeSeconds: number;
  workerCount: number;
  nginxVersion: string;
  cpuPercent: number;
  memoryBytes: number;
  diskFreeBytes: number;
  timestamp: number;
  // System
  loadAverage1m: number;
  loadAverage5m: number;
  loadAverage15m: number;
  systemMemoryTotalBytes: number;
  systemMemoryUsedBytes: number;
  systemMemoryAvailableBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  systemUptimeSeconds: number;
  openFileDescriptors: number;
  maxFileDescriptors: number;
  // Disk
  diskMounts: Array<{
    mountPoint: string;
    filesystem: string;
    device: string;
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
  }>;
  diskReadBytes: number;
  diskWriteBytes: number;
  // Network
  networkInterfaces: Array<{
    name: string;
    rxBytes: number;
    txBytes: number;
    rxPackets: number;
    txPackets: number;
    rxErrors: number;
    txErrors: number;
  }>;
  // Nginx
  nginxRssBytes: number;
  errorRate4xx: number;
  errorRate5xx: number;
}

export interface NodeStatsReport {
  activeConnections: number;
  accepts: number;
  handled: number;
  requests: number;
  reading: number;
  writing: number;
  waiting: number;
  timestamp: number;
}

export const nodes = pgTable(
  'nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: nodeTypeEnum('type').notNull().default('nginx'),
    hostname: varchar('hostname', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }),
    status: nodeStatusEnum('status').notNull().default('pending'),

    // Enrollment
    enrollmentTokenHash: varchar('enrollment_token_hash', { length: 255 }),
    certificateSerial: varchar('certificate_serial', { length: 255 }),
    certificateExpiresAt: timestamp('certificate_expires_at', { withTimezone: true }),

    // Daemon info
    daemonVersion: varchar('daemon_version', { length: 50 }),
    osInfo: varchar('os_info', { length: 255 }),
    configVersionHash: varchar('config_version_hash', { length: 64 }),

    // Type-specific capabilities (e.g. { nginxVersion, configDir })
    capabilities: jsonb('capabilities').$type<NodeCapabilities>().default({}),

    // Latest reports
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastHealthReport: jsonb('last_health_report').$type<NodeHealthReport>(),
    lastStatsReport: jsonb('last_stats_report').$type<NodeStatsReport>(),

    // Hourly health history ring buffer (max 168 entries = 7 days)
    healthHistory: jsonb('health_history').$type<Array<{ hour: string; healthy: boolean }>>().default([]),

    // Extensible metadata
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

    // Default node for new proxy hosts
    isDefault: boolean('is_default').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    typeIdx: index('node_type_idx').on(table.type),
    statusIdx: index('node_status_idx').on(table.status),
    hostnameIdx: index('node_hostname_idx').on(table.hostname),
  })
);
