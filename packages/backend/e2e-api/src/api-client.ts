export type ApiResponse<T = unknown> = {
  status: number;
  headers: Headers;
  body: T;
  text: string;
};

type RequestOptions = {
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  auth?: boolean;
};

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  async get<T = unknown>(path: string, options: Omit<RequestOptions, 'body'> = {}) {
    return this.request<T>('GET', path, options);
  }

  async post<T = unknown>(path: string, body?: unknown, options: Omit<RequestOptions, 'body'> = {}) {
    return this.request<T>('POST', path, { ...options, body });
  }

  async put<T = unknown>(path: string, body?: unknown, options: Omit<RequestOptions, 'body'> = {}) {
    return this.request<T>('PUT', path, { ...options, body });
  }

  async patch<T = unknown>(path: string, body?: unknown, options: Omit<RequestOptions, 'body'> = {}) {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  async delete<T = unknown>(path: string, options: RequestOptions = {}) {
    return this.request<T>('DELETE', path, options);
  }

  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await this.requestOnce<T>(method, path, options);
      if (response.status !== 429 || attempt === 5) return response;
      const retryAfterSeconds = Number(response.headers.get('retry-after'));
      const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error('unreachable');
  }

  private async requestOnce<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };
    if (options.auth !== false) headers.Authorization = `Bearer ${this.token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: response.status, headers: response.headers, body: body as T, text };
  }
}

export function unwrapData<T = unknown>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

export function asArray<T = unknown>(body: unknown): T[] {
  const value = unwrapData<unknown>(body);
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: T[] }).data;
  }
  return [];
}
