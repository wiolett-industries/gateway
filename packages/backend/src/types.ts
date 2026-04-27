import type { Context } from 'hono';

export interface User {
  id: string;
  oidcSubject: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  groupId: string;
  groupName: string;
  scopes: string[];
  isBlocked: boolean;
}

export interface SessionData {
  userId: string;
  user: User;
  accessToken: string;
  refreshToken?: string;
  csrfToken?: string;
  createdAt: number;
  expiresAt: number;
}

export interface AppEnv {
  Variables: {
    user?: User;
    sessionId?: string;
    effectiveScopes?: string[];
    isTokenAuth?: boolean;
    requestId: string;
    loggingIngest?: {
      tokenId: string;
      environmentId: string;
      tokenPrefix: string;
      environment: {
        id: string;
        enabled: boolean;
        schemaMode: 'loose' | 'strip' | 'reject';
        retentionDays: number;
        fieldSchema: import('@/db/schema/index.js').LoggingFieldDefinition[];
        rateLimitRequestsPerWindow: number | null;
        rateLimitEventsPerWindow: number | null;
      };
    };
  };
}

export type AuthenticatedContext = Context<AppEnv> & {
  var: {
    user: User;
    sessionId?: string;
    effectiveScopes?: string[];
    isTokenAuth?: boolean;
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
