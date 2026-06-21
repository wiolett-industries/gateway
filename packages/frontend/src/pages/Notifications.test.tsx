import { screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { Notifications } from "@/pages/Notifications";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { makeUser } from "@/test/fixtures";
import { renderWithRouter } from "@/test/render";
import type { AlertRule } from "@/types";

vi.mock("@/hooks/use-realtime", () => ({
  useRealtime: vi.fn(),
}));

function makeAlertRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: "alert-1",
    name: "CPU High",
    enabled: true,
    type: "threshold",
    category: "node",
    severity: "warning",
    metric: "cpu",
    metricTarget: null,
    operator: ">",
    thresholdValue: 80,
    durationSeconds: 300,
    fireThresholdPercent: 100,
    resolveAfterSeconds: 60,
    resolveThresholdPercent: 100,
    eventPattern: null,
    resourceIds: [],
    messageTemplate: null,
    webhookIds: ["webhook-1", "webhook-2"],
    cooldownSeconds: 900,
    isBuiltin: false,
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("Notifications page", () => {
  beforeEach(() => {
    api.resetSessionState();
    vi.restoreAllMocks();
    useAuthStore.setState({
      user: makeUser({ scopes: ["notifications:alerts:view"] }),
      isAuthenticated: true,
      isLoading: false,
    });
  });

  afterEach(() => {
    api.resetSessionState();
  });

  it("renders alert rules with formatted threshold conditions", async () => {
    const listAlertRules = vi.spyOn(api, "listAlertRules").mockResolvedValue({
      data: [makeAlertRule()],
      total: 1,
      page: 1,
      limit: 100,
      totalPages: 1,
    });

    renderWithRouter(<Notifications />, {
      path: "/notifications/:tab?",
      route: "/notifications/alerts",
    });

    await waitFor(() => {
      expect(screen.getByText("CPU High")).toBeInTheDocument();
    });

    expect(listAlertRules).toHaveBeenCalledWith({ limit: 100 });
    expect(screen.getByText("cpu > 80 • fire 100% in 5m • resolve 100% in 1m")).toBeInTheDocument();
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
