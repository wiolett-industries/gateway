import { create } from "zustand";
import { hasScopeBase, scopeMatches } from "@/lib/scope-utils";
import type { User } from "@/types";

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
    return hasScopeBase(user.scopes, scopeBase);
  },

  hasAnyScope: (...scopes) => {
    const user = get().user;
    if (!user) return false;
    return scopes.some((s) => scopeMatches(user.scopes, s));
  },
}));
