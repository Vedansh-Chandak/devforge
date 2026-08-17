/**
 * @devforge/github — GitHub API client (DF-021).
 *
 * A minimal, deterministic HTTP client for the GitHub REST API. Supports
 * auth header injection, retries with bounded exponential backoff, JSON
 * parsing, Link-header pagination, and typed error mapping. The fetch
 * implementation and clock are injectable so tests are fully deterministic.
 */

import type { GitHubClientConfig } from './types.js';
import { AuthManager } from './auth.js';
import {
  GitHubApiError,
  GitHubConflictError,
  GitHubError,
  GitHubNetworkError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GITHUB_ERROR_CODES,
  GitHubTimeoutError,
} from './errors.js';

const DEFAULT_BASE_URL = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const ACCEPT_HEADER = 'application/vnd.github+json';

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly path: string;
  /** Query parameters appended to the path. */
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Return the response text verbatim instead of parsing JSON. */
  readonly raw?: boolean;
}

export interface ApiResponse<T> {
  readonly status: number;
  readonly body: T;
  /** Parsed Link header relations for pagination. */
  readonly links: ReadonlyMap<string, string>;
}

/** HTTP request shape used by the injectable fetch (deterministic tests). */
export interface FetchRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

/** A page of paginated results plus the next/prev URLs. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextUrl: string | null;
}

function encodeQuery(query: Readonly<Record<string, string | number | boolean | undefined>>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

function parseLinkHeader(link: string | null): Map<string, string> {
  const result = new Map<string, string>();
  if (!link) return result;
  for (const part of link.split(',')) {
    const match = /<([^>]+)>;\s*rel="([^"]+)"/.exec(part.trim());
    if (match?.[1] && match?.[2]) {
      result.set(match[2], match[1]);
    }
  }
  return result;
}

function isTransientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Map a non-2xx response into a typed GitHubError. */
export function mapHttpError(
  status: number,
  path: string,
  bodyText: string,
): GitHubError {
  const message = `GitHub API error ${status} for ${path}`;
  if (status === 404) return new GitHubNotFoundError(message, { status, path, responseBody: bodyText });
  if (status === 409) return new GitHubConflictError(message, { status, path, responseBody: bodyText });
  if (status === 403 && /rate.?limit/i.test(bodyText)) {
    return new GitHubRateLimitError(message, { status, path, responseBody: bodyText });
  }
  if (status === 429) return new GitHubRateLimitError(message, { status, path, responseBody: bodyText });
  return new GitHubApiError(message, { status, path, responseBody: bodyText });
}

/**
 * The GitHub REST client. One instance is bound to a single credential.
 * All methods throw typed {@link GitHubError}s on failure.
 */
export class GitHubClient {
  readonly baseUrl: string;
  private readonly auth: AuthManager;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly userAgent: string;
  private readonly now: () => number;

  constructor(config: GitHubClientConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.auth = new AuthManager(config.credential, {
      fetch: config.fetch,
      now: config.now,
    });
    this.fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.userAgent = config.userAgent ?? 'devforge';
    this.now = config.now ?? (() => Date.now());
  }

  /** Execute a request and decode the JSON body. */
  async request<T>(options: RequestOptions): Promise<ApiResponse<T>> {
    const { method = 'GET', path, query, body, headers, timeoutMs, signal, raw } = options;
    if (path.length === 0 || !path.startsWith('/')) {
      throw new GitHubApiError(`Path must start with '/': ${path}`, {
        code: GITHUB_ERROR_CODES.INVALID_ARGUMENT,
      });
    }

    const url = `${this.baseUrl}${path}${query ? encodeQuery(query) : ''}`;
    const authHeaders = await this.auth.headers();
    const requestHeaders: Record<string, string> = {
      Accept: ACCEPT_HEADER,
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
      ...authHeaders,
      ...headers,
    };

    const effectiveTimeout = timeoutMs ?? this.timeoutMs;
    let attempt = 0;
    let lastError: GitHubError | null = null;

    while (attempt <= this.maxRetries) {
      const controller = new AbortController();
      const timer =
        effectiveTimeout > 0
          ? setTimeout(() => controller.abort(), effectiveTimeout)
          : undefined;
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      let response: Response | undefined;
      try {
        response = await this.fetchFn(url, {
          method,
          headers: requestHeaders,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new GitHubTimeoutError(`Request to ${path} timed out after ${effectiveTimeout}ms`, {
            path,
            cause: error,
          });
        } else {
          lastError = new GitHubNetworkError(
            `Network error for ${path}: ${error instanceof Error ? error.message : String(error)}`,
            { path, cause: error },
          );
        }
      } finally {
        clearTimeout(timer);
      }

      if (response !== undefined) {
        const bodyText = await response.text();
        const retryable = isTransientStatus(response.status);
        if (!response.ok) {
          lastError = mapHttpError(response.status, path, bodyText);
          if (retryable && attempt < this.maxRetries) {
            attempt += 1;
            await this.backoff(attempt);
            continue;
          }
          throw lastError;
        }
        return {
          status: response.status,
          body: bodyText.length > 0 ? (raw ? (bodyText as T) : (JSON.parse(bodyText) as T)) : (undefined as T),
          links: parseLinkHeader(response.headers.get('link')),
        };
      }

      if (lastError && attempt < this.maxRetries) {
        attempt += 1;
        await this.backoff(attempt);
        continue;
      }
      throw lastError ?? new GitHubError(`Request to ${path} failed`, { path });
    }

    throw lastError ?? new GitHubError(`Request to ${path} failed after retries`, { path });
  }

  /** GET convenience. */
  async get<T>(path: string, options: Omit<RequestOptions, 'method' | 'path'> = {}): Promise<ApiResponse<T>> {
    return this.request<T>({ ...options, method: 'GET', path });
  }

  /** POST convenience. */
  async post<T>(path: string, options: Omit<RequestOptions, 'method' | 'path'> = {}): Promise<ApiResponse<T>> {
    return this.request<T>({ ...options, method: 'POST', path });
  }

  /** PATCH convenience. */
  async patch<T>(path: string, options: Omit<RequestOptions, 'method' | 'path'> = {}): Promise<ApiResponse<T>> {
    return this.request<T>({ ...options, method: 'PATCH', path });
  }

  /** PUT convenience. */
  async put<T>(path: string, options: Omit<RequestOptions, 'method' | 'path'> = {}): Promise<ApiResponse<T>> {
    return this.request<T>({ ...options, method: 'PUT', path });
  }

  /** DELETE convenience. */
  async delete<T>(path: string, options: Omit<RequestOptions, 'method' | 'path'> = {}): Promise<ApiResponse<T>> {
    return this.request<T>({ ...options, method: 'DELETE', path });
  }

  /**
   * Iterate every page of a paginated resource. Stops when the response
   * carries no `next` Link relation.
   */
  async *paginate<T>(
    path: string,
    options: Omit<RequestOptions, 'method' | 'path'> = {},
  ): AsyncGenerator<T, void, unknown> {
    let currentPath: string | null = path;
    const seen = new Set<string>();
    while (currentPath !== null) {
      const url: string = currentPath.startsWith('http')
        ? currentPath
        : `${this.baseUrl}${currentPath}`;
      const parsed: URL = new URL(url);
      const apiPath: string = `${parsed.pathname}${parsed.search}`;
      if (seen.has(apiPath)) break;
      seen.add(apiPath);

      // When following an absolute next URL its query is already embedded,
      // so drop the caller-supplied query to avoid duplication.
      const { query: _omitQuery, ...requestOptions } = options;
      const response: ApiResponse<T[]> = await this.request<T[]>({
        ...(currentPath.startsWith('http') ? requestOptions : options),
        path: apiPath,
      });
      for (const item of response.body ?? []) {
        yield item;
      }
      const next: string | null = response.links.get('next') ?? null;
      currentPath = next;
    }
  }

  /** Fixed backoff helper: 250ms * attempt (deterministic clock when injected). */
  private async backoff(attempt: number): Promise<void> {
    const delay = 250 * attempt;
    if (delay <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/** Create a client bound to a credential. */
export function createGitHubClient(config: GitHubClientConfig): GitHubClient {
  return new GitHubClient(config);
}
