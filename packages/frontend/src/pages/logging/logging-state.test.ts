import { describe, expect, it } from "vitest";
import type { LoggingEnvironment, LoggingSchema } from "@/types";
import { isLoggingEnvironmentSettingsDirty, isLoggingSchemaDirty, slugify } from "./logging-state";

const environment: LoggingEnvironment = {
  id: "env-1",
  name: "Production",
  slug: "production",
  description: null,
  enabled: true,
  schemaId: null,
  schemaName: null,
  schemaMode: "reject",
  retentionDays: 30,
  rateLimitRequestsPerWindow: null,
  rateLimitEventsPerWindow: null,
  fieldSchema: [],
  createdById: null,
  createdAt: "2026-04-27T00:00:00.000Z",
  updatedAt: "2026-04-27T00:00:00.000Z",
};

const schema: LoggingSchema = {
  id: "schema-1",
  name: "Audit Events",
  slug: "audit-events",
  description: null,
  schemaMode: "reject",
  fieldSchema: [{ location: "field", key: "statusCode", type: "number", required: false }],
  createdById: "user-1",
  createdAt: "2026-04-27T00:00:00.000Z",
  updatedAt: "2026-04-27T00:00:00.000Z",
};

describe("logging state helpers", () => {
  it("normalizes arbitrary names into slugs", () => {
    expect(slugify("  Audit Events!! ")).toBe("audit-events");
    expect(slugify("Already---Slug")).toBe("already-slug");
  });

  it("detects logging environment setting changes", () => {
    expect(
      isLoggingEnvironmentSettingsDirty(environment, {
        schemaId: null,
        enabled: true,
        retentionDays: 30,
        rateLimitRequestsPerWindow: null,
        rateLimitEventsPerWindow: undefined,
      })
    ).toBe(false);

    expect(isLoggingEnvironmentSettingsDirty(environment, { schemaId: "schema-1" })).toBe(true);
    expect(isLoggingEnvironmentSettingsDirty(environment, { enabled: false })).toBe(true);
    expect(isLoggingEnvironmentSettingsDirty(environment, { retentionDays: 7 })).toBe(true);
    expect(
      isLoggingEnvironmentSettingsDirty(environment, { rateLimitRequestsPerWindow: 100 })
    ).toBe(true);
    expect(isLoggingEnvironmentSettingsDirty(environment, { rateLimitEventsPerWindow: 500 })).toBe(
      true
    );
  });

  it("detects logging schema changes", () => {
    expect(
      isLoggingSchemaDirty(schema, {
        name: "Audit Events",
        slug: "audit-events",
        description: null,
        schemaMode: "reject",
        fieldSchema: [{ location: "field", key: "statusCode", type: "number", required: false }],
      })
    ).toBe(false);

    expect(isLoggingSchemaDirty(schema, { name: "Payments" })).toBe(true);
    expect(isLoggingSchemaDirty(schema, { schemaMode: "strip" })).toBe(true);
    expect(isLoggingSchemaDirty(schema, { fieldSchema: [] })).toBe(true);
  });
});
