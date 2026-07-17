import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { api } from "@/services/api";
import { renderWithRouter } from "@/test/render";
import type { DatabaseConnection, PostgresTableMetadata } from "@/types";
import { PostgresExplorer } from "./PostgresExplorer";

function makeDatabase(): DatabaseConnection {
  return {
    id: "db-1",
    slug: "db-1",
    name: "Main Postgres",
    type: "postgres",
    description: null,
    tags: [],
    manualSizeLimitMb: null,
    host: "localhost",
    port: 5432,
    databaseName: "app",
    username: "app",
    tlsEnabled: false,
    healthStatus: "online",
    lastHealthCheckAt: null,
    lastError: null,
    hasStoredPassword: true,
    config: {
      host: "localhost",
      port: 5432,
      database: "app",
      username: "app",
      password: "",
      sslEnabled: false,
    },
    createdById: "user-1",
    updatedById: null,
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
  };
}

function makeMetadata(overrides: Partial<PostgresTableMetadata> = {}): PostgresTableMetadata {
  return {
    schema: "public",
    table: "users",
    primaryKey: ["id"],
    hasPrimaryKey: true,
    columns: [
      {
        name: "id",
        dataType: "integer",
        udtName: "int4",
        udtSchema: "pg_catalog",
        nullable: false,
        isPrimaryKey: true,
        hasDefault: true,
      },
      {
        name: "name",
        dataType: "text",
        udtName: "text",
        udtSchema: "pg_catalog",
        nullable: false,
        isPrimaryKey: false,
        hasDefault: false,
      },
    ],
    ...overrides,
  };
}

describe("PostgresExplorer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "listPostgresSchemas").mockResolvedValue(["public"]);
    vi.spyOn(api, "listPostgresTables").mockResolvedValue([{ name: "users", type: "table" }]);
    vi.spyOn(api, "browsePostgresRows").mockResolvedValue({
      metadata: makeMetadata(),
      rows: [{ id: 1, name: "Alice" }],
      page: 1,
      limit: 100,
      total: 1,
    });
  });

  it("saves column type changes from the column dialog", async () => {
    const user = userEvent.setup();
    const updatedMetadata = makeMetadata({
      columns: [
        {
          ...makeMetadata().columns[0],
          dataType: "bigint",
          udtName: "int8",
        },
        makeMetadata().columns[1],
      ],
    });
    const updatePostgresColumnType = vi
      .spyOn(api, "updatePostgresColumnType")
      .mockResolvedValue(updatedMetadata);

    renderWithRouter(
      <PostgresExplorer
        database={makeDatabase()}
        canWrite={true}
        canAdmin={true}
        focused={false}
        onToggleFocus={vi.fn()}
      />,
      { path: "/databases/:id", route: "/databases/db-1" }
    );

    await screen.findByText("public.users");
    await user.click(screen.getByTitle("Column types"));
    await screen.findByRole("heading", { name: "Column Types" });

    const typeSelects = screen.getAllByRole("combobox");
    fireEvent.click(typeSelects[0]);
    fireEvent.click(await screen.findByText("bigint"));
    await user.click(screen.getByRole("button", { name: /save \(1\)/i }));

    await waitFor(() => {
      expect(updatePostgresColumnType).toHaveBeenCalledWith(
        "db-1",
        "public",
        "users",
        "id",
        "bigint"
      );
    });
  });
});
