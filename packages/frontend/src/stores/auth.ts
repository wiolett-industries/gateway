import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/types";

/**
 * Check if scopes grant a required permission.
 * Supports hierarchical matching: 'cert:issue' grants 'cert:issue:ca-123'
 */
function scopeMatches(scopes: string[], requiredScope: string): boolean {
  if (scopes.includes(requiredScope)) return true;
  const parts = requiredScope.split(":");
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join(":");
    if (scopes.includes(prefix)) return true;
  }
  return false;
}

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
  hasScope: (scope: string) => boolean;
  hasScopedAccess: (scopeBase: string) => boolean;
  hasAnyScope: (...scopes: string[]) => boolean;
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

      hasScope: (scope) => {
        const user = get().user;
        if (!user) return false;
        return scopeMatches(user.scopes, scope);
      },

      hasScopedAccess: (scopeBase) => {
        const user = get().user;
        if (!user) return false;
        return user.scopes.some(
          (scope) => scope === scopeBase || scope.startsWith(`${scopeBase}:`)
        );
      },

      hasAnyScope: (...scopes) => {
        const user = get().user;
        if (!user) return false;
        return scopes.some((s) => scopeMatches(user.scopes, s));
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
