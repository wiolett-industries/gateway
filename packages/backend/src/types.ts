import type { Context } from 'hono';

export type UserRole = 'admin' | 'operator' | 'viewer';

export interface User {
  id: string;
  oidcSubject: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: UserRole;
}

export interface SessionData {
  userId: string;
  user: User;
  accessToken: string;
  refreshToken?: string;
  createdAt: number;
  expiresAt: number;
}

export interface AppEnv {
  Variables: {
    user?: User;
    sessionId?: string;
    requestId: string;
  };
}

export type AuthenticatedContext = Context<AppEnv> & {
  var: {
    user: User;
    sessionId: string;
    requestId: string;
  };
};

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
