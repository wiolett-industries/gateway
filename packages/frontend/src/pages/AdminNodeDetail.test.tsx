import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { makeNode, makeUser } from "@/test/fixtures";
import { AdminNodeDetail } from "./AdminNodeDetail";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/services/api", () => ({
  api: {
    getNode: vi.fn(),
    getNodeHealthHistory: vi.fn(),
  },
}));

vi.mock("./node-detail/NodeDetailsTab", () => ({
  NodeDetailsTab: () => <div>Node details content</div>,
}));

vi.mock("./node-detail/NodeMonitoringTab", () => ({
  NodeMonitoringTab: () => <div>Node monitoring content</div>,
}));

vi.mock("./node-detail/NodeConfigTab", () => ({
  NodeConfigTab: () => <div>Node config content</div>,
}));

vi.mock("./node-detail/NodeConsoleTab", () => ({
  NodeConsoleTab: () => <div>Node console content</div>,
}));

vi.mock("./node-detail/NodeLogsTab", () => ({
  NodeLogsTab: () => <div>Node logs content</div>,
}));

vi.mock("./node-detail/NodeNginxLogsTab", () => ({
  NodeNginxLogsTab: () => <div>Nginx logs content</div>,
}));

vi.mock("./DockerContainers", () => ({
  DockerContainers: () => <div>Docker containers content</div>,
}));

vi.mock("./DockerImages", () => ({
  DockerImages: () => <div>Docker images content</div>,
}));

vi.mock("./DockerVolumes", () => ({
  DockerVolumes: () => <div>Docker volumes content</div>,
}));

vi.mock("./DockerNetworks", () => ({
  DockerNetworks: () => <div>Docker networks content</div>,
}));

describe("AdminNodeDetail", () => {
  it("keeps the node page mounted when switching URL-backed tabs", async () => {
    useAuthStore.setState({
      user: makeUser({ scopes: ["nodes:details", "nodes:config:view", "nodes:logs"] }),
      isAuthenticated: true,
      isLoading: false,
    });
    vi.mocked(api.getNode).mockResolvedValue({
      ...makeNode({ id: "node-1", type: "nginx", hostname: "edge-1" }),
      lastHealthReport: null,
      lastStatsReport: null,
      liveHealthReport: null,
      liveStatsReport: null,
    });
    vi.mocked(api.getNodeHealthHistory).mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={["/nodes/node-1/details"]}>
        <Link to="/nodes/node-1/monitoring">Switch externally</Link>
        <Routes>
          <Route path="/nodes/:id/:tab?" element={<AdminNodeDetail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Node details content")).toBeInTheDocument();
    expect(api.getNode).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("link", { name: "Switch externally" }));

    expect(await screen.findByText("Node monitoring content")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Edge 1" })).toBeInTheDocument();
    await waitFor(() => expect(api.getNode).toHaveBeenCalledTimes(1));
  });
});
