import { describe, expect, it } from "vitest";
import { buildGatewayReloadUrl, stripGatewayReloadParam } from "./gateway-update-reload";

describe("gateway update reload url helpers", () => {
  it("adds a cache-busting version parameter without dropping existing URL state", () => {
    expect(buildGatewayReloadUrl("https://gateway.test/settings?tab=updates#top", 123)).toBe(
      "/settings?tab=updates&_v=123#top"
    );
  });

  it("removes only the update cache-busting parameter on startup", () => {
    expect(stripGatewayReloadParam("https://gateway.test/settings?tab=updates&_v=123#top")).toBe(
      "/settings?tab=updates#top"
    );
    expect(stripGatewayReloadParam("https://gateway.test/settings?tab=updates#top")).toBeNull();
  });
});
