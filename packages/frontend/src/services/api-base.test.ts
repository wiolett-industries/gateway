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
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ csrfToken: "csrf-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await client.getThing();
    expect(client.getCached("req:/api/thing")).toEqual({ value: 1 });

    await client.updateThing();

    expect(client.getCached("req:/api/thing")).toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/thing",
      expect.objectContaining({
        credentials: "include",
        headers: expect.any(Headers),
      })
    );
    const headers = (fetchMock.mock.calls[2]?.[1] as RequestInit | undefined)?.headers as Headers;
    expect(headers.get("X-CSRF-Token")).toBe("csrf-token");
  });

  it("clears cache and rejects responses that complete after a session reset", async () => {
    const client = new TestApiClient();
    client.setCache("req:/api/thing", { value: 1 });
    let resolveFetch: (value: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })
    );

    const request = client.getThing();
    client.resetSessionState();
    resolveFetch(
      new Response(JSON.stringify({ value: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(request).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(client.getCached("req:/api/thing")).toBeUndefined();
  });

  it("rejects and avoids cache writes when the session changes during response parsing", async () => {
    const client = new TestApiClient();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Type": "application/json" }),
      json: async () => {
        client.resetSessionState();
        return { value: 2 };
      },
    } as Response);

    await expect(client.getThing()).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(client.getCached("req:/api/thing")).toBeUndefined();
  });

  it("rejects cachedRequest refreshes that complete after a session reset", async () => {
    const client = new TestApiClient();
    const request = client.cachedRequest("custom:key", async () => {
      client.resetSessionState();
      return { value: 3 };
    });

    await expect(request).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(client.getCached("custom:key")).toBeUndefined();
  });

  it("sends cookie credentials and no session Authorization header", async () => {
    const client = new TestApiClient();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ value: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await client.getThing();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/thing",
      expect.objectContaining({
        credentials: "include",
        headers: expect.any(Headers),
      })
    );
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Headers;
    expect(headers.has("Authorization")).toBe(false);
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
