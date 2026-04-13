import { and, desc, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { notificationAlertStates } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import type { CacheService, RedisClient } from '@/services/cache.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { NodeRegistryService } from '@/services/node-registry.service.js';
import type { NotificationAlertRuleService } from './notification-alert-rule.service.js';
import type { NotificationDispatcherService } from './notification-dispatcher.service.js';
import type { NotificationWebhookService } from './notification-webhook.service.js';
import { renderTemplate, type NotificationEvent } from './notification-templates.js';
import {
  EVENT_BUS_MAPPINGS,
  evaluateThreshold,
  extractMetricFromHealthReport,
  type Severity,
} from './notification.constants.js';

const logger = createChildLogger('NotificationEvaluator');

const METRIC_BUFFER_TTL = 1800;

export class NotificationEvaluatorService {
  private eventBus?: EventBusService;
  private redis: RedisClient | null = null;
  private unsubscribers: Array<() => void> = [];

  private thresholdRulesCache: any[] = [];
  private eventRulesCache: any[] = [];
  private lastRuleCacheRefresh = 0;
  private readonly RULE_CACHE_TTL = 30_000;

  constructor(
    private db: DrizzleClient,
    private ruleService: NotificationAlertRuleService,
    private webhookService: NotificationWebhookService,
    private dispatcherService: NotificationDispatcherService,
    cacheService: CacheService | null,
    private nodeRegistry: NodeRegistryService
  ) {
    this.redis = cacheService?.getClient() ?? null;
  }

  setEventBus(bus: EventBusService) {
    this.eventBus = bus;
  }

  start(): void {
    if (!this.eventBus) {
      logger.warn('EventBus not set, evaluator will not process events');
      return;
    }

    for (const channel of Object.keys(EVENT_BUS_MAPPINGS)) {
      const unsub = this.eventBus.subscribe(channel, (payload: unknown) => {
        this.handleBusEvent(channel, payload).catch((err) => {
          logger.error('Error handling event', { channel, error: err instanceof Error ? err.message : String(err) });
        });
      });
      this.unsubscribers.push(unsub);
    }

    logger.info('Notification evaluator started', { channels: Object.keys(EVENT_BUS_MAPPINGS).length });
  }

  stop(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
  }

  // ── Health Report Evaluation ────────────────────────────────────────

  async evaluateHealthReport(nodeId: string, healthData: any): Promise<void> {
    const rules = await this.getThresholdRules();
    if (rules.length === 0) return;

    for (const rule of rules) {
      // Only evaluate rules matching the node category or container category
      if (rule.category !== 'node' && rule.category !== 'container') continue;

      // Check resource scope for node rules
      if (rule.category === 'node' && rule.resourceIds?.length > 0) {
        if (!rule.resourceIds.includes(nodeId)) {
          logger.debug('Skipping rule: node not in scope', { ruleId: rule.id, nodeId, scopedIds: rule.resourceIds });
          continue;
        }
      }

      const extraction = extractMetricFromHealthReport(rule.category, rule.metric, healthData);
      if (!extraction) {
        logger.debug('No metric extraction', { ruleId: rule.id, category: rule.category, metric: rule.metric });
        continue;
      }

      for (const { resourceId, value } of extraction.values) {
        // Check resource scope for container rules
        if (rule.category === 'container' && rule.resourceIds?.length > 0) {
          if (!rule.resourceIds.includes(resourceId)) continue;
        }

        const compositeResourceId = rule.category === 'container'
          ? `${nodeId}:${resourceId}`
          : rule.metric === 'disk'
            ? `${nodeId}:${resourceId}`
            : nodeId;

        if (Number.isNaN(value)) {
          logger.warn('Skipping NaN metric value', { ruleId: rule.id, metric: rule.metric, resourceId });
          continue;
        }

        const breached = evaluateThreshold(value, rule.operator, rule.thresholdValue);
        logger.debug('Threshold check', {
          ruleId: rule.id, ruleName: rule.name, metric: rule.metric,
          value: Math.round(value * 100) / 100, threshold: rule.thresholdValue,
          operator: rule.operator, breached, resourceId: compositeResourceId,
        });

        if (breached) {
          // Reset resolve window — metric is back above threshold
          if (this.redis) await this.redis.del(`notif:resolve:${rule.id}:${compositeResourceId}`).catch(() => {});
          await this.handleThresholdBreach(rule, compositeResourceId, value, nodeId, resourceId);
        } else {
          await this.handleThresholdClear(rule, compositeResourceId, value);
        }
      }
    }
  }

  private async handleThresholdBreach(
    rule: any,
    compositeResourceId: string,
    currentValue: number,
    nodeId: string,
    rawResourceId: string
  ): Promise<void> {
    const durationMs = (rule.durationSeconds ?? 0) * 1000;

    // Duration must be >= 30s for the sliding window to work (health reports arrive every 5-30s).
    // Shorter durations fire immediately like duration=0.
    if (durationMs >= 30_000 && this.redis) {
      const redisKey = `notif:threshold:${rule.id}:${compositeResourceId}`;
      const now = Date.now();

      await this.redis.zadd(redisKey, now, `${now}:${currentValue}`);
      await this.redis.expire(redisKey, METRIC_BUFFER_TTL);

      const cutoff = now - durationMs - 60_000;
      await this.redis.zremrangebyscore(redisKey, '-inf', cutoff);

      const windowStart = now - durationMs;
      const samples = await this.redis.zrangebyscore(redisKey, windowStart, '+inf');

      if (samples.length === 0) {
        logger.debug('Duration check: no samples in window', { ruleId: rule.id, durationMs });
        return;
      }

      const oldestSample = Number.parseInt(samples[0].split(':')[0], 10);
      const elapsed = now - oldestSample;
      if (elapsed < durationMs * 0.8) {
        logger.debug('Duration check: not enough time elapsed', { ruleId: rule.id, elapsed, required: durationMs * 0.8, samples: samples.length });
        return;
      }

      const allBreach = samples.every((s) => {
        const val = Number.parseFloat(s.split(':').slice(1).join(':'));
        if (Number.isNaN(val)) return false;
        return evaluateThreshold(val, rule.operator, rule.thresholdValue);
      });

      if (!allBreach) {
        logger.debug('Duration check: not all samples breach', { ruleId: rule.id, samples: samples.length });
        return;
      }

      logger.debug('Duration check passed', { ruleId: rule.id, samples: samples.length, elapsed });
    } else if (durationMs > 0 && !this.redis) {
      logger.debug('Duration check skipped: no Redis', { ruleId: rule.id });
    }

    const existingState = await this.getActiveAlertState(rule.id, rule.category, compositeResourceId);
    if (existingState) {
      logger.debug('Alert already firing', { ruleId: rule.id, stateId: existingState.id });
      return;
    }

    const nodeName = this.getNodeName(nodeId);
    const resourceName = rawResourceId === 'system' ? nodeName : rawResourceId;

    await this.fireAlert(rule, rule.category, compositeResourceId, resourceName, {
      value: currentValue,
      threshold: rule.thresholdValue,
      operator: rule.operator,
      metric: rule.metric,
      duration: rule.durationSeconds ?? 0,
      node_name: nodeName,
      hostname: nodeName,
    });
  }

  private async handleThresholdClear(
    rule: any,
    compositeResourceId: string,
    currentValue: number
  ): Promise<void> {
    const existingState = await this.getActiveAlertState(rule.id, rule.category, compositeResourceId);
    if (!existingState) return;

    const resolveMs = (rule.resolveAfterSeconds ?? 60) * 1000;

    // Require metric to stay below threshold for resolveAfterSeconds before resolving
    if (resolveMs >= 30_000 && this.redis) {
      const redisKey = `notif:resolve:${rule.id}:${compositeResourceId}`;
      const now = Date.now();

      await this.redis.zadd(redisKey, now, `${now}:${currentValue}`);
      await this.redis.expire(redisKey, METRIC_BUFFER_TTL);

      const cutoff = now - resolveMs - 60_000;
      await this.redis.zremrangebyscore(redisKey, '-inf', cutoff);

      const windowStart = now - resolveMs;
      const samples = await this.redis.zrangebyscore(redisKey, windowStart, '+inf');

      if (samples.length === 0) return;

      const oldestSample = Number.parseInt(samples[0].split(':')[0], 10);
      if (now - oldestSample < resolveMs * 0.8) {
        logger.debug('Resolve delay: not enough time below threshold', {
          ruleId: rule.id, elapsed: now - oldestSample, required: resolveMs * 0.8, samples: samples.length,
        });
        return;
      }

      // All samples in window must be below threshold
      const allClear = samples.every((s) => {
        const val = Number.parseFloat(s.split(':').slice(1).join(':'));
        if (Number.isNaN(val)) return false;
        return !evaluateThreshold(val, rule.operator, rule.thresholdValue);
      });

      if (!allClear) return;
    }

    const firedAt = existingState.firedAt;
    const firedDurationSec = firedAt ? Math.round((Date.now() - firedAt.getTime()) / 1000) : 0;

    const nodeName = rule.category === 'node' || rule.category === 'container'
      ? this.getNodeName(compositeResourceId.split(':')[0] || compositeResourceId)
      : undefined;

    await this.resolveAlert(existingState.id, rule, rule.category, compositeResourceId, nodeName, {
      value: currentValue,
      threshold: rule.thresholdValue,
      operator: rule.operator,
      metric: rule.metric,
      duration: rule.durationSeconds ?? 0,
      node_name: nodeName,
      hostname: nodeName,
      fired_at: firedAt?.toISOString(),
      fired_duration: firedDurationSec,
    });

    // Clear the resolve window buffer after successful DB write
    if (this.redis) {
      await this.redis.del(`notif:resolve:${rule.id}:${compositeResourceId}`).catch(() => {});
    }
  }

  // ── EventBus Event Handling ─────────────────────────────────────────

  private async handleBusEvent(channel: string, payload: any): Promise<void> {
    const mappings = EVENT_BUS_MAPPINGS[channel];
    if (!mappings) return;

    for (const mapping of mappings) {
      if (!mapping.match(payload)) continue;

      const resource = mapping.extractResource(payload);
      const extraData = mapping.extractData?.(payload) ?? {};

      // Find event-type alert rules matching this category + event
      const eventRules = await this.getEventRules();

      for (const rule of eventRules) {
        if (rule.category !== mapping.category) continue;
        if (rule.eventPattern !== mapping.eventId) continue;

        // Check resource scope
        if (rule.resourceIds?.length > 0) {
          if (!rule.resourceIds.includes(resource.id)) continue;
        }

        // For events, check cooldown based on last notification time (not persistent firing state)
        if (await this.isEventInCooldown(rule.id, resource.type, resource.id, rule.cooldownSeconds)) continue;

        await this.fireEventAlert(rule, resource.type, resource.id, resource.name ?? resource.id, {
          ...extraData,
          event: mapping.eventId,
        });
      }
    }
  }

  // ── Alert State Management ──────────────────────────────────────────

  private async fireAlert(
    rule: any,
    resourceType: string,
    resourceId: string,
    resourceName: string,
    context: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.db.insert(notificationAlertStates).values({
        ruleId: rule.id,
        resourceType,
        resourceId,
        status: 'firing',
        severity: rule.severity,
        context,
      });
    } catch (err: any) {
      if (err.code === '23505') return; // already firing
      throw err;
    }

    // Render the alert's message template
    const now = new Date().toISOString();
    const messageContext = {
      ...context,
      resource: { type: resourceType, id: resourceId, name: resourceName },
      severity: rule.severity,
      alert_name: rule.name,
      fired_at: now,
    };
    const message = rule.messageTemplate
      ? renderTemplate(rule.messageTemplate, messageContext)
      : `${rule.name}: ${resourceName}`;

    // Build notification event
    const event: NotificationEvent = {
      type: 'alert.fired',
      title: rule.name,
      message,
      severity: rule.severity as Severity,
      resource: { type: resourceType, id: resourceId, name: resourceName },
      data: { ...context, rule_name: rule.name, rule_id: rule.id, fired_at: now },
      timestamp: now,
    };

    // Dispatch to the alert's attached webhooks
    const webhookIds = (rule.webhookIds ?? []) as string[];
    if (webhookIds.length > 0) {
      const webhooks = await this.webhookService.getRawByIds(webhookIds);
      for (const webhook of webhooks) {
        if (!webhook.enabled) continue;
        this.dispatcherService.dispatch(webhook, event).catch((err) => {
          logger.error('Alert dispatch failed', { webhookId: webhook.id, ruleId: rule.id, error: err.message });
        });
      }
    }

    this.eventBus?.publish('alert.fired', {
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      resourceType,
      resourceId,
    });

    logger.info('Alert fired', { ruleId: rule.id, ruleName: rule.name, resourceType, resourceId });
  }

  private async resolveAlert(
    stateId: string,
    rule: any,
    resourceType: string,
    resourceId: string,
    resourceName: string | undefined,
    context: Record<string, unknown>
  ): Promise<void> {
    await this.db
      .update(notificationAlertStates)
      .set({ status: 'resolved', resolvedAt: new Date() })
      .where(eq(notificationAlertStates.id, stateId));

    const resolvedResource = { type: resourceType, id: resourceId, name: resourceName ?? resourceId };

    // Render resolve message if template exists
    const resolveContext = {
      ...context,
      resource: resolvedResource,
      severity: 'info' as const,
      alert_name: rule.name,
    };
    const resolveMessage = rule.messageTemplate
      ? renderTemplate(rule.messageTemplate, resolveContext)
      : `${rule.name} has been resolved.`;

    const event: NotificationEvent = {
      type: 'alert.resolved',
      title: `Resolved: ${rule.name}`,
      message: resolveMessage,
      severity: 'info',
      resource: resolvedResource,
      data: { ...context, rule_name: rule.name, rule_id: rule.id },
      timestamp: new Date().toISOString(),
    };

    const webhookIds = (rule.webhookIds ?? []) as string[];
    if (webhookIds.length > 0) {
      const webhooks = await this.webhookService.getRawByIds(webhookIds);
      for (const webhook of webhooks) {
        if (!webhook.enabled) continue;
        this.dispatcherService.dispatch(webhook, event).catch((err) => {
          logger.error('Resolve dispatch failed', { webhookId: webhook.id, ruleId: rule.id, error: err.message });
        });
      }
    }

    this.eventBus?.publish('alert.resolved', {
      ruleId: rule.id,
      ruleName: rule.name,
      resourceType,
      resourceId,
    });

    logger.info('Alert resolved', { ruleId: rule.id, ruleName: rule.name, resourceType, resourceId });
  }

  /** Fire an event-type alert — no persistent state, just cooldown tracking */
  private async fireEventAlert(
    rule: any,
    resourceType: string,
    resourceId: string,
    resourceName: string,
    context: Record<string, unknown>
  ): Promise<void> {
    // Dedup guard: use Redis SET NX to prevent concurrent duplicate dispatches
    if (this.redis) {
      const lockKey = `notif:event:lock:${rule.id}:${resourceType}:${resourceId}`;
      const acquired = await this.redis.set(lockKey, '1', 'EX', 10, 'NX');
      if (!acquired) return; // another handler is already processing this event
    }

    // Record notification time for cooldown
    await this.db.insert(notificationAlertStates).values({
      ruleId: rule.id,
      resourceType,
      resourceId,
      status: 'resolved',
      severity: rule.severity,
      context,
      resolvedAt: new Date(),
    });

    const messageContext = {
      ...context,
      resource: { type: resourceType, id: resourceId, name: resourceName },
      severity: rule.severity,
      alert_name: rule.name,
    };
    const message = rule.messageTemplate
      ? renderTemplate(rule.messageTemplate, messageContext)
      : `${rule.name}: ${resourceName}`;

    const event: NotificationEvent = {
      type: 'alert.fired',
      title: rule.name,
      message,
      severity: rule.severity as Severity,
      resource: { type: resourceType, id: resourceId, name: resourceName },
      data: { ...context, rule_name: rule.name, rule_id: rule.id },
      timestamp: new Date().toISOString(),
    };

    const webhookIds = (rule.webhookIds ?? []) as string[];
    if (webhookIds.length > 0) {
      const webhooks = await this.webhookService.getRawByIds(webhookIds);
      for (const webhook of webhooks) {
        if (!webhook.enabled) continue;
        this.dispatcherService.dispatch(webhook, event).catch((err) => {
          logger.error('Event alert dispatch failed', { webhookId: webhook.id, ruleId: rule.id, error: err.message });
        });
      }
    }

    this.eventBus?.publish('alert.fired', {
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      resourceType,
      resourceId,
    });

    logger.info('Event alert fired', { ruleId: rule.id, ruleName: rule.name, resourceType, resourceId });
  }

  /** Check if an event-type alert is still in cooldown */
  private async isEventInCooldown(ruleId: string, resourceType: string, resourceId: string, cooldownSeconds: number): Promise<boolean> {
    const [latest] = await this.db
      .select({ resolvedAt: notificationAlertStates.resolvedAt })
      .from(notificationAlertStates)
      .where(
        and(
          eq(notificationAlertStates.ruleId, ruleId),
          eq(notificationAlertStates.resourceType, resourceType),
          eq(notificationAlertStates.resourceId, resourceId)
        )
      )
      .orderBy(desc(notificationAlertStates.resolvedAt))
      .limit(1);

    if (!latest?.resolvedAt) return false;
    const elapsed = Date.now() - latest.resolvedAt.getTime();
    return elapsed < cooldownSeconds * 1000;
  }

  private async getActiveAlertState(ruleId: string, resourceType: string, resourceId: string) {
    const [state] = await this.db
      .select()
      .from(notificationAlertStates)
      .where(
        and(
          eq(notificationAlertStates.ruleId, ruleId),
          eq(notificationAlertStates.resourceType, resourceType),
          eq(notificationAlertStates.resourceId, resourceId),
          eq(notificationAlertStates.status, 'firing')
        )
      )
      .limit(1);
    return state ?? null;
  }

  // ── Rule Cache ──────────────────────────────────────────────────────

  private async refreshRuleCache() {
    if (Date.now() - this.lastRuleCacheRefresh > this.RULE_CACHE_TTL) {
      // Set timestamp before awaits to prevent thundering herd
      this.lastRuleCacheRefresh = Date.now();
      const [threshold, event] = await Promise.all([
        this.ruleService.getEnabledThresholdRules(),
        this.ruleService.getEnabledEventRules(),
      ]);
      this.thresholdRulesCache = threshold;
      this.eventRulesCache = event;
    }
  }

  private async getThresholdRules() {
    await this.refreshRuleCache();
    return this.thresholdRulesCache;
  }

  private async getEventRules() {
    await this.refreshRuleCache();
    return this.eventRulesCache;
  }

  invalidateRuleCache(): void {
    this.lastRuleCacheRefresh = 0;
  }

  private getNodeName(nodeId: string): string {
    const node = this.nodeRegistry.getNode(nodeId);
    return node?.hostname ?? nodeId;
  }
}
