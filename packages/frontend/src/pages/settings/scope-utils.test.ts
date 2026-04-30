import { describe, expect, it } from "vitest";
import {
  buildFinalScopes,
  deriveAllowedResourceIdsByScope,
  hasSelectableScopeBase,
  parseScopesForForm,
  requiresResourceSelection,
  scopeMatches,
} from "@/lib/scope-utils";

describe("scope editor utilities", () => {
  it("uses longest-match parsing for resource-scoped scope values", () => {
    expect(parseScopesForForm(["proxy:advanced:bypass:host-1"])).toEqual({
      baseScopes: ["proxy:advanced:bypass"],
      resources: { "proxy:advanced:bypass": ["host-1"] },
    });
  });

  it("does not parse exact restrictable scopes as narrower scope resources", () => {
    expect(parseScopesForForm(["proxy:advanced:bypass"])).toEqual({
      baseScopes: ["proxy:advanced:bypass"],
      resources: {},
    });
  });

  it("keeps broad and resource scopes mutually exclusive when building final scopes", () => {
    expect(
      buildFinalScopes(["proxy:view", "proxy:edit"], {
        "proxy:view": ["host-1"],
        "proxy:edit": ["host-2"],
      })
    ).toEqual(["proxy:edit:host-2", "proxy:view:host-1"]);
  });

  it("requires resources for scopes that were resource-limited when editing started", () => {
    expect(requiresResourceSelection("proxy:view", {}, ["proxy:view"])).toBe(true);
    expect(requiresResourceSelection("proxy:view", {}, [])).toBe(false);
  });

  it("does not let overlapping exact scopes imply each other", () => {
    expect(scopeMatches(["proxy:advanced"], "proxy:advanced:bypass")).toBe(false);
    expect(scopeMatches(["proxy:advanced:bypass:host-1"], "proxy:advanced")).toBe(false);
    expect(scopeMatches(["proxy:advanced:bypass"], "proxy:advanced:bypass:host-1")).toBe(true);
  });

  it("derives resource ids with longest-match parsing", () => {
    expect(deriveAllowedResourceIdsByScope(["proxy:advanced:bypass:host-1"])).toEqual({
      "proxy:advanced:bypass": ["host-1"],
    });
  });

  it("shows a base scope as selectable when the user owns only resource-scoped variants", () => {
    expect(hasSelectableScopeBase(["proxy:view:host-1"], "proxy:view")).toBe(true);
    expect(hasSelectableScopeBase(["proxy:advanced:bypass:host-1"], "proxy:advanced")).toBe(false);
  });
});
