/**
 * Handlebars template engine and built-in presets for webhook notifications.
 */

import Handlebars from 'handlebars';
import { SEVERITY_COLOR, SEVERITY_EMOJI, type Severity } from './notification.constants.js';

// ── Handlebars Helpers ────────────────────────────────────────────────

const hbs = Handlebars.create();

hbs.registerHelper('eq', (a, b) => a === b);
hbs.registerHelper('ne', (a, b) => a !== b);
hbs.registerHelper('gt', (a, b) => a > b);
hbs.registerHelper('lt', (a, b) => a < b);
hbs.registerHelper('gte', (a, b) => a >= b);
hbs.registerHelper('lte', (a, b) => a <= b);
hbs.registerHelper('and', (a, b) => a && b);
hbs.registerHelper('or', (a, b) => a || b);
hbs.registerHelper('not', (a) => !a);
hbs.registerHelper('json', (obj) => JSON.stringify(obj));
hbs.registerHelper('uppercase', (str) => (typeof str === 'string' ? str.toUpperCase() : str));
hbs.registerHelper('lowercase', (str) => (typeof str === 'string' ? str.toLowerCase() : str));
hbs.registerHelper('truncate', (str, len) => {
  if (typeof str !== 'string') return str;
  const n = typeof len === 'number' ? len : 50;
  return str.length > n ? `${str.slice(0, n)}...` : str;
});
hbs.registerHelper('default', (value, defaultValue) => value ?? defaultValue);
hbs.registerHelper('join', (arr, sep) => (Array.isArray(arr) ? arr.join(typeof sep === 'string' ? sep : ', ') : arr));
hbs.registerHelper('round', (value, decimals) => {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  if (Number.isNaN(n)) return value;
  const d = typeof decimals === 'number' ? decimals : 0;
  return Number(n.toFixed(d));
});
hbs.registerHelper('math', (a, op, b) => {
  const x = Number(a),
    y = Number(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return a;
  switch (op) {
    case '+':
      return x + y;
    case '-':
      return x - y;
    case '*':
      return x * y;
    case '/':
      return y !== 0 ? x / y : 0;
    case '%':
      return y !== 0 ? x % y : 0;
    default:
      return x;
  }
});
hbs.registerHelper('percent', (value, total) => {
  const v = Number(value),
    t = Number(total);
  if (Number.isNaN(v) || Number.isNaN(t) || t === 0) return 0;
  return Number(((v / t) * 100).toFixed(1));
});
hbs.registerHelper('formatDuration', (seconds) => {
  const s = Number(seconds);
  if (Number.isNaN(s) || s < 0) return String(seconds);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
});
hbs.registerHelper('timeago', (timestamp) => {
  const d = typeof timestamp === 'string' ? new Date(timestamp) : timestamp instanceof Date ? timestamp : null;
  if (!d || Number.isNaN(d.getTime())) return String(timestamp);
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
});
hbs.registerHelper('dateformat', (timestamp, format) => {
  const d = typeof timestamp === 'string' ? new Date(timestamp) : timestamp instanceof Date ? timestamp : null;
  if (!d || Number.isNaN(d.getTime())) return String(timestamp);
  const fmt = typeof format === 'string' ? format : 'YYYY-MM-DD HH:mm';
  const pad = (n: number) => String(n).padStart(2, '0');
  return fmt
    .replace('YYYY', String(d.getFullYear()))
    .replace('MM', pad(d.getMonth() + 1))
    .replace('DD', pad(d.getDate()))
    .replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes()))
    .replace('ss', pad(d.getSeconds()));
});
hbs.registerHelper('pluralize', (count, singular, plural) => {
  const n = Number(count);
  const p = typeof plural === 'string' ? plural : `${singular}s`;
  return n === 1 ? singular : p;
});

// ── Template Compilation ──────────────────────────────────────────────

// JSON-escape helper — use in JSON templates: {{jsonescape resource.name}}
hbs.registerHelper('jsonescape', (str) => {
  if (typeof str !== 'string') return str;
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
});

/**
 * Compile and render a Handlebars template with the given context.
 * Returns the rendered string, or a fallback JSON on compilation error.
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  try {
    const compiled = hbs.compile(template, { noEscape: true });
    return compiled(context);
  } catch {
    // Fallback: raw JSON of the context so the delivery still has useful data
    return JSON.stringify(context);
  }
}

// ── Template Context Builder ──────────────────────────────────────────

export interface NotificationEvent {
  type: string;
  title: string;
  message: string;
  severity: Severity;
  resource: { type: string; id: string; name?: string };
  data: Record<string, unknown>;
  timestamp: string;
}

/** Build the full template context from a notification event + gateway URL */
export function buildTemplateContext(event: NotificationEvent, gatewayUrl?: string): Record<string, unknown> {
  return {
    event: event.type,
    event_title: event.title,
    title: event.title,
    message: event.message,
    severity: event.severity,
    severity_emoji: SEVERITY_EMOJI[event.severity],
    severity_color: SEVERITY_COLOR[event.severity],
    resource: event.resource,
    resourceType: event.resource.type,
    resourceId: event.resource.id,
    resourceName: event.resource.name ?? event.resource.id,
    data: event.data,
    timestamp: event.timestamp,
    gateway_url: gatewayUrl ?? '',
    // Flatten data for simpler template access
    ...Object.fromEntries(Object.entries(event.data).map(([k, v]) => [`data_${k}`, v])),
  };
}

// ── Presets ────────────────────────────────────────────────────────────

export interface TemplatePreset {
  id: string;
  name: string;
  description: string;
  urlHint: string;
  defaultHeaders: Record<string, string>;
  bodyTemplate: string;
}

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: 'discord',
    name: 'Discord',
    description: 'Rich embed notification via Discord webhook URL',
    urlHint: 'https://discord.com/api/webhooks/...',
    defaultHeaders: { 'Content-Type': 'application/json' },
    bodyTemplate: `{
  "embeds": [{
    "title": "{{severity_emoji}} {{title}}",
    "description": "{{message}}",
    "color": {{severity_color}},
    "fields": [
      {"name": "Resource", "value": "{{resourceType}}/{{resourceName}}", "inline": true},
      {"name": "Severity", "value": "{{uppercase severity}}", "inline": true}
    ],
    "timestamp": "{{timestamp}}"
  }]
}`,
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Block Kit message via Slack incoming webhook',
    urlHint: 'https://hooks.slack.com/services/...',
    defaultHeaders: { 'Content-Type': 'application/json' },
    bodyTemplate: `{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "{{severity_emoji}} *[{{uppercase severity}}] {{title}}*\\n{{message}}"
      }
    },
    {
      "type": "context",
      "elements": [
        {"type": "mrkdwn", "text": "*Resource:* {{resourceType}}/{{resourceName}}"},
        {"type": "mrkdwn", "text": "*Time:* {{timestamp}}"}
      ]
    }
  ]
}`,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Send message via Telegram Bot API. Set your bot token in the URL and chat_id in the template.',
    urlHint: 'https://api.telegram.org/bot<YOUR_BOT_TOKEN>/sendMessage',
    defaultHeaders: { 'Content-Type': 'application/json' },
    bodyTemplate: `{
  "chat_id": "YOUR_CHAT_ID",
  "text": "{{severity_emoji}} *[{{uppercase severity}}] {{title}}*\\n\\n{{message}}\\n\\n_Resource:_ {{resourceType}}/{{resourceName}}\\n_Time:_ {{timestamp}}",
  "parse_mode": "Markdown",
  "disable_web_page_preview": true
}`,
  },
  {
    id: 'json',
    name: 'JSON',
    description: 'Structured JSON payload suitable for any webhook receiver',
    urlHint: 'https://your-endpoint.example.com/webhook',
    defaultHeaders: { 'Content-Type': 'application/json' },
    bodyTemplate: `{
  "event": "{{event}}",
  "title": "{{title}}",
  "message": "{{message}}",
  "severity": "{{severity}}",
  "resource": {
    "type": "{{resourceType}}",
    "id": "{{resourceId}}",
    "name": "{{resourceName}}"
  },
  "data": {{{json data}}},
  "timestamp": "{{timestamp}}",
  "gateway_url": "{{gateway_url}}"
}`,
  },
  {
    id: 'plain',
    name: 'Plain Text',
    description: 'Simple text message, suitable for generic HTTP receivers',
    urlHint: 'https://your-endpoint.example.com/webhook',
    defaultHeaders: { 'Content-Type': 'text/plain' },
    bodyTemplate: `[{{uppercase severity}}] {{title}}
{{message}}
Resource: {{resourceType}}/{{resourceName}}
Time: {{timestamp}}`,
  },
];

export const PRESET_MAP = new Map(TEMPLATE_PRESETS.map((p) => [p.id, p]));

// ── Sample Event for Testing ──────────────────────────────────────────

export function buildSampleEvent(): NotificationEvent {
  return {
    type: 'alert.fired',
    title: 'CPU High on docker-01',
    message: 'CPU usage has exceeded 90% for more than 5 minutes on node docker-01.',
    severity: 'warning',
    resource: {
      type: 'node',
      id: '00000000-0000-0000-0000-000000000001',
      name: 'docker-01',
    },
    data: {
      metric: 'node.cpu',
      value: 92.5,
      threshold: 90,
      duration: '5m',
      rule_name: 'CPU High',
    },
    timestamp: new Date().toISOString(),
  };
}
