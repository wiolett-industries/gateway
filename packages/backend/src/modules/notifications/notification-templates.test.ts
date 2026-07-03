import { describe, expect, it } from 'vitest';
import {
  buildNotificationTemplateContext,
  buildSampleEvent,
  buildTemplateContext,
  renderTemplate,
} from './notification-templates.js';

describe('notification template context', () => {
  it('renders canonical dot variables and severity metadata', () => {
    const context = buildNotificationTemplateContext({
      notification: {
        type: 'alert.fired',
        title: 'High CPU',
        message: 'CPU is high',
        timestamp: '2026-04-01T00:00:00.000Z',
      },
      alert: {
        id: 'rule-1',
        name: 'High CPU',
        status: 'firing',
        severity: 'warning',
      },
      resource: {
        type: 'node',
        id: 'node-1',
        key: 'node-1',
        name: 'worker-1',
      },
      metric: {
        name: 'cpu',
        value: 91.23,
        threshold: 90,
        operator: '>',
        duration: 300,
      },
      node: {
        id: 'node-1',
        name: 'worker-1',
      },
      fired: {
        at: '2026-04-01T00:00:00.000Z',
        duration: 120,
      },
    });

    expect(
      renderTemplate(
        '{{alert.severity}} {{alert.severity.emoji}} {{uppercase alert.severity}} {{metric.value}} {{node.name}} {{resource.key}}',
        context
      )
    ).toBe('warning ⚠️ WARNING 91.23 worker-1 node-1');
  });

  it('returns the first non-empty value with coalesce', () => {
    const context = buildNotificationTemplateContext({
      notification: { type: 'alert.fired', title: 'Container alert' },
      alert: {
        id: 'rule-1',
        name: 'Container alert',
        status: 'firing',
        severity: 'critical',
      },
      resource: {
        type: 'container',
        id: null,
        key: 'node-1:backend',
        name: 'backend',
      },
    });

    expect(renderTemplate('{{coalesce node.name resource.name resource.key}}', context)).toBe('backend');
  });

  it('builds webhook context from the same canonical sample event', () => {
    const context = buildTemplateContext(buildSampleEvent(), 'https://gateway.example.com');

    expect(renderTemplate('{{notification.message}} {{resource.name}} {{metric.value}} {{gateway.url}}', context)).toBe(
      'CPU usage has exceeded 90% for more than 5 minutes on node docker-01. docker-01 92.5 https://gateway.example.com'
    );
    expect(renderTemplate('{{value}} {{data_value}} {{resourceName}}', context)).toBe('  ');
  });
});
