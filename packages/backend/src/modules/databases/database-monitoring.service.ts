import { EventEmitter } from 'node:events';
import { createChildLogger } from '@/lib/logger.js';
import type { NotificationEvaluatorService } from '@/modules/notifications/notification-evaluator.service.js';
import type { CacheService } from '@/services/cache.service.js';
import type {
  DatabaseConnectionConfig,
  DatabaseConnectionService,
  DatabaseHealthStatus,
  DatabaseType,
} from './databases.service.js';

const logger = createChildLogger('DatabaseMonitoringService');

const HISTORY_PREFIX = 'database-monitoring:';
const HISTORY_MAX = 60;
const HISTORY_TTL_SECONDS = 600;

export interface DatabaseMetricSnapshot {
  timestamp: string;
  databaseId: string;
  type: DatabaseType;
  name: string;
  status: DatabaseHealthStatus;
  responseMs: number;
  metrics: Record<string, number | null>;
}

export class DatabaseMonitoringService extends EventEmitter {
  private evaluator?: NotificationEvaluatorService;
  private readonly clientCounts = new Map<string, number>();
  private readonly pollIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private backgroundInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly databaseService: DatabaseConnectionService,
    private readonly cacheService: CacheService | null
  ) {
    super();
    this.setMaxListeners(100);
    this.startBackgroundPolling();
  }

  setEvaluator(evaluator: NotificationEvaluatorService) {
    this.evaluator = evaluator;
  }

  async getHistory(databaseId: string): Promise<DatabaseMetricSnapshot[]> {
    if (!this.cacheService) return [];
    try {
      const raw = await this.cacheService.getClient().lrange(HISTORY_PREFIX + databaseId, 0, -1);
      return raw.map((entry) => JSON.parse(entry) as DatabaseMetricSnapshot).reverse();
    } catch {
      return [];
    }
  }

  registerClient(databaseId: string): void {
    const count = (this.clientCounts.get(databaseId) ?? 0) + 1;
    this.clientCounts.set(databaseId, count);
    if (count === 1) this.startPolling(databaseId);
  }

  unregisterClient(databaseId: string): void {
    const count = Math.max(0, (this.clientCounts.get(databaseId) ?? 0) - 1);
    this.clientCounts.set(databaseId, count);
    if (count === 0) this.stopPolling(databaseId);
  }

  destroy(): void {
    if (this.backgroundInterval) clearInterval(this.backgroundInterval);
    for (const interval of this.pollIntervals.values()) clearInterval(interval);
    this.pollIntervals.clear();
  }

  private startBackgroundPolling() {
    setTimeout(() => {
      this.backgroundInterval = setInterval(() => {
        this.databaseService
          .listAllRows()
          .then((rows) => {
            for (const row of rows) {
              if (this.pollIntervals.has(row.id)) continue;
              void this.pollOnce(row.id);
            }
          })
          .catch((error) => {
            logger.warn('Background database polling failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }, 10_000);
    }, 5000);
  }

  private startPolling(databaseId: string) {
    if (this.pollIntervals.has(databaseId)) return;
    void this.pollOnce(databaseId);
    this.pollIntervals.set(
      databaseId,
      setInterval(() => void this.pollOnce(databaseId), 5000)
    );
  }

  private stopPolling(databaseId: string) {
    const interval = this.pollIntervals.get(databaseId);
    if (!interval) return;
    clearInterval(interval);
    this.pollIntervals.delete(databaseId);
  }

  private async pollOnce(databaseId: string) {
    try {
      const connection = await this.databaseService.get(databaseId);
      const config = await this.databaseService.getDecryptedConfig(databaseId);
      const snapshot =
        config.type === 'postgres'
          ? await this.collectPostgresSnapshot(databaseId, connection.name)
          : await this.collectRedisSnapshot(databaseId, connection.name, config);

      await this.pushHistory(snapshot);
      await this.databaseService.updateHealth(databaseId, {
        status: snapshot.status,
        responseMs: snapshot.responseMs,
        lastError: snapshot.status === 'offline' ? 'Database is unreachable' : null,
      });
      await this.evaluator?.evaluateDatabaseSnapshot(snapshot);
      await this.evaluator?.observeStatefulEvent(
        snapshot.type === 'postgres' ? 'database_postgres' : 'database_redis',
        snapshot.status === 'online'
          ? 'health.online'
          : snapshot.status === 'degraded'
            ? 'health.degraded'
            : 'health.offline',
        { type: 'database', id: databaseId, name: connection.name },
        { health_status: snapshot.status }
      );
      this.emit('snapshot', { databaseId, snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Monitoring failed';
      logger.debug('Database monitoring poll failed', { databaseId, error: message });
      const connection = await this.databaseService.get(databaseId).catch(() => null);
      await this.databaseService.updateHealth(databaseId, {
        status: 'offline',
        lastError: message,
        forceHistory: true,
      });
      if (connection) {
        await this.evaluator?.observeStatefulEvent(
          connection.type === 'postgres' ? 'database_postgres' : 'database_redis',
          'health.offline',
          { type: 'database', id: databaseId, name: connection.name },
          { health_status: 'offline', error: message }
        );
      }
    }
  }

  private async pushHistory(snapshot: DatabaseMetricSnapshot) {
    if (!this.cacheService) return;
    const client = this.cacheService.getClient();
    const key = HISTORY_PREFIX + snapshot.databaseId;
    await client.lpush(key, JSON.stringify(snapshot));
    await client.ltrim(key, 0, HISTORY_MAX - 1);
    await client.expire(key, HISTORY_TTL_SECONDS);
  }

  private async getLatestSnapshot(databaseId: string): Promise<DatabaseMetricSnapshot | null> {
    const history = await this.getHistory(databaseId);
    return history.at(-1) ?? null;
  }

  private async collectPostgresSnapshot(databaseId: string, name: string): Promise<DatabaseMetricSnapshot> {
    const pool = await this.databaseService.getPostgresPool(databaseId);
    const started = Date.now();
    const previousSnapshot = await this.getLatestSnapshot(databaseId);
    const [pingResult, statsResult, dbSizeResult, lockResult, bgwriterResult] = await Promise.all([
      pool.query('select 1'),
      pool.query<{
        active_connections: string;
        total_connections: string;
        max_connections: string;
        long_running_queries: string;
        idle_connections: string;
      }>(
        `select
           sum(case when state = 'active' then 1 else 0 end)::text as active_connections,
           sum(case when state = 'idle' then 1 else 0 end)::text as idle_connections,
           count(*)::text as total_connections,
           sum(case when state = 'active' and now() - query_start > interval '1 minute' then 1 else 0 end)::text as long_running_queries,
           current_setting('max_connections')::text as max_connections
         from pg_stat_activity
        where datname = current_database()`
      ),
      pool.query<{
        database_size: string;
        xact_commit: string;
        xact_rollback: string;
        blks_read: string;
        blks_hit: string;
      }>(
        `select
           pg_database_size(current_database())::text as database_size,
           xact_commit::text as xact_commit,
           xact_rollback::text as xact_rollback,
           blks_read::text as blks_read,
           blks_hit::text as blks_hit
         from pg_stat_database
        where datname = current_database()`
      ),
      pool.query<{ lock_count: string }>(
        `select count(*)::text as lock_count
         from pg_locks l
         join pg_database d on d.oid = l.database
        where d.datname = current_database()`
      ),
      pool.query<{ blocks_written: string }>(
        `select (buffers_checkpoint + buffers_clean + buffers_backend)::text as blocks_written
         from pg_stat_bgwriter`
      ),
    ]);
    void pingResult;
    const responseMs = Date.now() - started;
    const activeConnections = Number(statsResult.rows[0]?.active_connections ?? 0);
    const idleConnections = Number(statsResult.rows[0]?.idle_connections ?? 0);
    const totalConnections = Number(statsResult.rows[0]?.total_connections ?? 0);
    const maxConnections = Number(statsResult.rows[0]?.max_connections ?? 0);
    const longRunningQueries = Number(statsResult.rows[0]?.long_running_queries ?? 0);
    const lockCount = Number(lockResult.rows[0]?.lock_count ?? 0);
    const activeConnectionsPct = maxConnections > 0 ? (activeConnections / maxConnections) * 100 : 0;
    const totalConnectionsPct = maxConnections > 0 ? (totalConnections / maxConnections) * 100 : 0;
    const xactCommit = Number(dbSizeResult.rows[0]?.xact_commit ?? 0);
    const xactRollback = Number(dbSizeResult.rows[0]?.xact_rollback ?? 0);
    const xactTotal = xactCommit + xactRollback;
    const blocksReadTotal = Number(dbSizeResult.rows[0]?.blks_read ?? 0);
    const blocksHitTotal = Number(dbSizeResult.rows[0]?.blks_hit ?? 0);
    const blocksWrittenTotal = Number(bgwriterResult.rows[0]?.blocks_written ?? 0);
    const cacheHitRatio =
      blocksReadTotal + blocksHitTotal > 0 ? (blocksHitTotal / (blocksReadTotal + blocksHitTotal)) * 100 : null;
    const previousAt = previousSnapshot ? Date.parse(previousSnapshot.timestamp) : null;
    const elapsedSeconds =
      previousAt && Number.isFinite(previousAt) ? Math.max((Date.now() - previousAt) / 1000, 1) : null;
    const previousXactTotal = Number(previousSnapshot?.metrics.xact_total ?? 0);
    const previousBlocksReadTotal = Number(previousSnapshot?.metrics.blocks_read_total ?? 0);
    const previousBlocksWrittenTotal = Number(previousSnapshot?.metrics.blocks_written_total ?? 0);
    const transactionRate =
      elapsedSeconds != null ? Math.max(0, (xactTotal - previousXactTotal) / elapsedSeconds) : null;
    const readBlocksPerSec =
      elapsedSeconds != null ? Math.max(0, (blocksReadTotal - previousBlocksReadTotal) / elapsedSeconds) : null;
    const writeBlocksPerSec =
      elapsedSeconds != null ? Math.max(0, (blocksWrittenTotal - previousBlocksWrittenTotal) / elapsedSeconds) : null;
    const status: DatabaseHealthStatus = responseMs >= 1000 ? 'degraded' : 'online';
    return {
      timestamp: new Date().toISOString(),
      databaseId,
      type: 'postgres',
      name,
      status,
      responseMs,
      metrics: {
        latency_ms: responseMs,
        active_connections: activeConnections,
        idle_connections: idleConnections,
        total_connections: totalConnections,
        max_connections: maxConnections,
        active_connections_pct: activeConnectionsPct,
        total_connections_pct: totalConnectionsPct,
        long_running_queries: longRunningQueries,
        lock_count: lockCount,
        transaction_rate: transactionRate,
        cache_hit_ratio: cacheHitRatio,
        read_blocks_per_sec: readBlocksPerSec,
        write_blocks_per_sec: writeBlocksPerSec,
        database_size_bytes: Number(dbSizeResult.rows[0]?.database_size ?? 0),
        database_size_mb: Number(dbSizeResult.rows[0]?.database_size ?? 0) / (1024 * 1024),
        xact_total: xactTotal,
        blocks_read_total: blocksReadTotal,
        blocks_written_total: blocksWrittenTotal,
      },
    };
  }

  private async collectRedisSnapshot(
    databaseId: string,
    name: string,
    config: Extract<DatabaseConnectionConfig, { type: 'redis' }>
  ): Promise<DatabaseMetricSnapshot> {
    const client = await this.databaseService.getRedisClient(databaseId);
    const started = Date.now();
    await client.ping();
    const infoRaw = await client.info('memory');
    const clientsRaw = await client.info('clients');
    const statsRaw = await client.info('stats');
    const dbSize = await client.dbsize();
    const responseMs = Date.now() - started;
    const info = this.parseRedisInfo(infoRaw);
    const clients = this.parseRedisInfo(clientsRaw);
    const stats = this.parseRedisInfo(statsRaw);
    const usedMemory = Number(info.used_memory ?? 0);
    const maxMemory = Number(info.maxmemory ?? 0);
    const memoryPct = maxMemory > 0 ? (usedMemory / maxMemory) * 100 : 0;
    const status: DatabaseHealthStatus = responseMs >= 1000 ? 'degraded' : 'online';
    return {
      timestamp: new Date().toISOString(),
      databaseId,
      type: 'redis',
      name,
      status,
      responseMs,
      metrics: {
        latency_ms: responseMs,
        used_memory_bytes: usedMemory,
        maxmemory_bytes: maxMemory,
        memory_pct: memoryPct,
        connected_clients: Number(clients.connected_clients ?? 0),
        instantaneous_ops_per_sec: Number(stats.instantaneous_ops_per_sec ?? 0),
        key_count: dbSize,
        redis_db: config.db,
      },
    };
  }

  private parseRedisInfo(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      if (!line || line.startsWith('#') || !line.includes(':')) continue;
      const [key, value] = line.trim().split(':', 2);
      out[key] = value;
    }
    return out;
  }
}
