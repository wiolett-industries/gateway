import { and, desc, eq } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { notificationAlertStates } from '@/db/schema/index.js';
import { createChildLogger } from '@/lib/logger.js';
import type { CacheService, RedisClient } from '@/services/cache.service.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { NodeRegistryService } from '@/services/node-registry.service.js';
import {
  EVENT_BUS_MAPPINGS,
  eventSupportsThreshold,
  extractMetricFromDatabaseSnapshot,
  evaluateThreshold,
  evaluateWindowRatio,
  extractMetricFromHealthReport,
  type Severity,
  type WindowProbeSample,
} from './notification.constants.js';
import type { NotificationAlertRuleService } from './notification-alert-rule.service.js';
import type { NotificationDispatcherService } from './notification-dispatcher.service.js';
import { type NotificationEvent, renderTemplate } from './notification-templates.js';
import type { NotificationWebhookService } from './notification-webhook.service.js';

const logger = createChildLogger('NotificationEvaluator');

const METRIC_BUFFER_TTL = 1800;
const WINDOW_TRIM_PADDING_MS = 60_000;

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

      const extraction = extractMetricFromHealthReport(rule.category, rule.metric, healthData, rule.metricTarget);
      if (!extraction) {
        logger.debug('No metric extraction', { ruleId: rule.id, category: rule.category, metric: rule.metric });
        continue;
      }

      for (const { resourceId, value } of extraction.values) {
        // Check resource scope for container rules
        if (rule.category === 'container' && rule.resourceIds?.length > 0) {
          if (!rule.resourceIds.includes(resourceId)) continue;
        }

        const compositeResourceId =
          rule.category === 'container'
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
          ruleId: rule.id,
          ruleName: rule.name,
          metric: rule.metric,
          value: Math.round(value * 100) / 100,
          threshold: rule.thresholdValue,
          operator: rule.operator,
          breached,
          resourceId: compositeResourceId,
        });

        await this.recordProbeOutcome(
          rule.id,
          compositeResourceId,
          breached,
          Math.max(rule.durationSeconds ?? 0, rule.resolveAfterSeconds ?? 0) * 1000
        );

        if (breached) {
          await this.handleThresholdBreach(rule, compositeResourceId, value, nodeId, resourceId);
        } else {
          await this.handleThresholdClear(rule, compositeResourceId, value);
        }
      }
    }
  }

  async evaluateDatabaseSnapshot(snapshot: {
    databaseId: string;
    type: 'postgres' | 'redis';
    name: string;
    metrics: Record<string, number | null>;
  }): Promise<void> {
    const rules = await this.getThresholdRules();
    if (rules.length === 0) return;

    const category = snapshot.type === 'postgres' ? 'database_postgres' : 'database_redis';

    for (const rule of rules) {
      if (rule.category !== category) continue;
      if (rule.resourceIds?.length > 0 && !rule.resourceIds.includes(snapshot.databaseId)) continue;

      const extraction = extractMetricFromDatabaseSnapshot(rule.category, rule.metric, snapshot);
      if (!extraction) continue;

      for (const { resourceId, value } of extraction.values) {
        if (Number.isNaN(value)) continue;

        const breached = evaluateThreshold(value, rule.operator, rule.thresholdValue);
        await this.recordProbeOutcome(
          rule.id,
          resourceId,
          breached,
          Math.max(rule.durationSeconds ?? 0, rule.resolveAfterSeconds ?? 0) * 1000
        );
        if (breached) {
          await this.handleThresholdBreach(rule, resourceId, value, snapshot.databaseId, snapshot.name);
        } else {
          await this.handleThresholdClear(rule, resourceId, value);
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

    if (durationMs > 0 && this.redis) {
      const evaluation = await this.evaluateRatioWindow(
        rule.id,
        compositeResourceId,
        durationMs,
        rule.fireThresholdPercent ?? 100,
        'breach'
      );

      if (!evaluation?.hasCoverage) {
        logger.debug('Fire ratio window has insufficient coverage', { ruleId: rule.id, durationMs });
        return;
      }

      if (!evaluation.thresholdMet) {
        logger.debug('Fire ratio threshold not met', {
          ruleId: rule.id,
          sampleCount: evaluation.sampleCount,
          matchingSamples: evaluation.matchingSamples,
          ratioPercent: Math.round(evaluation.ratioPercent * 100) / 100,
          thresholdPercent: rule.fireThresholdPercent ?? 100,
        });
        return;
      }
    } else if (durationMs > 0 && !this.redis) {
      logger.debug('Fire ratio window skipped: no Redis', { ruleId: rule.id });
    }

    const existingState = await this.getActiveAlertState(rule.id, rule.category, compositeResourceId);
    if (existingState) {
      logger.debug('Alert already firing', { ruleId: rule.id, stateId: existingState.id });
      return;
    }

    const nodeName = rule.category === 'node' || rule.category === 'container' ? this.getNodeName(nodeId) : undefined;
    const resourceName = rawResourceId === 'system' ? nodeName || nodeId : rawResourceId;

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

  private async handleThresholdClear(rule: any, compositeResourceId: string, currentValue: number): Promise<void> {
    const existingState = await this.getActiveAlertState(rule.id, rule.category, compositeResourceId);
    if (!existingState) return;

    const resolveMs = (rule.resolveAfterSeconds ?? 60) * 1000;

    if (resolveMs > 0 && this.redis) {
      const evaluation = await this.evaluateRatioWindow(
        rule.id,
        compositeResourceId,
        resolveMs,
        rule.resolveThresholdPercent ?? 100,
        'clear'
      );

      if (!evaluation?.hasCoverage) {
        logger.debug('Resolve ratio window has insufficient coverage', { ruleId: rule.id, resolveMs });
        return;
      }

      if (!evaluation.thresholdMet) {
        logger.debug('Resolve ratio threshold not met', {
          ruleId: rule.id,
          sampleCount: evaluation.sampleCount,
          matchingSamples: evaluation.matchingSamples,
          ratioPercent: Math.round(evaluation.ratioPercent * 100) / 100,
          thresholdPercent: rule.resolveThresholdPercent ?? 100,
        });
        return;
      }
    } else if (resolveMs > 0 && !this.redis) {
      logger.debug('Resolve ratio window skipped: no Redis', { ruleId: rule.id });
    }

    const firedAt = existingState.firedAt;
    const firedDurationSec = firedAt ? Math.round((Date.now() - firedAt.getTime()) / 1000) : 0;

    const nodeName =
      rule.category === 'node' || rule.category === 'container'
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

  }

  private getProbeOutcomeKey(ruleId: string, compositeResourceId: string): string {
    return `notif:threshold:outcomes:${ruleId}:${compositeResourceId}`;
  }

  private async recordProbeOutcome(
    ruleId: string,
    compositeResourceId: string,
    breached: boolean,
    windowMs: number
  ): Promise<void> {
    if (!this.redis) return;

    const now = Date.now();
    const redisKey = this.getProbeOutcomeKey(ruleId, compositeResourceId);
    await this.redis.zadd(redisKey, now, `${now}:${breached ? 1 : 0}`);
    await this.redis.expire(redisKey, METRIC_BUFFER_TTL);

    const trimWindowMs = Math.max(windowMs, 0);
    const cutoff = now - trimWindowMs - WINDOW_TRIM_PADDING_MS;
    await this.redis.zremrangebyscore(redisKey, '-inf', cutoff);
  }

  private parseProbeOutcomeSamples(samples: string[]): WindowProbeSample[] {
    return samples.flatMap((sample) => {
      const [timestampRaw, breachedRaw] = sample.split(':');
      const timestamp = Number.parseInt(timestampRaw ?? '', 10);
      if (!Number.isFinite(timestamp)) return [];
      return [{ timestamp, breached: breachedRaw === '1' }];
    });
  }

  private async evaluateRatioWindow(
    ruleId: string,
    compositeResourceId: string,
    windowMs: number,
    thresholdPercent: number,
    targetState: 'breach' | 'clear'
  ) {
    if (!this.redis) return null;

    const now = Date.now();
    const redisKey = this.getProbeOutcomeKey(ruleId, compositeResourceId);
    const windowStart = now - windowMs;
    const samples = await this.redis.zrangebyscore(redisKey, windowStart, '+inf');

    return evaluateWindowRatio(
      this.parseProbeOutcomeSamples(samples),
      targetState,
      thresholdPercent,
      windowMs,
      now
    );
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

        if (eventSupportsThreshold(rule.category, rule.eventPattern)) {
          continue;
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

  async observeStatefulEvent(
    category: string,
    currentState: string,
    resource: { type: string; id: string; name?: string },
    context: Record<string, unknown> = {}
  ): Promise<void> {
    const eventRules = await this.getEventRules();

    for (const rule of eventRules) {
      if (rule.category !== category) continue;
      if (!eventSupportsThreshold(rule.category, rule.eventPattern)) continue;
      if (rule.resourceIds?.length > 0 && !rule.resourceIds.includes(resource.id)) continue;

      const active = rule.eventPattern === currentState;
      await this.recordProbeOutcome(
        rule.id,
        resource.id,
        active,
        Math.max(rule.durationSeconds ?? 0, rule.resolveAfterSeconds ?? 0) * 1000
      );

      const existingState = await this.getActiveAlertState(rule.id, resource.type, resource.id);

      if (active) {
        const durationMs = (rule.durationSeconds ?? 0) * 1000;
        if (durationMs > 0 && this.redis) {
          const evaluation = await this.evaluateRatioWindow(
            rule.id,
            resource.id,
            durationMs,
            rule.fireThresholdPercent ?? 100,
            'breach'
          );
          if (!evaluation?.hasCoverage || !evaluation.thresholdMet) continue;
        } else if (durationMs > 0 && !this.redis) {
          continue;
        }

        if (existingState) continue;

        await this.fireAlert(rule, resource.type, resource.id, resource.name ?? resource.id, {
          ...context,
          event: rule.eventPattern,
          current_state: currentState,
        });
        continue;
      }

      if (!existingState) continue;

      const resolveMs = (rule.resolveAfterSeconds ?? 60) * 1000;
      if (resolveMs > 0 && this.redis) {
        const evaluation = await this.evaluateRatioWindow(
          rule.id,
          resource.id,
          resolveMs,
          rule.resolveThresholdPercent ?? 100,
          'clear'
        );
        if (!evaluation?.hasCoverage || !evaluation.thresholdMet) continue;
      } else if (resolveMs > 0 && !this.redis) {
        continue;
      }

      await this.resolveAlert(existingState.id, rule, resource.type, resource.id, resource.name, {
        ...context,
        event: rule.eventPattern,
        current_state: currentState,
      });
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
  private async isEventInCooldown(
    ruleId: string,
    resourceType: string,
    resourceId: string,
    cooldownSeconds: number
  ): Promise<boolean> {
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
