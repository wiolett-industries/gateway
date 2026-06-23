import { describe, expect, it } from "vitest";
import { effectiveHealthStatus } from "./helpers";

describe("proxy-detail helpers", () => {
  it("reports raw config hosts as health disabled", () => {
    expect(
      effectiveHealthStatus({
        rawConfigEnabled: true,
        healthStatus: "offline",
      })
    ).toBe("disabled");
  });
});
