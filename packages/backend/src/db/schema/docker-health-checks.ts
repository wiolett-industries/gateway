import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { dockerDeployments } from './docker-deployments.js';
import { nodes } from './nodes.js';

export type DockerHealthCheckTarget = 'container' | 'deployment';
export type DockerHealthStatus = 'online' | 'offline' | 'degraded' | 'unknown' | 'disabled';
export type DockerHealthCheckBodyMatchMode = 'includes' | 'exact' | 'starts_with' | 'ends_with';

const dockerHealthStatusEnum = pgEnum('health_status', ['online', 'offline', 'degraded', 'unknown', 'disabled']);
const dockerHealthCheckBodyMatchModeEnum = pgEnum('health_check_body_match_mode', [
  'includes',
  'exact',
  'starts_with',
  'ends_with',
]);

export interface DockerHealthEntry {
  ts: string;
  status: DockerHealthStatus;
  responseMs?: number;
  slow?: boolean;
}

export const dockerHealthChecks = pgTable(
  'docker_health_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    target: text('target').$type<DockerHealthCheckTarget>().notNull(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    containerName: text('container_name'),
    deploymentId: uuid('deployment_id').references(() => dockerDeployments.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    scheme: text('scheme').$type<'http' | 'https'>().notNull().default('http'),
    hostPort: integer('host_port'),
    containerPort: integer('container_port'),
    path: text('path').notNull().default('/'),
    statusMin: integer('status_min').notNull().default(200),
    statusMax: integer('status_max').notNull().default(399),
    expectedBody: text('expected_body'),
    bodyMatchMode: dockerHealthCheckBodyMatchModeEnum('body_match_mode').notNull().default('includes'),
    intervalSeconds: integer('interval_seconds').notNull().default(30),
    timeoutSeconds: integer('timeout_seconds').notNull().default(5),
    slowThreshold: integer('slow_threshold').notNull().default(1000),
    healthStatus: dockerHealthStatusEnum('health_status').notNull().default('unknown'),
    lastHealthCheckAt: timestamp('last_health_check_at', { withTimezone: true }),
    healthHistory: jsonb('health_history').$type<DockerHealthEntry[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('docker_health_checks_container_unique').on(table.nodeId, table.containerName),
    unique('docker_health_checks_deployment_unique').on(table.deploymentId),
    index('docker_health_checks_node_idx').on(table.nodeId),
    index('docker_health_checks_due_idx').on(table.enabled, table.lastHealthCheckAt),
  ]
);
