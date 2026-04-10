import type { ServerDuplexStream } from '@grpc/grpc-js';
import { eq } from 'drizzle-orm';
import { container } from '@/container.js';
import { nodes } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import { isMinorCompatible } from '@/lib/semver.js';
import { daemonLogRelay } from '@/modules/monitoring/log-relay.service.js';
import { ProxyService } from '@/modules/proxy/proxy.service.js';
import type { DaemonMessage, GatewayCommand } from '../generated/types.js';
import { extractNodeIdFromCert } from '../interceptors/auth.js';
import type { GrpcServerDeps } from '../server.js';

const logger = createChildLogger('GrpcControl');

// Track the last recorded hour per node to avoid redundant DB writes
const lastRecordedHour = new Map<string, string>();

export function createControlHandlers(deps: GrpcServerDeps) {
  return {
    CommandStream(stream: ServerDuplexStream<DaemonMessage, GatewayCommand>) {
      let nodeId: string | null = null;

      stream.on('data', async (msg: DaemonMessage) => {
        try {
          if (msg.register) {
            // First message must be RegisterMessage
            nodeId = msg.register.nodeId;

            // Verify mTLS cert CN matches claimed nodeId (prevents node impersonation)
            const certNodeId = extractNodeIdFromCert(stream as any);
            if (certNodeId && certNodeId !== nodeId) {
              logger.error('Node ID mismatch: cert CN does not match claimed nodeId', {
                certNodeId,
                claimedNodeId: nodeId,
              });
              stream.end();
              return;
            }

            logger.info('Node registering', {
              nodeId,
              hostname: msg.register.hostname,
              nginxVersion: msg.register.nginxVersion,
              configVersionHash: msg.register.configVersionHash,
              certVerified: !!certNodeId,
            });

            // Look up node from DB — read stored hash BEFORE updating
            const [node] = await deps.db
              .select({ type: nodes.type, configVersionHash: nodes.configVersionHash })
              .from(nodes)
              .where(eq(nodes.id, nodeId))
              .limit(1);

            if (!node) {
              logger.error('Unknown node ID during registration', { nodeId });
              stream.end();
              return;
            }

            const nodeType = node.type as 'nginx' | 'bastion' | 'monitoring' | 'docker';
            const gatewayHash = node.configVersionHash;

            try {
              await deps.registry.register(
                nodeId,
                nodeType,
                msg.register.hostname,
                msg.register.configVersionHash,
                stream as any
              );
            } catch (err) {
              const reason = (err as Error).message;
              logger.error('Registration rejected', { nodeId, error: reason });
              // Send rejection reason as a command so daemon can detect it and exit
              try {
                stream.write({
                  commandId: '__registration_rejected__',
                  applyConfig: { hostId: '', configContent: reason, testOnly: false },
                });
              } catch {
                /* stream may already be dead */
              }
              stream.end();
              return;
            }

            // Update DB with latest info — do NOT overwrite configVersionHash
            // (the gateway's stored hash is authoritative, set by FullSync)
            const { getEnv } = await import('@/config/env.js');
            const appVersion = getEnv().APP_VERSION;
            const versionMismatch =
              appVersion !== 'dev' &&
              msg.register.daemonVersion !== 'dev' &&
              !isMinorCompatible(appVersion, msg.register.daemonVersion);
            if (versionMismatch) {
              logger.warn('Daemon version mismatch', {
                nodeId,
                gatewayVersion: appVersion,
                daemonVersion: msg.register.daemonVersion,
              });
            }

            await deps.db
              .update(nodes)
              .set({
                hostname: msg.register.hostname,
                daemonVersion: msg.register.daemonVersion,
                capabilities: {
                  ...(msg.register.nginxVersion ? { nginxVersion: msg.register.nginxVersion } : {}),
                  ...(msg.register.daemonType ? { daemonType: msg.register.daemonType } : {}),
                  ...((msg.register as any).dockerVersion
                    ? { dockerVersion: (msg.register as any).dockerVersion }
                    : {}),
                  cpuModel: msg.register.cpuModel || undefined,
                  cpuCores: msg.register.cpuCores || undefined,
                  architecture: msg.register.architecture || undefined,
                  kernelVersion: msg.register.kernelVersion || undefined,
                  versionMismatch,
                },
                lastSeenAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(nodes.id, nodeId));

            await deps.auditService.log({
              userId: null,
              action: 'node.connected',
              resourceType: 'node',
              resourceId: nodeId,
              details: {
                hostname: msg.register.hostname,
                daemonVersion: msg.register.daemonVersion,
                nginxVersion: msg.register.nginxVersion,
              },
            });

            // Enable daemon log streaming on connect (fire-and-forget via stream)
            try {
              stream.write({ commandId: '', setDaemonLogStream: { enabled: true, minLevel: 'info', tailLines: 0 } });
            } catch {
              // stream may not be ready yet
            }

            // Compare config hash and trigger full resync if different (nginx nodes only)
            if (nodeType === 'nginx' && gatewayHash && gatewayHash !== msg.register.configVersionHash) {
              logger.info('Config hash mismatch, triggering full resync', {
                nodeId,
                daemonHash: msg.register.configVersionHash,
                gatewayHash,
              });
              // Async resync — don't block registration
              setImmediate(async () => {
                try {
                  const proxyService = container.resolve(ProxyService);
                  await proxyService.resyncAllHostsOnNode(nodeId!);
                } catch (err) {
                  logger.error('Full resync failed', { nodeId, error: (err as Error).message });
                }
              });
            }
          } else if (msg.commandResult && nodeId) {
            // Intercept traffic stats results (fire-and-forget, not correlated)
            if (
              msg.commandResult.commandId?.startsWith('traffic-') &&
              msg.commandResult.success &&
              msg.commandResult.detail
            ) {
              try {
                const node = deps.registry.getNode(nodeId);
                if (node) node.lastTrafficStats = JSON.parse(msg.commandResult.detail);
              } catch {
                /* ignore parse errors */
              }
            } else if (
              msg.commandResult.commandId?.startsWith('log_stream:') &&
              msg.commandResult.success &&
              msg.commandResult.detail
            ) {
              // Route log stream chunks to registered WebSocket handlers
              try {
                const parsed = JSON.parse(msg.commandResult.detail);
                if (parsed.type === 'log_stream' && parsed.containerId) {
                  const key = `${nodeId}:${parsed.containerId}`;
                  deps.registry.handleLogStream(key, parsed.lines ?? [], !!parsed.ended);
                }
              } catch {
                /* ignore parse errors */
              }
            } else {
              deps.registry.handleCommandResult(nodeId, msg.commandResult);
            }
          } else if (msg.healthReport && nodeId) {
            const healthData = {
              nginxRunning: msg.healthReport.nginxRunning,
              configValid: msg.healthReport.configValid,
              nginxUptimeSeconds: Number(msg.healthReport.nginxUptimeSeconds),
              workerCount: msg.healthReport.workerCount,
              nginxVersion: msg.healthReport.nginxVersion,
              cpuPercent: msg.healthReport.cpuPercent,
              memoryBytes: Number(msg.healthReport.memoryBytes),
              diskFreeBytes: Number(msg.healthReport.diskFreeBytes),
              timestamp: Number(msg.healthReport.timestamp),
              loadAverage1m: (msg.healthReport as any).loadAverage_1m ?? msg.healthReport.loadAverage1m ?? 0,
              loadAverage5m: (msg.healthReport as any).loadAverage_5m ?? msg.healthReport.loadAverage5m ?? 0,
              loadAverage15m: (msg.healthReport as any).loadAverage_15m ?? msg.healthReport.loadAverage15m ?? 0,
              systemMemoryTotalBytes: Number(msg.healthReport.systemMemoryTotalBytes ?? 0),
              systemMemoryUsedBytes: Number(msg.healthReport.systemMemoryUsedBytes ?? 0),
              systemMemoryAvailableBytes: Number(msg.healthReport.systemMemoryAvailableBytes ?? 0),
              swapTotalBytes: Number(msg.healthReport.swapTotalBytes ?? 0),
              swapUsedBytes: Number(msg.healthReport.swapUsedBytes ?? 0),
              systemUptimeSeconds: Number(msg.healthReport.systemUptimeSeconds ?? 0),
              openFileDescriptors: Number(msg.healthReport.openFileDescriptors ?? 0),
              maxFileDescriptors: Number(msg.healthReport.maxFileDescriptors ?? 0),
              diskMounts: (msg.healthReport.diskMounts ?? []).map((m: any) => ({
                mountPoint: m.mountPoint,
                filesystem: m.filesystem,
                device: m.device,
                totalBytes: Number(m.totalBytes ?? 0),
                usedBytes: Number(m.usedBytes ?? 0),
                freeBytes: Number(m.freeBytes ?? 0),
                usagePercent: m.usagePercent ?? 0,
              })),
              diskReadBytes: Number(msg.healthReport.diskReadBytes ?? 0),
              diskWriteBytes: Number(msg.healthReport.diskWriteBytes ?? 0),
              networkInterfaces: (msg.healthReport.networkInterfaces ?? []).map((n: any) => ({
                name: n.name,
                rxBytes: Number(n.rxBytes ?? 0),
                txBytes: Number(n.txBytes ?? 0),
                rxPackets: Number(n.rxPackets ?? 0),
                txPackets: Number(n.txPackets ?? 0),
                rxErrors: Number(n.rxErrors ?? 0),
                txErrors: Number(n.txErrors ?? 0),
              })),
              nginxRssBytes: Number(msg.healthReport.nginxRssBytes ?? 0),
              errorRate4xx: (msg.healthReport as any).errorRate_4xx ?? msg.healthReport.errorRate4xx ?? 0,
              errorRate5xx: (msg.healthReport as any).errorRate_5xx ?? msg.healthReport.errorRate5xx ?? 0,
              // Docker-specific fields
              ...(msg.healthReport.dockerVersion ? { dockerVersion: msg.healthReport.dockerVersion } : {}),
              ...(msg.healthReport.containersRunning != null
                ? { containersRunning: msg.healthReport.containersRunning }
                : {}),
              ...(msg.healthReport.containersStopped != null
                ? { containersStopped: msg.healthReport.containersStopped }
                : {}),
              ...(msg.healthReport.containersTotal != null
                ? { containersTotal: msg.healthReport.containersTotal }
                : {}),
              ...(msg.healthReport.containerStats?.length
                ? {
                    containerStats: msg.healthReport.containerStats.map((c: any) => ({
                      containerId: c.containerId,
                      name: c.name,
                      image: c.image,
                      state: c.state,
                      cpuPercent: c.cpuPercent ?? 0,
                      memoryUsageBytes: Number(c.memoryUsageBytes ?? 0),
                      memoryLimitBytes: Number(c.memoryLimitBytes ?? 0),
                      networkRxBytes: Number(c.networkRxBytes ?? 0),
                      networkTxBytes: Number(c.networkTxBytes ?? 0),
                      blockReadBytes: Number(c.blockReadBytes ?? 0),
                      blockWriteBytes: Number(c.blockWriteBytes ?? 0),
                      pids: c.pids ?? 0,
                    })),
                  }
                : {}),
            };

            deps.registry.updateHealthReport(nodeId, healthData);

            // Persist periodically
            await deps.db
              .update(nodes)
              .set({
                lastHealthReport: healthData,
                lastSeenAt: new Date(),
              })
              .where(eq(nodes.id, nodeId));

            // Update hourly health history (ring buffer, max 168 hours = 7 days)
            const currentHour = new Date().toISOString().slice(0, 13); // e.g. "2026-04-01T12"
            const previousHour = lastRecordedHour.get(nodeId);
            if (previousHour !== currentHour) {
              const connectedNode = deps.registry.getNode(nodeId);
              const isHealthy =
                connectedNode?.type === 'nginx' ? healthData.nginxRunning && healthData.configValid : true; // non-nginx nodes are healthy when connected + reporting
              const hourKey = `${currentHour}:00:00.000Z`;

              try {
                const [histRow] = await deps.db
                  .select({ healthHistory: nodes.healthHistory })
                  .from(nodes)
                  .where(eq(nodes.id, nodeId))
                  .limit(1);

                const history: Array<{ hour: string; healthy: boolean }> =
                  (histRow?.healthHistory as Array<{ hour: string; healthy: boolean }>) ?? [];

                // Update or append current hour
                const existingIdx = history.findIndex((h) => h.hour === hourKey);
                if (existingIdx >= 0) {
                  // If ANY report in this hour was unhealthy, mark the hour as unhealthy
                  if (!isHealthy) history[existingIdx].healthy = false;
                } else {
                  history.push({ hour: hourKey, healthy: isHealthy });
                }

                // Trim to last 168 entries
                while (history.length > 168) history.shift();

                await deps.db.update(nodes).set({ healthHistory: history }).where(eq(nodes.id, nodeId));

                // Only mark as recorded after successful DB write so failures retry next report
                lastRecordedHour.set(nodeId, currentHour);
              } catch (err) {
                // Don't update lastRecordedHour — retry next time
                logger.warn('Failed to update health history', { nodeId, error: (err as Error).message });
              }
            }
          } else if (msg.statsReport && nodeId) {
            deps.registry.updateStatsReport(nodeId, {
              activeConnections: Number(msg.statsReport.activeConnections),
              accepts: Number(msg.statsReport.accepts),
              handled: Number(msg.statsReport.handled),
              requests: Number(msg.statsReport.requests),
              reading: msg.statsReport.reading,
              writing: msg.statsReport.writing,
              waiting: msg.statsReport.waiting,
              timestamp: Number(msg.statsReport.timestamp),
            });

            await deps.db
              .update(nodes)
              .set({
                lastStatsReport: {
                  activeConnections: Number(msg.statsReport.activeConnections),
                  accepts: Number(msg.statsReport.accepts),
                  handled: Number(msg.statsReport.handled),
                  requests: Number(msg.statsReport.requests),
                  reading: msg.statsReport.reading,
                  writing: msg.statsReport.writing,
                  waiting: msg.statsReport.waiting,
                  timestamp: Number(msg.statsReport.timestamp),
                },
                lastSeenAt: new Date(),
              })
              .where(eq(nodes.id, nodeId));
          } else if (msg.daemonLog && nodeId) {
            // Relay daemon operational logs to SSE consumers
            daemonLogRelay.emit('log', {
              nodeId,
              timestamp: msg.daemonLog.timestamp || new Date().toISOString(),
              level: msg.daemonLog.level,
              message: msg.daemonLog.message,
              component: msg.daemonLog.component,
              fields: msg.daemonLog.fields || {},
            });
            logger.debug('Daemon log', {
              nodeId,
              level: msg.daemonLog.level,
              component: msg.daemonLog.component,
              message: msg.daemonLog.message,
            });
          } else if (msg.execOutput && nodeId) {
            // Route exec output to registered WebSocket handler
            deps.registry.handleExecOutput(msg.execOutput.execId, msg.execOutput);
          }
        } catch (err) {
          logger.error('Error processing daemon message', { nodeId, error: (err as Error).message });
        }
      });

      stream.on('end', async () => {
        if (nodeId) {
          logger.info('Node stream ended', { nodeId });
          lastRecordedHour.delete(nodeId);
          await deps.registry.deregister(nodeId);
          await deps.auditService.log({
            userId: null,
            action: 'node.disconnected',
            resourceType: 'node',
            resourceId: nodeId,
            details: { reason: 'stream_ended' },
          });
        }
      });

      stream.on('error', async (err) => {
        if (nodeId) {
          logger.warn('Node stream error', { nodeId, error: err.message });
          lastRecordedHour.delete(nodeId);
          await deps.registry.deregister(nodeId);
          await deps.auditService.log({
            userId: null,
            action: 'node.disconnected',
            resourceType: 'node',
            resourceId: nodeId,
            details: { reason: 'error', error: err.message },
          });
        }
      });
    },
  };
}
