import { fireEvent, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { StatusPage } from "@/pages/StatusPage";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { makeUser } from "@/test/fixtures";
import { renderWithRouter } from "@/test/render";
import type { StatusPageConfig } from "@/types";

vi.mock("@/hooks/use-realtime", () => ({
  useRealtime: vi.fn(),
}));

const baseConfig: StatusPageConfig = {
  enabled: true,
  title: "System Status",
  description: "Current service health",
  domain: "status.example.com",
  nodeId: null,
  sslCertificateId: null,
  proxyTemplateId: null,
  upstreamUrl: null,
  proxyHostId: null,
  publicIncidentLimit: 25,
  recentIncidentDays: 14,
  autoDegradedEnabled: true,
  autoOutageEnabled: true,
  autoDegradedSeverity: "warning",
  autoOutageSeverity: "critical",
  autoCreateThresholdSeconds: 600,
  autoResolveThresholdSeconds: 60,
};

describe("StatusPage", () => {
  beforeEach(() => {
    api.resetSessionState();
    vi.restoreAllMocks();
    useAuthStore.setState({
      user: makeUser({
        scopes: ["status-page:view", "status-page:manage"],
      }),
      isAuthenticated: true,
      isLoading: false,
    });
    vi.spyOn(api, "getStatusPageSettings").mockResolvedValue(baseConfig);
    vi.spyOn(api, "listStatusPageServices").mockResolvedValue([]);
    vi.spyOn(api, "listStatusPageIncidents").mockResolvedValue([]);
  });

  afterEach(() => {
    api.resetSessionState();
  });

  it("saves status page general and auto-incident settings payload", async () => {
    const updateStatusPageSettings = vi.spyOn(api, "updateStatusPageSettings").mockResolvedValue({
      ...baseConfig,
      title: "Gateway Status",
      publicIncidentLimit: 10,
    });

    renderWithRouter(<StatusPage />, {
      path: "/status-page/:tab?",
      route: "/status-page/settings",
    });

    const title = (await screen.findByLabelText("Public title")) as HTMLInputElement;
    const publicIncidentLimit = screen.getByLabelText("Public incident limit") as HTMLInputElement;

    fireEvent.change(title, { target: { value: "Gateway Status" } });
    fireEvent.change(publicIncidentLimit, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateStatusPageSettings).toHaveBeenCalledWith({
        title: "Gateway Status",
        description: "Current service health",
        recentIncidentDays: 14,
        publicIncidentLimit: 10,
        autoDegradedEnabled: true,
        autoOutageEnabled: true,
        autoDegradedSeverity: "warning",
        autoOutageSeverity: "critical",
        autoCreateThresholdSeconds: 600,
        autoResolveThresholdSeconds: 60,
      });
    });
  });
});
