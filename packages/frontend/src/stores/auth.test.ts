import { registerAuthContextReset, useAuthStore } from "@/stores/auth";
import type { User } from "@/types";

const USER: User = {
  id: "user-1",
  oidcSubject: "oidc-user-1",
  email: "user@example.com",
  name: "User",
  avatarUrl: null,
  groupId: "group-1",
  groupName: "Group",
  scopes: ["proxy:view"],
  isBlocked: false,
};

afterEach(() => {
  registerAuthContextReset(() => {});
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });
});

describe("auth store session reset callback", () => {
  it("runs when the authenticated identity or scopes change", () => {
    const reset = vi.fn();
    registerAuthContextReset(reset);

    useAuthStore.getState().setUser(USER);
    expect(reset).toHaveBeenCalledTimes(1);

    useAuthStore.getState().setUser({ ...USER });
    expect(reset).toHaveBeenCalledTimes(1);

    useAuthStore.getState().setUser({ ...USER, scopes: ["proxy:view:host-1"] });
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it("runs when logging out from an authenticated session", () => {
    const reset = vi.fn();
    registerAuthContextReset(reset);
    useAuthStore.setState({ user: USER, isAuthenticated: true, isLoading: false });

    useAuthStore.getState().logout();

    expect(reset).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("runs when login replaces an existing auth context", () => {
    const reset = vi.fn();
    registerAuthContextReset(reset);
    useAuthStore.setState({ user: USER, isAuthenticated: true, isLoading: false });

    useAuthStore.getState().login({ ...USER, id: "user-2", scopes: ["proxy:view:host-1"] });

    expect(reset).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user?.id).toBe("user-2");
  });
});
