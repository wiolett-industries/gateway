import { isIP } from 'node:net';
import type { NodeHealthReport } from '@/db/schema/nodes.js';

const hostnameRegex =
  /^(?=.{1,253}\.?$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.?$/;

export function isValidNodeServiceAddress(value: string): boolean {
  return isIP(value) !== 0 || hostnameRegex.test(value);
}

export function getEffectiveNodeServiceAddress(node: {
  serviceAddress?: string | null;
  lastHealthReport?: NodeHealthReport | null;
}): string | null {
  const configured = node.serviceAddress?.trim();
  if (configured) return configured;
  return node.lastHealthReport?.localIpAddresses?.find((address) => address.trim().length > 0) ?? null;
}
