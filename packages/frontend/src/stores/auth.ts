import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User, UserRole } from "@/types";

interface AuthState {
  user: User | null;
  sessionId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setUser: (user: User | null) => void;
  setSessionId: (sessionId: string | null) => void;
  setLoading: (loading: boolean) => void;
  login: (user: User, sessionId: string) => void;
  logout: () => void;
  hasRole: (...roles: UserRole[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      sessionId: null,
      isAuthenticated: false,
      isLoading: true,

      setUser: (user) =>
        set({
          user,
          isAuthenticated: !!user,
        }),

      setSessionId: (sessionId) => set({ sessionId }),

      setLoading: (isLoading) => set({ isLoading }),

      login: (user, sessionId) =>
        set({
          user,
          sessionId,
          isAuthenticated: true,
          isLoading: false,
        }),

      logout: () =>
        set({
          user: null,
          sessionId: null,
          isAuthenticated: false,
          isLoading: false,
        }),

      hasRole: (...roles) => {
        const user = get().user;
        if (!user) return false;
        return roles.includes(user.role);
      },
    }),
    {
      name: "gateway-auth",
      partialize: (state) => ({
        sessionId: state.sessionId,
      }),
    }
  )
);
