import { create } from "zustand";
import { hasScopeBase, scopeMatches } from "@/lib/scope-utils";
import type { User } from "@/types";

type AuthContextResetCallback = () => void;

let authContextResetCallback: AuthContextResetCallback | null = null;

export function registerAuthContextReset(callback: AuthContextResetCallback) {
  authContextResetCallback = callback;
}

function authContextKey(user: User | null): string {
  if (!user) return "anonymous";
  return `${user.id}:${[...user.scopes].sort().join(",")}:${user.isBlocked ? "blocked" : "active"}`;
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

  setUser: (user) => {
    if (authContextKey(get().user) !== authContextKey(user)) {
      authContextResetCallback?.();
    }
    set({
      user,
      isAuthenticated: !!user,
    });
  },

  setLoading: (isLoading) => set({ isLoading }),

  login: (user) => {
    if (authContextKey(get().user) !== authContextKey(user)) {
      authContextResetCallback?.();
    }
    set({
      user,
      isAuthenticated: true,
      isLoading: false,
    });
  },

  logout: () => {
    if (get().user || get().isAuthenticated) {
      authContextResetCallback?.();
    }
    set({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },

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
