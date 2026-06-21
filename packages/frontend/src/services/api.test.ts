import { api } from "@/services/api";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function lastJsonBody(fetchMock: ReturnType<typeof vi.spyOn>) {
  const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
  return init?.body ? JSON.parse(String(init.body)) : undefined;
}

describe("api client contract", () => {
  beforeEach(() => {
    api.resetSessionState();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    api.resetSessionState();
    vi.useRealTimers();
  });

  it("serializes proxy host list filters and unwraps proxy host mutations", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "proxy-1", domainNames: ["app.example.com"] }],
          total: 1,
          page: 2,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-token" }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "proxy-1", accessListId: null } }));

    await expect(
      api.listProxyHosts({
        page: 2,
        limit: 50,
        search: "app",
        type: "proxy",
        healthStatus: "online",
        enabled: false,
        sortBy: "domainNames",
        sortOrder: "asc",
        nodeId: "node-1",
      })
    ).resolves.toMatchObject({ total: 1, page: 2 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/proxy-hosts?page=2&limit=50&search=app&type=proxy&healthStatus=online&enabled=false&sortBy=domainNames&sortOrder=asc&nodeId=node-1"
    );

    await expect(api.updateProxyHost("proxy-1", { accessListId: null })).resolves.toEqual({
      id: "proxy-1",
      accessListId: null,
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/proxy-hosts/proxy-1");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "PUT" });
    expect(lastJsonBody(fetchMock)).toEqual({ accessListId: null });
  });

  it("serializes oauth consent and authorization requests", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          client: { id: "client 1", name: "Codex" },
          scopes: ["proxy:hosts:view"],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-token" }))
      .mockResolvedValueOnce(jsonResponse({ redirectUrl: "/oauth/callback?ok=1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { clientId: "client 1", resource: "https://mcp.example/one", scopes: ["a"] },
        })
      );

    await expect(api.getOAuthConsent("request 1/2")).resolves.toMatchObject({
      client: { id: "client 1" },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/oauth/consent/request%201%2F2");

    await expect(api.approveOAuthConsent("request 1/2", ["proxy:hosts:view"])).resolves.toEqual({
      redirectUrl: "/oauth/callback?ok=1",
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/oauth/consent/request%201%2F2/approve");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({
      scopes: ["proxy:hosts:view"],
    });

    await expect(
      api.updateOAuthAuthorization("client 1", "https://mcp.example/one", ["a"])
    ).resolves.toMatchObject({ clientId: "client 1", resource: "https://mcp.example/one" });
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "/api/oauth/authorizations/client%201?resource=https%3A%2F%2Fmcp.example%2Fone"
    );
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ method: "PATCH" });
    expect(lastJsonBody(fetchMock)).toEqual({ scopes: ["a"] });
  });

  it("serializes postgres row queries and mutations without changing value types", async () => {
    const primaryKey = { id: 7 };
    const values = { amount: 42, enabled: true, status: "ready", happenedAt: "2026-06-21" };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            metadata: { columns: [] },
            rows: [{ id: 7 }],
            total: 1,
            page: 3,
            limit: 25,
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-token" }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 7, ...values } }));

    await expect(
      api.browsePostgresRows("db-1", {
        schema: "public",
        table: "orders",
        page: 3,
        limit: 25,
        sortBy: "created_at",
        sortOrder: "desc",
        searchColumn: "status",
        searchOperation: "equals",
        searchValue: "ready",
      })
    ).resolves.toMatchObject({ total: 1, page: 3, limit: 25 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/databases/db-1/postgres/rows?schema=public&table=orders&page=3&limit=25&sortBy=created_at&sortOrder=desc&searchColumn=status&searchOperation=equals&searchValue=ready"
    );

    await expect(
      api.updatePostgresRow("db-1", "public", "orders", primaryKey, values)
    ).resolves.toMatchObject({ id: 7, amount: 42 });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/databases/db-1/postgres/rows");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "PATCH" });
    expect(lastJsonBody(fetchMock)).toEqual({
      schema: "public",
      table: "orders",
      primaryKey,
      values,
    });
  });

  it("adds docker list metadata and supports cache-busting container inspect", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T12:00:00Z"));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "container-1", name: "api" }],
          total: 120,
          limit: 50,
          truncated: true,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ data: { id: "container-1", name: "api" } }));

    await expect(
      api.listDockerContainers("node-1", { search: "api", noCache: true })
    ).resolves.toEqual([
      {
        id: "container-1",
        name: "api",
        _listTotal: 120,
        _listLimit: 50,
        _listTruncated: true,
      },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/docker/nodes/node-1/containers?search=api&_t=1782043200000"
    );

    await expect(api.inspectContainer("node-1", "container-1", true)).resolves.toEqual({
      id: "container-1",
      name: "api",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/docker/nodes/node-1/containers/container-1?_t=1782043200000"
    );
  });

  it("serializes notification alert, webhook, and delivery requests", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "rule-1", name: "CPU High" }],
          total: 1,
          page: 2,
          limit: 25,
          totalPages: 1,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "webhook-1", name: "Ops", enabled: false }],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-token" }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "rule-1", enabled: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: { rendered: '{"ok":true}', context: {} } }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { total: 3, success: 2, failed: 1, retrying: 0 } })
      );

    await expect(
      api.listAlertRules({
        page: 2,
        limit: 25,
        type: "threshold",
        enabled: false,
        search: "cpu",
      })
    ).resolves.toMatchObject({ total: 1, page: 2 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/notifications/alert-rules?page=2&limit=25&type=threshold&enabled=false&search=cpu"
    );

    await expect(api.listWebhooks({ enabled: false, search: "ops" })).resolves.toMatchObject({
      total: 1,
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/notifications/webhooks?enabled=false&search=ops"
    );

    await expect(api.updateAlertRule("rule-1", { enabled: false })).resolves.toMatchObject({
      id: "rule-1",
      enabled: false,
    });
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/api/notifications/alert-rules/rule-1");
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ method: "PUT" });
    expect(lastJsonBody(fetchMock)).toEqual({ enabled: false });

    await expect(api.previewWebhookTemplate('{"ok":true}')).resolves.toMatchObject({
      rendered: '{"ok":true}',
    });
    expect(fetchMock.mock.calls[4]?.[0]).toBe("/api/notifications/webhooks/preview");
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({ method: "POST" });
    expect(lastJsonBody(fetchMock)).toEqual({ bodyTemplate: '{"ok":true}' });

    await expect(api.getDeliveryStats("webhook-1")).resolves.toEqual({
      total: 3,
      success: 2,
      failed: 1,
      retrying: 0,
    });
    expect(fetchMock.mock.calls[5]?.[0]).toBe(
      "/api/notifications/deliveries/stats?webhookId=webhook-1"
    );
  });

  it("serializes logging environment, search, and facets requests", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "env-1", name: "Production" }] }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-token" }))
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: "log-1", message: "hello" }], nextCursor: "cursor-2" })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            severities: [{ severity: "info", count: 3 }],
            services: [{ service: "api", count: 2 }],
            sources: [],
            traceIds: [],
            spanIds: [],
            requestIds: [],
            labelKeys: [],
            fieldKeys: [],
          },
        })
      );

    await expect(api.listLoggingEnvironments({ search: "prod" })).resolves.toEqual([
      { id: "env-1", name: "Production" },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/logging/environments?search=prod");

    await expect(
      api.searchLogs("env-1", {
        message: "hello",
        limit: 25,
        fields: { status: { op: "eq", value: 200 } },
      })
    ).resolves.toEqual({ data: [{ id: "log-1", message: "hello" }], nextCursor: "cursor-2" });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/logging/environments/env-1/search");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "POST" });
    expect(lastJsonBody(fetchMock)).toEqual({
      limit: 25,
      message: "hello",
      fields: { status: { op: "eq", value: 200 } },
    });

    await expect(
      api.getLoggingFacets("env-1", {
        from: "2026-06-21T00:00:00.000Z",
        to: "2026-06-21T01:00:00.000Z",
      })
    ).resolves.toMatchObject({ severities: [{ severity: "info", count: 3 }] });
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "/api/logging/environments/env-1/facets?from=2026-06-21T00%3A00%3A00.000Z&to=2026-06-21T01%3A00%3A00.000Z"
    );
  });

  it("serializes system, license, and housekeeping requests", async () => {
    const housekeepingConfig = { enabled: true, retentionDays: 14 };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { version: "2.4.0", updateAvailable: false } }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-token" }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { status: "scheduled", targetVersion: "2.4.1" } })
      )
      .mockResolvedValueOnce(jsonResponse({ data: { tier: "enterprise", active: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: { tier: "enterprise", active: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: housekeepingConfig }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "run-1", status: "completed" } }));

    await expect(api.getVersionInfo()).resolves.toMatchObject({ version: "2.4.0" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/system/version");

    await expect(api.triggerUpdate("2.4.1")).resolves.toEqual({
      status: "scheduled",
      targetVersion: "2.4.1",
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/system/update");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({
      version: "2.4.1",
    });

    await expect(api.getLicenseStatus()).resolves.toMatchObject({ tier: "enterprise" });
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/api/system/license/status");

    await expect(api.activateLicense("license-key")).resolves.toMatchObject({ active: true });
    expect(fetchMock.mock.calls[4]?.[0]).toBe("/api/system/license/activate");
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String((fetchMock.mock.calls[4]?.[1] as RequestInit).body))).toEqual({
      licenseKey: "license-key",
    });

    await expect(api.updateHousekeepingConfig(housekeepingConfig)).resolves.toEqual(
      housekeepingConfig
    );
    expect(fetchMock.mock.calls[5]?.[0]).toBe("/api/housekeeping/config");
    expect(fetchMock.mock.calls[5]?.[1]).toMatchObject({ method: "PUT" });
    expect(lastJsonBody(fetchMock)).toEqual(housekeepingConfig);

    await expect(api.runHousekeeping()).resolves.toMatchObject({ id: "run-1" });
    expect(fetchMock.mock.calls[6]?.[0]).toBe("/api/housekeeping/run");
    expect(fetchMock.mock.calls[6]?.[1]).toMatchObject({ method: "POST" });
  });
});
