import { describe, expect, it } from "vitest";
import { buildRuntimePayloadFromForm, type RuntimeFormValues } from "./runtime-payload";

const BASELINE: RuntimeFormValues = {
  restartPolicy: "no",
  maxRetries: "0",
  memoryMB: "",
  memSwapMB: "",
  cpuCount: "",
  cpuShares: "",
  pidsLimit: "",
};

describe("buildRuntimePayloadFromForm", () => {
  it("returns null when runtime form values are unchanged", () => {
    expect(buildRuntimePayloadFromForm(BASELINE, BASELINE)).toBeNull();
  });

  it("sends zero values when limits are cleared from the applied baseline", () => {
    const baseline: RuntimeFormValues = {
      ...BASELINE,
      memoryMB: "256",
      cpuCount: "0.5",
      cpuShares: "512",
      pidsLimit: "64",
    };

    expect(buildRuntimePayloadFromForm(BASELINE, baseline)).toEqual({
      memoryLimit: 0,
      memorySwap: 0,
      nanoCPUs: 0,
      cpuShares: 0,
      pidsLimit: 0,
      restartPolicy: "no",
    });
  });

  it("stores Docker memory swap as memory plus extra swap", () => {
    expect(
      buildRuntimePayloadFromForm({ ...BASELINE, memoryMB: "256", memSwapMB: "128" }, BASELINE)
    ).toEqual({
      memoryLimit: 256 * 1048576,
      memorySwap: 384 * 1048576,
      restartPolicy: "no",
    });
  });
});
