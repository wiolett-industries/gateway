import { waitFor } from "@testing-library/react";
import { ApiClientBase, DEFAULT_CACHE_TTL } from "@/services/api-base";

class TestApiClient extends ApiClientBase {
  getThing() {
    return this.request<{ value: number }>("/thing");
  }

  updateThing() {
    return this.request<void>("/thing", { method: "POST", body: JSON.stringify({ ok: true }) });
  }
}

describe("ApiClientBase", () => {
  it("returns cached GET data immediately and refreshes it in the background", async () => {
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
    expect(await client.getThing()).toEqual({ value: 1 });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(client.getCached<{ value: number }>("req:/api/thing", DEFAULT_CACHE_TTL)).toEqual({
        value: 2,
      });
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
});
