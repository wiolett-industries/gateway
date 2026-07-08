import http from 'node:http';
import https from 'node:https';
import { AppError } from '@/middleware/error-handler.js';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface GitLabRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  allowNotFound?: boolean;
}

export interface GitLabBufferRequestOptions extends Omit<GitLabRequestOptions, 'allowNotFound'> {
  maxBytes: number;
}

export interface GitLabPage<T> {
  data: T;
  nextPage: string | null;
}

export class GitLabClient {
  private readonly apiRoot: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.apiRoot = `${this.normalizeBaseUrl(baseUrl)}/api/v4`;
  }

  async request<T>(path: string, options: GitLabRequestOptions = {}): Promise<T> {
    const page = await this.requestPage<T>(path, options);
    return page.data;
  }

  async requestPage<T>(path: string, options: GitLabRequestOptions = {}): Promise<GitLabPage<T>> {
    const url = this.buildUrl(path, options.query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'PRIVATE-TOKEN': this.token,
          'User-Agent': 'Gateway GitLab Connector',
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });

      if (response.status === 404 && options.allowNotFound) {
        return { data: null as T, nextPage: null };
      }
      if (!response.ok) {
        throw new AppError(response.status, 'GITLAB_API_ERROR', `GitLab API request failed with ${response.status}`, {
          status: response.status,
          path,
        });
      }

      const text = await response.text();
      const data = (text ? JSON.parse(text) : null) as T;
      return { data, nextPage: response.headers.get('x-next-page') || null };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AppError(504, 'GITLAB_API_TIMEOUT', 'GitLab API request timed out', { path });
      }
      throw new AppError(502, 'GITLAB_API_UNAVAILABLE', 'GitLab API request failed', {
        path,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async requestBuffer(
    path: string,
    options: GitLabBufferRequestOptions
  ): Promise<{ buffer: Buffer; contentType: string | null }> {
    const url = this.buildUrl(path, options.query);
    if (this.fetchImpl === fetch) {
      return this.requestBufferNative(url, path, options);
    }
    return this.requestBufferWithFetch(url, path, options);
  }

  private async requestBufferWithFetch(
    url: string,
    path: string,
    options: GitLabBufferRequestOptions
  ): Promise<{ buffer: Buffer; contentType: string | null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers: {
          Accept: '*/*',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          'PRIVATE-TOKEN': this.token,
          'User-Agent': 'Gateway GitLab Connector',
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new AppError(response.status, 'GITLAB_API_ERROR', `GitLab API request failed with ${response.status}`, {
          status: response.status,
          path,
        });
      }

      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
        throw new AppError(413, 'GITLAB_RESPONSE_TOO_LARGE', 'GitLab response exceeds configured size limit', {
          path,
          maxBytes: options.maxBytes,
        });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > options.maxBytes) {
        throw new AppError(413, 'GITLAB_RESPONSE_TOO_LARGE', 'GitLab response exceeds configured size limit', {
          path,
          maxBytes: options.maxBytes,
        });
      }
      return { buffer, contentType: response.headers.get('content-type') };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AppError(504, 'GITLAB_API_TIMEOUT', 'GitLab API request timed out', { path });
      }
      throw new AppError(502, 'GITLAB_API_UNAVAILABLE', 'GitLab API request failed', {
        path,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestBufferNative(
    url: string,
    path: string,
    options: GitLabBufferRequestOptions,
    redirectCount = 0
  ): Promise<{ buffer: Buffer; contentType: string | null }> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const transport = parsed.protocol === 'http:' ? http : https;
      const body = options.body === undefined ? undefined : JSON.stringify(options.body);
      const request = transport.request(
        parsed,
        {
          method: options.method ?? 'GET',
          headers: {
            Accept: '*/*',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            'PRIVATE-TOKEN': this.token,
            'User-Agent': 'Gateway GitLab Connector',
          },
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        },
        (response) => {
          const location = response.headers.location;
          if (
            location &&
            response.statusCode &&
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            redirectCount < 5
          ) {
            response.resume();
            const redirectUrl = new URL(location, url).toString();
            this.requestBufferNative(redirectUrl, path, options, redirectCount + 1).then(resolve, reject);
            return;
          }

          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            const errorChunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => errorChunks.push(chunk));
            response.on('end', () => {
              reject(
                new AppError(
                  response.statusCode ?? 502,
                  'GITLAB_API_ERROR',
                  `GitLab API request failed with ${response.statusCode ?? 502}`,
                  {
                    status: response.statusCode,
                    path,
                    body: Buffer.concat(errorChunks).toString('utf8').slice(0, 500),
                  }
                )
              );
            });
            return;
          }

          const declaredLength = Number(response.headers['content-length']);
          if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
            response.destroy();
            reject(
              new AppError(413, 'GITLAB_RESPONSE_TOO_LARGE', 'GitLab response exceeds configured size limit', {
                path,
                maxBytes: options.maxBytes,
              })
            );
            return;
          }

          const chunks: Buffer[] = [];
          let totalBytes = 0;
          response.on('error', reject);
          response.on('data', (chunk: Buffer) => {
            totalBytes += chunk.byteLength;
            if (totalBytes > options.maxBytes) {
              response.destroy(
                new AppError(413, 'GITLAB_RESPONSE_TOO_LARGE', 'GitLab response exceeds configured size limit', {
                  path,
                  maxBytes: options.maxBytes,
                })
              );
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () =>
            resolve({ buffer: Buffer.concat(chunks), contentType: this.headerString(response.headers['content-type']) })
          );
        }
      );

      request.on('timeout', () => {
        request.destroy(new AppError(504, 'GITLAB_API_TIMEOUT', 'GitLab API request timed out', { path }));
      });
      request.on('error', (error) => {
        if (error instanceof AppError) {
          reject(error);
          return;
        }
        reject(
          new AppError(502, 'GITLAB_API_UNAVAILABLE', 'GitLab API request failed', {
            path,
            message: error instanceof Error ? error.message : String(error),
          })
        );
      });
      if (body !== undefined) request.write(body);
      request.end();
    });
  }

  async paginate<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined> = {},
    maxPages = 5
  ): Promise<T[]> {
    const items: T[] = [];
    let page = 1;
    while (page <= maxPages) {
      const result = await this.requestPage<T[]>(path, { query: { ...query, page, per_page: query.per_page ?? 100 } });
      items.push(...result.data);
      if (!result.nextPage) break;
      page = Number(result.nextPage);
      if (!Number.isFinite(page) || page <= 0) break;
    }
    return items;
  }

  private buildUrl(path: string, query: GitLabRequestOptions['query'] = {}): string {
    const url = new URL(`${this.apiRoot}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private normalizeBaseUrl(rawUrl: string): string {
    const parsed = new URL(rawUrl.trim());
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/+$/, '');
  }

  private headerString(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }
}
