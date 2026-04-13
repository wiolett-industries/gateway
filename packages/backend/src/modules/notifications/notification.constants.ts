/**
 * Notification system constants: event catalog, default alert rules,
 * severity definitions, and metric/event definitions per category.
 */

// ── Severity ──────────────────────────────────────────────────────────

export type Severity = 'info' | 'warning' | 'critical';

export const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export function severityMeetsMinimum(actual: Severity, minimum: Severity): boolean {
  return SEVERITY_ORDER[actual] >= SEVERITY_ORDER[minimum];
}

export const SEVERITY_EMOJI: Record<Severity, string> = {
  info: '\u2139\uFE0F',
  warning: '\u26A0\uFE0F',
  critical: '\uD83D\uDEA8',
};

export const SEVERITY_COLOR: Record<Severity, number> = {
  info: 3447003,
  warning: 16776960,
  critical: 15158332,
};

// ── Alert Categories ──────────────────────────────────────────────────

export type AlertCategory = 'node' | 'container' | 'proxy' | 'certificate';

export interface MetricDefinition {
  id: string;
  label: string;
  unit: string;
  defaultOperator: string;
  defaultValue: number;
}

export interface EventDefinition {
  id: string;
  label: string;
  defaultSeverity: Severity;
}

export interface CategoryDefinition {
  id: AlertCategory;
  label: string;
  metrics: MetricDefinition[];
  events: EventDefinition[];
  /** Variables available in message templates for this category */
  variables: Array<{ name: string; description: string }>;
}

export const ALERT_CATEGORIES: CategoryDefinition[] = [
  {
    id: 'node',
    label: 'Node',
    metrics: [
      { id: 'cpu', label: 'CPU Usage (%)', unit: '%', defaultOperator: '>', defaultValue: 90 },
      { id: 'memory', label: 'Memory Usage (%)', unit: '%', defaultOperator: '>', defaultValue: 90 },
      { id: 'disk', label: 'Disk Usage (%)', unit: '%', defaultOperator: '>', defaultValue: 85 },
    ],
    events: [
      { id: 'offline', label: 'Node Offline', defaultSeverity: 'critical' },
      { id: 'online', label: 'Node Online', defaultSeverity: 'info' },
    ],
    variables: [
      { name: '{{resource.name}}', description: 'Node hostname' },
      { name: '{{resource.id}}', description: 'Node ID' },
      { name: '{{value}}', description: 'Current metric value' },
      { name: '{{threshold}}', description: 'Configured threshold' },
      { name: '{{operator}}', description: 'Comparison operator' },
      { name: '{{metric}}', description: 'Metric name (cpu, memory, disk)' },
      { name: '{{severity}}', description: 'Alert severity' },
      { name: '{{alert_name}}', description: 'Alert rule name' },
      { name: '{{duration}}', description: 'Configured fire-after duration' },
      { name: '{{fired_at}}', description: 'When the alert started firing' },
      { name: '{{fired_duration}}', description: 'How long alert has been firing' },
    ],
  },
  {
    id: 'container',
    label: 'Container',
    metrics: [
      { id: 'cpu', label: 'CPU Usage (%)', unit: '%', defaultOperator: '>', defaultValue: 90 },
      { id: 'memory', label: 'Memory Usage (%)', unit: '%', defaultOperator: '>', defaultValue: 90 },
    ],
    events: [
      { id: 'stopped', label: 'Container Stopped', defaultSeverity: 'warning' },
      { id: 'started', label: 'Container Started', defaultSeverity: 'info' },
      { id: 'exited', label: 'Container Exited', defaultSeverity: 'warning' },
    ],
    variables: [
      { name: '{{resource.name}}', description: 'Container name' },
      { name: '{{resource.id}}', description: 'Container ID' },
      { name: '{{value}}', description: 'Current metric value' },
      { name: '{{threshold}}', description: 'Configured threshold' },
      { name: '{{metric}}', description: 'Metric name (cpu, memory)' },
      { name: '{{node_name}}', description: 'Node hosting this container' },
      { name: '{{severity}}', description: 'Alert severity' },
      { name: '{{alert_name}}', description: 'Alert rule name' },
      { name: '{{fired_at}}', description: 'When the alert started firing' },
      { name: '{{fired_duration}}', description: 'How long alert has been firing' },
    ],
  },
  {
    id: 'proxy',
    label: 'Proxy Host',
    metrics: [],
    events: [
      { id: 'health.offline', label: 'Health Offline', defaultSeverity: 'critical' },
      { id: 'health.degraded', label: 'Health Degraded', defaultSeverity: 'warning' },
      { id: 'health.online', label: 'Health Online', defaultSeverity: 'info' },
      { id: 'created', label: 'Proxy Created', defaultSeverity: 'info' },
      { id: 'deleted', label: 'Proxy Deleted', defaultSeverity: 'info' },
    ],
    variables: [
      { name: '{{resource.name}}', description: 'Domain name(s)' },
      { name: '{{resource.id}}', description: 'Proxy host ID' },
      { name: '{{health_status}}', description: 'Health status' },
      { name: '{{severity}}', description: 'Alert severity' },
      { name: '{{alert_name}}', description: 'Alert rule name' },
    ],
  },
  {
    id: 'certificate',
    label: 'Certificate',
    metrics: [],
    events: [
      { id: 'issued', label: 'Certificate Issued', defaultSeverity: 'info' },
      { id: 'renewed', label: 'Certificate Renewed', defaultSeverity: 'info' },
      { id: 'renewal_failed', label: 'Certificate Renewal Failed', defaultSeverity: 'critical' },
      { id: 'expired', label: 'Certificate Expired', defaultSeverity: 'critical' },
    ],
    variables: [
      { name: '{{resource.name}}', description: 'Certificate domain(s)' },
      { name: '{{resource.id}}', description: 'Certificate ID' },
      { name: '{{days_until_expiry}}', description: 'Days until expiry' },
      { name: '{{expiry_date}}', description: 'Expiry date' },
      { name: '{{severity}}', description: 'Alert severity' },
      { name: '{{alert_name}}', description: 'Alert rule name' },
    ],
  },
];

export const CATEGORY_MAP = new Map(ALERT_CATEGORIES.map((c) => [c.id, c]));

// ── EventBus → Notification Event Mapping ─────────────────────────────

export interface EventMapping {
  category: AlertCategory;
  eventId: string;
  match: (payload: any) => boolean;
  extractResource: (payload: any) => { type: string; id: string; name?: string };
  extractData?: (payload: any) => Record<string, unknown>;
}

export const EVENT_BUS_MAPPINGS: Record<string, EventMapping[]> = {
  'node.changed': [
    {
      category: 'node', eventId: 'online',
      match: (p) => p.status === 'online',
      extractResource: (p) => ({ type: 'node', id: p.id, name: p.hostname }),
    },
    {
      category: 'node', eventId: 'offline',
      match: (p) => p.status === 'offline',
      extractResource: (p) => ({ type: 'node', id: p.id, name: p.hostname }),
    },
  ],
  'ssl.cert.changed': [
    {
      category: 'certificate', eventId: 'issued',
      match: (p) => p.action === 'created',
      extractResource: (p) => ({ type: 'certificate', id: p.id, name: p.name }),
    },
    {
      category: 'certificate', eventId: 'renewed',
      match: (p) => p.action === 'renewed',
      extractResource: (p) => ({ type: 'certificate', id: p.id, name: p.name }),
    },
    {
      category: 'certificate', eventId: 'renewal_failed',
      match: (p) => p.action === 'renewal_failed',
      extractResource: (p) => ({ type: 'certificate', id: p.id, name: p.name }),
    },
    {
      category: 'certificate', eventId: 'expired',
      match: (p) => p.action === 'expired',
      extractResource: (p) => ({ type: 'certificate', id: p.id, name: p.name }),
    },
  ],
  'proxy.host.changed': [
    {
      category: 'proxy', eventId: 'created',
      match: (p) => p.action === 'created',
      extractResource: (p) => ({ type: 'proxy', id: p.id, name: p.domain }),
    },
    {
      category: 'proxy', eventId: 'deleted',
      match: (p) => p.action === 'deleted',
      extractResource: (p) => ({ type: 'proxy', id: p.id, name: p.domain }),
    },
    {
      category: 'proxy', eventId: 'health.offline',
      match: (p) => p.action === 'health.offline',
      extractResource: (p) => ({ type: 'proxy', id: p.id, name: p.domain }),
      extractData: (p) => ({ health_status: p.health_status }),
    },
    {
      category: 'proxy', eventId: 'health.degraded',
      match: (p) => p.action === 'health.degraded',
      extractResource: (p) => ({ type: 'proxy', id: p.id, name: p.domain }),
      extractData: (p) => ({ health_status: p.health_status }),
    },
    {
      category: 'proxy', eventId: 'health.online',
      match: (p) => p.action === 'health.online',
      extractResource: (p) => ({ type: 'proxy', id: p.id, name: p.domain }),
      extractData: (p) => ({ health_status: p.health_status }),
    },
  ],
  'docker.container.changed': [
    {
      category: 'container', eventId: 'started',
      match: (p) => p.action === 'started',
      extractResource: (p) => ({ type: 'container', id: p.id, name: p.name }),
      extractData: (p) => ({ nodeId: p.nodeId }),
    },
    {
      category: 'container', eventId: 'stopped',
      match: (p) => p.action === 'stopped',
      extractResource: (p) => ({ type: 'container', id: p.id, name: p.name }),
      extractData: (p) => ({ nodeId: p.nodeId }),
    },
    {
      category: 'container', eventId: 'exited',
      match: (p) => p.action === 'killed',
      extractResource: (p) => ({ type: 'container', id: p.id, name: p.name }),
      extractData: (p) => ({ nodeId: p.nodeId }),
    },
  ],
};


// ── Threshold Metric Extraction ───────────────────────────────────────

/** Given a category + metric, extract its value from a health report */
export function extractMetricFromHealthReport(category: string, metric: string, healthData: any): { values: Array<{ resourceId: string; value: number }> } | null {
  if (category === 'node') {
    switch (metric) {
      case 'cpu': {
        const cpu = healthData.cpuPercent ?? healthData.cpu_percent;
        if (typeof cpu !== 'number') return null;
        return { values: [{ resourceId: 'system', value: cpu }] };
      }
      case 'memory': {
        const total = healthData.systemMemoryTotalBytes ?? healthData.system_memory_total_bytes ?? 0;
        const used = healthData.systemMemoryUsedBytes ?? healthData.system_memory_used_bytes ?? 0;
        if (!total) return null;
        return { values: [{ resourceId: 'system', value: (used / total) * 100 }] };
      }
      case 'disk': {
        const mounts: any[] = healthData.diskMounts ?? healthData.disk_mounts ?? [];
        if (!Array.isArray(mounts) || mounts.length === 0) {
          const free = healthData.diskFreeBytes ?? healthData.disk_free_bytes;
          const total = healthData.diskTotalBytes ?? healthData.disk_total_bytes;
          if (typeof free !== 'number' || typeof total !== 'number' || total === 0) return null;
          return { values: [{ resourceId: '/', value: ((total - free) / total) * 100 }] };
        }
        return {
          values: mounts.map((m: any) => ({
            resourceId: m.mountPoint ?? m.mount_point ?? '/',
            value: m.usagePercent ?? m.usage_percent ?? 0,
          })),
        };
      }
    }
  }

  if (category === 'container') {
    const stats: any[] = healthData.containerStats ?? healthData.container_stats ?? [];
    if (!Array.isArray(stats)) return null;
    switch (metric) {
      case 'cpu':
        return {
          values: stats.map((s: any) => ({
            resourceId: s.name ?? s.containerId ?? '',
            value: s.cpuPercent ?? s.cpu_percent ?? 0,
          })),
        };
      case 'memory':
        return {
          values: stats.map((s: any) => {
            const used = s.memoryUsageBytes ?? s.memory_usage_bytes ?? 0;
            const limit = s.memoryLimitBytes ?? s.memory_limit_bytes ?? 0;
            return {
              resourceId: s.name ?? s.containerId ?? '',
              value: limit > 0 ? (used / limit) * 100 : 0,
            };
          }),
        };
    }
  }

  return null;
}

/** Evaluate a threshold condition */
export function evaluateThreshold(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case '>': return value > threshold;
    case '>=': return value >= threshold;
    case '<': return value < threshold;
    case '<=': return value <= threshold;
    default: return false;
  }
}
