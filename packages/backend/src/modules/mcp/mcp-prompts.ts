import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasScope } from '@/lib/permissions.js';

type PromptDefinition = {
  name: string;
  title: string;
  description: string;
  requiredScopes: string[];
  text: string;
};

function canAccess(scopes: string[], requiredScopes: string[]): boolean {
  return requiredScopes.some((scope) => hasScope(scopes, scope));
}

function prompt(text: string) {
  return {
    messages: [
      {
        role: 'user' as const,
        content: { type: 'text' as const, text },
      },
    ],
  };
}

const prompts: PromptDefinition[] = [
  {
    name: 'investigate-service-outage',
    title: 'Investigate service outage',
    description: 'Triage a service outage using Gateway health, node, Docker, logging, and status data.',
    requiredScopes: ['proxy:list', 'nodes:list', 'docker:containers:list', 'logs:read', 'status-page:view'],
    text: 'Investigate the reported service outage. Start by reading the Gateway overview, then inspect relevant proxy hosts, nodes, Docker containers, logs, and status page incidents allowed by this token. Summarize likely impact, evidence, and the next safest operator action without assuming permissions you do not have.',
  },
  {
    name: 'rollout-container-image',
    title: 'Roll out container image',
    description: 'Plan a Docker image rollout through existing container tools.',
    requiredScopes: ['docker:containers:manage', 'docker:images:pull'],
    text: 'Plan a controlled container image rollout. Confirm the target node, container, current image, desired tag, dependency risk, and rollback path. Use only available Docker tools, and treat recreate/update operations as operationally risky actions requiring explicit operator intent.',
  },
  {
    name: 'create-status-incident',
    title: 'Create status incident',
    description: 'Draft a status page incident workflow and operator checklist.',
    requiredScopes: ['status-page:incidents:create', 'status-page:view'],
    text: 'Prepare a status page incident workflow. Identify affected services, customer-facing summary, severity, timestamps, and update cadence. Prompts do not create incidents directly; use only available Gateway tools or instruct the operator which REST action is needed.',
  },
  {
    name: 'review-node-health',
    title: 'Review node health',
    description: 'Review node fleet health and identify risky nodes.',
    requiredScopes: ['nodes:list', 'nodes:details'],
    text: 'Review Gateway node health. Read node resources and available details, group nodes by status and type, call out disconnected or stale nodes, and recommend the least invasive checks before using console or configuration-changing tools.',
  },
  {
    name: 'provision-proxy-host',
    title: 'Provision proxy host',
    description: 'Guide reverse proxy provisioning with certificate and node checks.',
    requiredScopes: ['proxy:create', 'proxy:list'],
    text: 'Guide provisioning a reverse proxy host. Verify domain names, target upstream, node placement, SSL requirements, existing certificates, access list needs, and health check settings. Do not invent hostnames, ports, or certificate IDs; request missing operator-specific values.',
  },
  {
    name: 'renew-or-debug-certificate',
    title: 'Renew or debug certificate',
    description: 'Troubleshoot expiring or failed SSL certificate renewal.',
    requiredScopes: ['ssl:cert:list', 'ssl:cert:issue', 'pki:cert:list'],
    text: 'Troubleshoot certificate renewal. Read expiring certificates and related proxy usage, distinguish ACME SSL certificates from internal PKI certificates, verify domain coverage and challenge assumptions, and recommend renewal or replacement steps allowed by this token.',
  },
];

export function registerMcpPrompts(server: McpServer, scopes: string[]): void {
  for (const definition of prompts) {
    if (!canAccess(scopes, definition.requiredScopes)) continue;
    server.registerPrompt(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
      },
      () => prompt(definition.text)
    );
  }
}
