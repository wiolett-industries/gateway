import { ApiClientBase, type ApiRequestError, DEFAULT_CACHE_TTL } from "@/services/api-base";
import { useAppStatusStore } from "@/stores/app-status";

class TestApiClient extends ApiClientBase {
  getThing() {
    return this.request<{ value: number }>("/thing");
  }

  updateThing() {
    return this.request<void>("/thing", { method: "POST", body: JSON.stringify({ ok: true }) });
  }
}

describe("ApiClientBase", () => {
  it("returns fresh GET data and updates the shared cache", async () => {
    const client = new TestApiClient();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

    expect(await client.getThing()).toEqual({ value: 1 });
    expect(await client.getThing()).toEqual({ value: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.getCached<{ value: number }>("req:/api/thing", DEFAULT_CACHE_TTL)).toEqual({
      value: 2,
    });
  });

  it("invalidates cached GET entries after a mutation", async () => {
    const client = new TestApiClient();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await client.getThing();
    expect(client.getCached("req:/api/thing")).toEqual({ value: 1 });

    await client.updateThing();

    expect(client.getCached("req:/api/thing")).toBeUndefined();
  });

  it("does not enter maintenance mode for ordinary 5xx API responses", async () => {
    const client = new TestApiClient();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(client.getThing()).rejects.toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    } satisfies Partial<ApiRequestError>);
    expect(useAppStatusStore.getState().maintenanceActive).toBe(false);
  });

  it("enters maintenance mode on a real network-level fetch failure", async () => {
    const client = new TestApiClient();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(client.getThing()).rejects.toMatchObject({
      status: 0,
      code: "SERVICE_UNAVAILABLE",
    } satisfies Partial<ApiRequestError>);
    expect(useAppStatusStore.getState().maintenanceActive).toBe(true);
  });

  it("opens the rate-limit blocker with a 60-second fallback window", async () => {
    const client = new TestApiClient();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00Z"));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 429 }));

    await expect(client.getThing()).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMIT_EXCEEDED",
      retryAfterSeconds: 60,
    } satisfies Partial<ApiRequestError>);

    expect(useAppStatusStore.getState().rateLimitedUntil).toBe(Date.now() + 60_000);

    vi.useRealTimers();
  });
});
