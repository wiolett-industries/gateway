import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { OAuthConsent } from "@/pages/OAuthConsent";
import { api } from "@/services/api";
import { renderWithRouter } from "@/test/render";
import type { OAuthConsentPreview } from "@/types";

const preview: OAuthConsentPreview = {
  requestId: "request-1",
  client: {
    id: "goc_client",
    name: "Local CLI",
    uri: null,
    logoUri: null,
  },
  account: {
    id: "user-1",
    email: "admin@example.com",
    name: "Admin User",
    avatarUrl: null,
  },
  requestedScopes: ["nodes:list", "docker:containers:view", "admin:users"],
  grantableScopes: ["nodes:list", "docker:containers:view"],
  unavailableScopes: ["admin:users"],
  manualApprovalScopes: [],
  resource: "https://gateway.example.com/api",
  resourceInfo: {
    resource: "https://gateway.example.com/api",
    name: "Gateway API",
    description: "REST API access for CLI and external applications.",
  },
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OAuthConsent", () => {
  it("shows client, selected account, grantable scopes, unavailable scopes, and warning", async () => {
    vi.spyOn(api, "getOAuthConsent").mockResolvedValue(preview);

    renderWithRouter(<OAuthConsent />, {
      path: "/oauth/consent",
      route: "/oauth/consent?request=request-1",
    });

    expect(await screen.findByText("Authorize Gateway API access")).toBeInTheDocument();
    expect(screen.getByText("Local CLI")).toHaveClass("text-foreground");
    expect(screen.getByText("Gateway API", { selector: ".text-foreground" })).toBeInTheDocument();
    expect(screen.queryByText("Access target")).not.toBeInTheDocument();
    expect(screen.queryByText(/REST API access for CLI/)).not.toBeInTheDocument();
    expect(screen.getByText("Admin User")).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByText("Unverified client")).toBeInTheDocument();
    expect(screen.getByText(/Only authorize tools you trust/)).toBeInTheDocument();
    expect(screen.getByText("List Nodes")).toBeInTheDocument();
    expect(screen.getByText("View Containers")).toBeInTheDocument();
    expect(screen.getByText("Manage Users")).toBeInTheDocument();
    expect(
      screen.getByText("These were requested but cannot be granted by your account.")
    ).toBeInTheDocument();
  });

  it("submits only selected grantable scopes", async () => {
    vi.spyOn(api, "getOAuthConsent").mockResolvedValue(preview);
    const approve = vi
      .spyOn(api, "approveOAuthConsent")
      .mockRejectedValue(new Error("stop before navigation"));

    renderWithRouter(<OAuthConsent />, {
      path: "/oauth/consent",
      route: "/oauth/consent?request=request-1",
    });

    const nodes = await screen.findByLabelText(/List Nodes/i);
    await userEvent.click(nodes);
    await userEvent.click(screen.getByRole("button", { name: /Authorize/i }));

    expect(approve).toHaveBeenCalledWith("request-1", ["docker:containers:view"]);
    expect(await screen.findByText("stop before navigation")).toBeInTheDocument();
  });

  it("delivers the callback in the background and shows a result screen", async () => {
    vi.spyOn(api, "getOAuthConsent").mockResolvedValue(preview);
    vi.spyOn(api, "approveOAuthConsent").mockResolvedValue({
      redirectUrl: "http://127.0.0.1:8765/callback?code=abc",
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    renderWithRouter(<OAuthConsent />, {
      path: "/oauth/consent",
      route: "/oauth/consent?request=request-1",
    });

    await screen.findByText("Authorize Gateway API access");
    await userEvent.click(screen.getByRole("button", { name: /Authorize/i }));

    expect(await screen.findByText("Authorization complete")).toBeInTheDocument();
    expect(screen.getByText(/If the application did not finish signing in/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open callback/i })).toHaveAttribute(
      "href",
      "http://127.0.0.1:8765/callback?code=abc"
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/callback?code=abc",
      expect.objectContaining({
        mode: "no-cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      })
    );
  });

  it("falls back to browser navigation when background callback delivery fails", async () => {
    vi.spyOn(api, "getOAuthConsent").mockResolvedValue(preview);
    vi.spyOn(api, "approveOAuthConsent").mockResolvedValue({
      redirectUrl: "http://127.0.0.1:8765/callback?code=abc",
    });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("callback offline"));
    const hrefSetter = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, href: "" },
    });
    Object.defineProperty(window.location, "href", {
      configurable: true,
      set: hrefSetter,
      get: () => "",
    });

    try {
      renderWithRouter(<OAuthConsent />, {
        path: "/oauth/consent",
        route: "/oauth/consent?request=request-1",
      });

      await screen.findByText("Authorize Gateway API access");
      await userEvent.click(screen.getByRole("button", { name: /Authorize/i }));

      expect(hrefSetter).toHaveBeenCalledWith("http://127.0.0.1:8765/callback?code=abc");
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it("preserves resource-scoped scope values when authorizing", async () => {
    vi.spyOn(api, "getOAuthConsent").mockResolvedValue({
      ...preview,
      requestedScopes: ["docker:containers:view:node-1"],
      grantableScopes: ["docker:containers:view:node-1"],
      unavailableScopes: [],
    });
    const approve = vi
      .spyOn(api, "approveOAuthConsent")
      .mockRejectedValue(new Error("stop before navigation"));

    renderWithRouter(<OAuthConsent />, {
      path: "/oauth/consent",
      route: "/oauth/consent?request=request-1",
    });

    expect(await screen.findByText("docker:containers:view:node-1")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /docker:containers:view:node-1/i })).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: /Authorize/i }));

    expect(approve).toHaveBeenCalledWith("request-1", ["docker:containers:view:node-1"]);
  });

  it("leaves manual approval scopes unchecked until explicitly selected", async () => {
    vi.spyOn(api, "getOAuthConsent").mockResolvedValue({
      ...preview,
      requestedScopes: ["nodes:list", "docker:containers:secrets"],
      grantableScopes: ["nodes:list", "docker:containers:secrets"],
      unavailableScopes: [],
      manualApprovalScopes: ["docker:containers:secrets"],
    });
    const approve = vi
      .spyOn(api, "approveOAuthConsent")
      .mockRejectedValue(new Error("stop before navigation"));

    renderWithRouter(<OAuthConsent />, {
      path: "/oauth/consent",
      route: "/oauth/consent?request=request-1",
    });

    expect(await screen.findByText(/reveal sensitive data/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /List Nodes/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Container Secrets/i })).not.toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: /Authorize/i }));

    expect(approve).toHaveBeenCalledWith("request-1", ["nodes:list"]);
  });
});
