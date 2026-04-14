import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "react-router-dom";
import { vi } from "vitest";
import { CertificateDetail } from "@/pages/CertificateDetail";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { makeCertificate, makeUser } from "@/test/fixtures";
import { renderWithRouter } from "@/test/render";

vi.mock("@/hooks/use-realtime", () => ({
  useRealtime: vi.fn(),
}));

describe("CertificateDetail", () => {
  it("shows the system badge and hides revoke for system certificates", async () => {
    vi.spyOn(api, "getCertificate").mockResolvedValue(
      makeCertificate({ id: "cert-system", isSystem: true })
    );

    useAuthStore.setState({
      user: makeUser({ scopes: ["pki:cert:list", "pki:cert:revoke"] }),
      isAuthenticated: true,
      isLoading: false,
    });

    renderWithRouter(<CertificateDetail />, {
      path: "/certificates/:id",
      route: "/certificates/cert-system",
      extraRoutes: <Route path="/certificates" element={<div>Certificates</div>} />,
    });

    expect(
      await screen.findByRole("heading", { level: 1, name: "gateway-grpc" })
    ).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();

    const user = userEvent.setup();
    const trigger = screen.getAllByRole("button").at(-1);
    if (!trigger) throw new Error("Menu trigger not found");
    await user.click(trigger);

    expect(screen.queryByText("Revoke Certificate")).not.toBeInTheDocument();
  });

  it("shows revoke for normal active certificates when the user has scope", async () => {
    vi.spyOn(api, "getCertificate").mockResolvedValue(
      makeCertificate({ id: "cert-user", isSystem: false })
    );

    useAuthStore.setState({
      user: makeUser({ scopes: ["pki:cert:list", "pki:cert:revoke"] }),
      isAuthenticated: true,
      isLoading: false,
    });

    renderWithRouter(<CertificateDetail />, {
      path: "/certificates/:id",
      route: "/certificates/cert-user",
      extraRoutes: <Route path="/certificates" element={<div>Certificates</div>} />,
    });

    expect(
      await screen.findByRole("heading", { level: 1, name: "gateway-grpc" })
    ).toBeInTheDocument();

    const user = userEvent.setup();
    const trigger = screen.getAllByRole("button").at(-1);
    if (!trigger) throw new Error("Menu trigger not found");
    await user.click(trigger);

    expect(await screen.findByText("Revoke Certificate")).toBeInTheDocument();
  });
});
