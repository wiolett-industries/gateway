import { beforeEach, describe, expect, it } from "vitest";
import { useResolvedPageContext } from "./resolved-page-context";

describe("resolved page context ownership", () => {
  beforeEach(() =>
    useResolvedPageContext.setState({
      ownerToken: 0,
      routeKey: null,
      status: "idle",
      resource: null,
    })
  );

  it("clears the previous resource immediately and ignores a late success", () => {
    const first = useResolvedPageContext.getState().begin("/nodes/first");
    useResolvedPageContext
      .getState()
      .resolve(first, { resourceType: "node", resourceId: "node-1" });
    const second = useResolvedPageContext.getState().begin("/nodes/second");

    expect(useResolvedPageContext.getState()).toMatchObject({
      status: "resolving",
      resource: null,
    });
    useResolvedPageContext.getState().resolve(first, { resourceType: "node", resourceId: "stale" });
    useResolvedPageContext
      .getState()
      .resolve(second, { resourceType: "node", resourceId: "node-2" });
    expect(useResolvedPageContext.getState().resource?.resourceId).toBe("node-2");
  });

  it("ignores cleanup and failure from a previous route owner", () => {
    const first = useResolvedPageContext.getState().begin("/databases/first");
    const second = useResolvedPageContext.getState().begin("/databases/second");
    useResolvedPageContext
      .getState()
      .resolve(second, { resourceType: "database", resourceId: "db-2" });
    useResolvedPageContext.getState().fail(first);
    useResolvedPageContext.getState().clear(first);
    expect(useResolvedPageContext.getState()).toMatchObject({
      routeKey: "/databases/second",
      status: "ready",
      resource: { resourceId: "db-2" },
    });
  });
});
