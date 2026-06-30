import { describe, expect, it } from "vitest";
import { isGatewayUpdateTargetVersion, normalizeGatewayUpdateVersion } from "./AppStatusGate";

describe("gateway update version matching", () => {
  it("matches target and current versions regardless of v prefix", () => {
    expect(normalizeGatewayUpdateVersion("v2.4.0")).toBe("2.4.0");
    expect(isGatewayUpdateTargetVersion("2.4.0", "v2.4.0")).toBe(true);
    expect(isGatewayUpdateTargetVersion("v2.4.0", "2.4.0")).toBe(true);
    expect(isGatewayUpdateTargetVersion("2.4.1", "v2.4.0")).toBe(false);
  });
});
