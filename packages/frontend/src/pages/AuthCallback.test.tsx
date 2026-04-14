import { screen, waitFor } from "@testing-library/react";
import { Route } from "react-router-dom";
import { vi } from "vitest";
import { AuthCallback } from "@/pages/AuthCallback";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { makeUser } from "@/test/fixtures";
import { renderWithRouter } from "@/test/render";

describe("AuthCallback", () => {
  it("stores the session and redirects after a successful callback", async () => {
    vi.spyOn(api, "getCurrentUser").mockResolvedValue(makeUser({ scopes: ["nodes:list"] }));

    renderWithRouter(<AuthCallback />, {
      path: "/callback",
      route: "/callback?session=session-123",
      extraRoutes: <Route path="/" element={<div>Dashboard Home</div>} />,
    });

    expect(await screen.findByText("Dashboard Home")).toBeInTheDocument();

    await waitFor(() => {
      expect(useAuthStore.getState().sessionId).toBe("session-123");
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });
  });

  it("shows an error when no session token is provided", async () => {
    renderWithRouter(<AuthCallback />, {
      path: "/callback",
      route: "/callback",
    });

    expect(await screen.findByText("Authentication Failed")).toBeInTheDocument();
    expect(screen.getByText("No session token received")).toBeInTheDocument();
  });
});
