import { useAppStatusStore } from "@/stores/app-status";
import { useAuthStore } from "@/stores/auth";
import type { ApiError } from "@/types";

const API_BASE = "/api";

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
}

const DEFAULT_CACHE_TTL = 60_000; // 1 minute

export { API_BASE, DEFAULT_CACHE_TTL };

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    {
      status,
      code,
      retryAfterSeconds,
    }: { status: number; code?: string; retryAfterSeconds?: number }
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function getRetryAfterSeconds(response: Response): number {
  const retryAfter = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter;

  const resetAt = Number(response.headers.get("X-RateLimit-Reset"));
  if (Number.isFinite(resetAt) && resetAt > 0) {
    return Math.max(1, Math.ceil(resetAt - Date.now() / 1000));
  }

  return 60;
}

function getLoginRedirectUrl(): string {
  if (window.location.pathname.startsWith("/oauth/")) {
    return `/auth/login?return_to=${encodeURIComponent(window.location.href)}`;
  }
  return "/login";
}

export class ApiClientBase {
  protected cache = new Map<string, CacheEntry>();
  private csrfToken: string | null = null;
  private sessionGeneration = 0;

  private assertSessionGeneration(generation: number): void {
    if (generation !== this.sessionGeneration) {
      throw new ApiRequestError("Session changed", {
        status: 0,
        code: "SESSION_CHANGED",
      });
    }
  }

  /** Get cached data if fresh enough. */
  getCached<T>(key: string, ttl = DEFAULT_CACHE_TTL): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > ttl) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  /** Store data in cache. */
  setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /** Invalidate a specific cache key or prefix. */
  invalidateCache(prefix?: string): void {
    if (!prefix) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  resetSessionState(): void {
    this.cache.clear();
    this.csrfToken = null;
    this.sessionGeneration += 1;
  }

  /**
   * Fetch with cache: returns cached data if available, fetches in background to update.
   * Returns [data, isFromCache].
   */
  async cachedRequest<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl = DEFAULT_CACHE_TTL
  ): Promise<T> {
    const generation = this.sessionGeneration;
    const cached = this.getCached<T>(key, ttl);
    // Always fetch fresh data
    const fresh = fetcher().then((data) => {
      this.assertSessionGeneration(generation);
      this.setCache(key, data);
      return data;
    });
    // If we have cache, return it immediately (fresh fetch still updates cache in background)
    if (cached !== undefined) return cached;
    return fresh;
  }

  protected getHeaders(): HeadersInit {
    return {
      "Content-Type": "application/json",
    };
  }

  clearCsrfToken(): void {
    this.csrfToken = null;
  }

  private async getCsrfToken(): Promise<string> {
    if (this.csrfToken) return this.csrfToken;
    const generation = this.sessionGeneration;

    const response = await fetch("/auth/csrf", {
      cache: "no-store",
      credentials: "include",
      headers: this.getHeaders(),
    });

    if (response.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = getLoginRedirectUrl();
      throw new ApiRequestError("Session expired", {
        status: response.status,
        code: "UNAUTHORIZED",
      });
    }

    if (!response.ok) {
      throw new ApiRequestError("Unable to prepare request", {
        status: response.status,
        code: "CSRF_TOKEN_UNAVAILABLE",
      });
    }

    const body = (await response.json()) as { csrfToken?: string };
    if (!body.csrfToken) {
      throw new ApiRequestError("Unable to prepare request", {
        status: response.status,
        code: "CSRF_TOKEN_UNAVAILABLE",
      });
    }

    this.assertSessionGeneration(generation);

    this.csrfToken = body.csrfToken;
    return body.csrfToken;
  }

  protected async fetchRaw<T>(
    url: string,
    options: RequestInit = {},
    { suppressGlobalStatus = false }: { suppressGlobalStatus?: boolean } = {}
  ): Promise<T> {
    let response: Response;
    const generation = this.sessionGeneration;
    const method = (options.method || "GET").toUpperCase();
    const headers = new Headers(this.getHeaders());
    if (options.headers) {
      new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    }

    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      headers.set("X-CSRF-Token", await this.getCsrfToken());
    }

    try {
      response = await fetch(url, {
        ...options,
        credentials: "include",
        headers,
      });
    } catch {
      if (!suppressGlobalStatus) {
        useAppStatusStore.getState().setMaintenanceActive(true);
      }
      throw new ApiRequestError("Service unavailable", {
        status: 0,
        code: "SERVICE_UNAVAILABLE",
      });
    }

    if (response.status < 500 && !suppressGlobalStatus) {
      useAppStatusStore.getState().setMaintenanceActive(false);
    }

    this.assertSessionGeneration(generation);

    if (!response.ok) {
      if (response.status >= 500) {
        throw new ApiRequestError("Service unavailable", {
          status: response.status,
          code: "SERVICE_UNAVAILABLE",
        });
      }

      if (response.status === 429) {
        const retryAfterSeconds = getRetryAfterSeconds(response);
        if (!suppressGlobalStatus) {
          useAppStatusStore.getState().activateRateLimit(retryAfterSeconds);
        }
        throw new ApiRequestError("Too many requests, please try again later", {
          status: response.status,
          code: "RATE_LIMIT_EXCEEDED",
          retryAfterSeconds,
        });
      }

      if (response.status === 401) {
        this.clearCsrfToken();
        useAuthStore.getState().logout();
        window.location.href = getLoginRedirectUrl();
        throw new ApiRequestError("Session expired", {
          status: response.status,
          code: "UNAUTHORIZED",
        });
      }

      if (response.status === 403) {
        const body = await response.json().catch(() => ({ message: "" }));
        if (body.message === "Invalid CSRF token") {
          this.clearCsrfToken();
        }
        if (body.message === "Account is blocked") {
          window.location.href = "/blocked";
          throw new ApiRequestError("Account is blocked", {
            status: response.status,
            code: "ACCOUNT_BLOCKED",
          });
        }
        throw new ApiRequestError("Insufficient permissions", {
          status: response.status,
          code: "FORBIDDEN",
        });
      }

      const error: ApiError = await response.json().catch(() => ({
        code: "UNKNOWN_ERROR",
        message: "An unknown error occurred",
      }));

      throw new ApiRequestError(error.message, {
        status: response.status,
        code: error.code,
      });
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const data = (await response.json()) as T;
    this.assertSessionGeneration(generation);
    return data;
  }

  protected async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url =
      endpoint.startsWith("/auth") || endpoint.startsWith(API_BASE)
        ? endpoint
        : `${API_BASE}${endpoint}`;
    const method = (options.method || "GET").toUpperCase();

    // For GET requests, update the shared cache but return the network result
    // to the caller. Stores already read cache explicitly when they want an
    // instant stale value; returning cached data here makes refresh actions
    // look successful while leaving the UI stale.
    if (method === "GET") {
      const generation = this.sessionGeneration;
      const cacheKey = `req:${url}`;
      const data = await this.fetchRaw<T>(url, options);
      this.assertSessionGeneration(generation);
      this.setCache(cacheKey, data);
      return data;
    }

    // Non-GET: invalidate cached GET requests for this endpoint path
    const basePath = url.split("?")[0];
    for (const key of this.cache.keys()) {
      if (key.startsWith("req:") && key.includes(basePath.replace(/\/[^/]+$/, ""))) {
        this.cache.delete(key);
      }
    }
    return this.fetchRaw<T>(url, options);
  }

  /**
   * Unwrap a single-resource response wrapped in `{ data: ... }` by the backend.
   */
  protected unwrapData<T>(promise: Promise<{ data: T }>): Promise<T> {
    return promise.then((r) => r.data);
  }
}
