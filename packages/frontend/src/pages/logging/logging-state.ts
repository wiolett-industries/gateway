import type { LoggingEnvironment, LoggingSchema } from "@/types";

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizedNullableNumber(value: number | null | undefined) {
  return value ?? null;
}

export function isLoggingEnvironmentSettingsDirty(
  environment: LoggingEnvironment,
  draft: Partial<LoggingEnvironment>
) {
  return (
    (draft.schemaId ?? null) !== environment.schemaId ||
    (draft.enabled ?? environment.enabled) !== environment.enabled ||
    (draft.retentionDays ?? environment.retentionDays) !== environment.retentionDays ||
    normalizedNullableNumber(draft.rateLimitRequestsPerWindow) !==
      normalizedNullableNumber(environment.rateLimitRequestsPerWindow) ||
    normalizedNullableNumber(draft.rateLimitEventsPerWindow) !==
      normalizedNullableNumber(environment.rateLimitEventsPerWindow)
  );
}

export function isLoggingSchemaDirty(schema: LoggingSchema, draft: Partial<LoggingSchema>) {
  return (
    (draft.name ?? "") !== schema.name ||
    (draft.slug ?? "") !== schema.slug ||
    (draft.description ?? null) !== schema.description ||
    (draft.schemaMode ?? schema.schemaMode) !== schema.schemaMode ||
    JSON.stringify(draft.fieldSchema ?? schema.fieldSchema) !== JSON.stringify(schema.fieldSchema)
  );
}
