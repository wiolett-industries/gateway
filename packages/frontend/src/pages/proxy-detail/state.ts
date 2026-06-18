import type { ForwardScheme, ProxyHost } from "@/types";

export interface ProxyHostDetailFormState {
  customHeaders: ProxyHost["customHeaders"];
  cacheEnabled: boolean;
  cacheMaxAge: number;
  rateLimitEnabled: boolean;
  rateLimitRPS: number;
  rateLimitBurst: number;
  customRewrites: ProxyHost["customRewrites"];
  accessListId: string;
  healthCheckUrl: string;
  healthCheckExpectedStatus: number | null;
  healthCheckExpectedBody: string;
  healthCheckBodyMatchMode: "includes" | "exact" | "starts_with" | "ends_with";
  healthCheckSlowThreshold: number;
  nginxTemplateId: string;
  templateVariables: Record<string, string | number | boolean>;
  templateForwardScheme: ForwardScheme;
  templateForwardHost: string;
  templateForwardPort: number;
  templateRedirectUrl: string;
  templateRedirectStatusCode: number;
  advancedConfig: string;
  rawConfig: string;
}

export function deriveProxyHostDetailFormState(host: ProxyHost): ProxyHostDetailFormState {
  return {
    customHeaders: host.customHeaders || [],
    cacheEnabled: host.cacheEnabled,
    cacheMaxAge: host.cacheOptions?.maxAge || 3600,
    rateLimitEnabled: host.rateLimitEnabled,
    rateLimitRPS: host.rateLimitOptions?.requestsPerSecond || 100,
    rateLimitBurst: host.rateLimitOptions?.burst || 200,
    customRewrites: host.customRewrites || [],
    accessListId: host.accessListId || "",
    healthCheckUrl: host.healthCheckUrl || "/",
    healthCheckExpectedStatus: host.healthCheckExpectedStatus ?? null,
    healthCheckExpectedBody: host.healthCheckExpectedBody || "",
    healthCheckBodyMatchMode: host.healthCheckBodyMatchMode || "includes",
    healthCheckSlowThreshold: host.healthCheckSlowThreshold ?? 3,
    nginxTemplateId: host.nginxTemplateId || "",
    templateVariables: host.templateVariables || {},
    templateForwardScheme: host.forwardScheme || "http",
    templateForwardHost: host.forwardHost || "",
    templateForwardPort: host.forwardPort || 80,
    templateRedirectUrl: host.redirectUrl || "",
    templateRedirectStatusCode: host.redirectStatusCode || 301,
    advancedConfig: host.advancedConfig || "",
    rawConfig: host.rawConfig || "",
  };
}
