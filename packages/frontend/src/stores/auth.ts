import { create } from "zustand";
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
  isAuthenticated: boolean;
  isLoading: boolean;

  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  login: (user: User) => void;
  logout: () => void;
  hasScope: (scope: string) => boolean;
  hasScopedAccess: (scopeBase: string) => boolean;
  hasAnyScope: (...scopes: string[]) => boolean;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  setUser: (user) =>
    set({
      user,
      isAuthenticated: !!user,
    }),

  setLoading: (isLoading) => set({ isLoading }),

  login: (user) =>
    set({
      user,
      isAuthenticated: true,
      isLoading: false,
    }),

  logout: () =>
    set({
      user: null,
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
    return user.scopes.some((scope) => scope === scopeBase || scope.startsWith(`${scopeBase}:`));
  },

  hasAnyScope: (...scopes) => {
    const user = get().user;
    if (!user) return false;
    return scopes.some((s) => scopeMatches(user.scopes, s));
  },
}));
