import { describe, expect, it, vi } from "vitest";
import type { PostgresTableColumn } from "@/types";
import {
  createNewColumnDraft,
  currentColumnTypeValue,
  normalizeColumnType,
  normalizePostgresTypeAlias,
  POSTGRES_COLUMN_TYPE_OPTIONS,
  POSTGRES_IDENTIFIER_PATTERN,
  POSTGRES_SEARCH_OPERATIONS,
  secondaryColumnTypeLabel,
} from "./postgres-explorer-state";

function column(overrides: Partial<PostgresTableColumn>): PostgresTableColumn {
  return {
    name: "created_at",
    dataType: "timestamp without time zone",
    udtName: "timestamp",
    udtSchema: "pg_catalog",
    nullable: false,
    isPrimaryKey: false,
    hasDefault: false,
    ...overrides,
  };
}

describe("Postgres explorer state helpers", () => {
  it("keeps supported type and search options stable", () => {
    expect(POSTGRES_COLUMN_TYPE_OPTIONS).toContain("timestamp with time zone");
    expect(POSTGRES_COLUMN_TYPE_OPTIONS).toContain("jsonb");
    expect(POSTGRES_SEARCH_OPERATIONS.map((operation) => operation.value)).toEqual([
      "like",
      "equals",
      "notEquals",
      "greaterThan",
      "lessThan",
    ]);
  });

  it("validates PostgreSQL identifiers for new columns", () => {
    expect(POSTGRES_IDENTIFIER_PATTERN.test("valid_name_1")).toBe(true);
    expect(POSTGRES_IDENTIFIER_PATTERN.test("_valid$name")).toBe(true);
    expect(POSTGRES_IDENTIFIER_PATTERN.test("1invalid")).toBe(false);
    expect(POSTGRES_IDENTIFIER_PATTERN.test("invalid-name")).toBe(false);
  });

  it("creates deterministic new column drafts when entropy sources are controlled", () => {
    vi.spyOn(Date, "now").mockReturnValue(123);
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(createNewColumnDraft()).toEqual({
      id: "123-i",
      name: "",
      dataType: "text",
    });
  });

  it("normalizes PostgreSQL type aliases and current display values", () => {
    expect(normalizeColumnType("  TIMESTAMP   WITH   TIME   ZONE ")).toBe(
      "timestamp with time zone"
    );
    expect(normalizePostgresTypeAlias("int8")).toBe("bigint");
    expect(currentColumnTypeValue(column({ dataType: "timestamp without time zone" }))).toBe(
      "timestamp"
    );
    expect(currentColumnTypeValue(column({ dataType: "time without time zone" }))).toBe("time");
  });

  it("shows secondary type labels only when the UDT adds useful context", () => {
    expect(
      secondaryColumnTypeLabel(
        column({ dataType: "USER-DEFINED", udtName: "order_status", udtSchema: "public" })
      )
    ).toBe("order_status");
    expect(secondaryColumnTypeLabel(column({ dataType: "bigint", udtName: "int8" }))).toBe("");
    expect(
      secondaryColumnTypeLabel(
        column({ dataType: "timestamp without time zone", udtName: "timestamp" })
      )
    ).toBe("");
  });
});
