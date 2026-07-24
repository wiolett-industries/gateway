import { createHash } from 'node:crypto';

export function migrationFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function migrationContainerState(inspect: Record<string, any>): string {
  const state = inspect.State?.Status ?? inspect.state ?? inspect.State;
  return typeof state === 'string' ? state.toLowerCase() : 'unknown';
}

export function migrationEnvNames(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.slice(0, Math.max(entry.indexOf('='), 0)))
    .filter(Boolean)
    .sort();
}

export function migrationResourceName(input: any, deployment?: { name: string }): string {
  return input.resource.type === 'container'
    ? input.resource.containerName
    : (deployment?.name ?? input.resource.deploymentId);
}

export function migrationItemName(item: Record<string, any>): string {
  return String(item.name ?? item.Name ?? item.id ?? item.Id ?? '').replace(/^\//, '');
}

export function migrationNetworkNames(inspect: Record<string, any> | undefined, deployment: any): string[] {
  if (deployment) return [deployment.networkName].filter(Boolean);
  return Object.keys(inspect?.NetworkSettings?.Networks ?? {}).sort();
}

export function migrationImageIdentities(inspect: Record<string, any> | undefined, deployment: any): string[] {
  const images = new Set<string>();
  if (inspect?.Image) images.add(String(inspect.Image));
  else if (inspect?.Config?.Image) images.add(String(inspect.Config.Image));
  for (const image of [deployment?.routerImage, deployment?.desiredConfig?.image]) if (image) images.add(String(image));
  for (const slot of deployment?.slots ?? []) {
    if (slot.image) images.add(String(slot.image));
    if (slot.desiredConfig?.image) images.add(String(slot.desiredConfig.image));
  }
  return [...images];
}

function records(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value : [];
}

function portNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : null;
}

export function isVersionOlder(candidate: unknown, required: unknown): boolean | null {
  if (typeof candidate !== 'string' || typeof required !== 'string') return null;
  const left = candidate.split(/[.-]/).map(Number);
  const right = required.split(/[.-]/).map(Number);
  if (left.some(Number.isNaN) || right.some(Number.isNaN)) return null;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}

export function migrationTargetNames(name: string, deployment: any): string[] {
  const names = new Set([name]);
  if (deployment?.routerName) names.add(String(deployment.routerName));
  for (const slot of records(deployment?.slots)) if (slot.containerName) names.add(String(slot.containerName));
  return [...names];
}

export function migrationSourceHostPorts(inspect: Record<string, any> | undefined, deployment: any): number[] {
  const ports = new Set<number>();
  for (const bindings of Object.values(inspect?.HostConfig?.PortBindings ?? {})) {
    for (const binding of records(bindings)) {
      const port = portNumber(binding.HostPort ?? binding.hostPort);
      if (port) ports.add(port);
    }
  }
  for (const route of records(deployment?.routes)) {
    const port = portNumber(route.hostPort);
    if (port) ports.add(port);
  }
  return [...ports];
}

export function migrationTargetHostPorts(containers: Array<Record<string, any>>): Set<number> {
  const ports = new Set<number>();
  for (const container of containers) {
    for (const value of records(container.Ports ?? container.ports)) {
      const port = portNumber(value.PublicPort ?? value.publicPort ?? value.hostPort);
      if (port) ports.add(port);
    }
  }
  return ports;
}

export function portableNetworkShape(network: Record<string, any>): string {
  const ipam = network.IPAM ?? network.ipam ?? {};
  return JSON.stringify({
    driver: network.Driver ?? network.driver ?? '',
    internal: network.Internal ?? network.internal ?? false,
    attachable: network.Attachable ?? network.attachable ?? false,
    ingress: network.Ingress ?? network.ingress ?? false,
    options: network.Options ?? network.options ?? {},
    ipam: {
      driver: ipam.Driver ?? ipam.driver ?? '',
      config: ipam.Config ?? ipam.config ?? [],
      options: ipam.Options ?? ipam.options ?? {},
    },
  });
}

export function hasImageTagCollision(
  sourceInspect: Record<string, any> | undefined,
  targetImages: Array<Record<string, any>>
): boolean {
  const tag = sourceInspect?.Config?.Image;
  const sourceId = sourceInspect?.Image;
  if (!tag || !sourceId) return false;
  return targetImages.some((image) => {
    const tags = image.RepoTags ?? image.repoTags ?? [];
    const id = image.Id ?? image.id;
    return Array.isArray(tags) && tags.includes(tag) && id && id !== sourceId;
  });
}

export function allowedSourceConsumers(inspect: Record<string, any> | undefined, deployment: any): Set<string> {
  const allowed = new Set<string>();
  for (const value of [inspect?.Id, inspect?.Name, deployment?.routerName]) {
    if (value) allowed.add(String(value).replace(/^\//, ''));
  }
  for (const slot of records(deployment?.slots)) {
    for (const value of [slot.containerId, slot.containerName]) {
      if (value) allowed.add(String(value).replace(/^\//, ''));
    }
  }
  return allowed;
}
