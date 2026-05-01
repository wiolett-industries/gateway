import { screen } from "@testing-library/react";
import { Route } from "react-router-dom";
import { toast } from "sonner";
import { vi } from "vitest";
import { RequireScope } from "@/components/common/RequireScope";
import { useAuthStore } from "@/stores/auth";
import { makeUser } from "@/test/fixtures";
import { renderWithRouter } from "@/test/render";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

describe("RequireScope", () => {
  it("renders protected content when the user has the required scope", () => {
    useAuthStore.setState({
      user: makeUser({ scopes: ["nodes:details"] }),
      isAuthenticated: true,
      isLoading: false,
    });

    renderWithRouter(
      <RequireScope scope="nodes:details">
        <div>Protected Content</div>
      </RequireScope>
    );

    expect(screen.getByText("Protected Content")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("redirects denied users and shows a toast once", async () => {
    useAuthStore.setState({
      user: makeUser({ scopes: [] }),
      isAuthenticated: true,
      isLoading: false,
    });

    renderWithRouter(
      <RequireScope scope="nodes:details">
        <div>Protected Content</div>
      </RequireScope>,
      {
        path: "/nodes",
        route: "/nodes",
        extraRoutes: <Route path="/" element={<div>Home</div>} />,
      }
    );

    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("You don't have permission to access this page");
  });
});
