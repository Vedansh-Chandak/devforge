/**
 * Provider-internal HTTP transport (DF-026B).
 *
 * A small native-fetch abstraction shared by the concrete provider adapters.
 * It owns the only network-facing code in the package so Brain, Planner, and
 * the rest of the application never touch HTTP. Responsibilities:
 *
 *  - URL construction from a configurable `baseUrl`
 *  - header building + bearer / header-based API-credential injection
 *  - deferred abort/timeout propagation via the caller's AbortSignal
 *  - shared HTTP status → normalized {@link ModelErrorCode} classification
 *  - redaction of every diagnostic (messages, URL, extracted error bodies)
 *    using the DF-026A redaction primitives
 *
 * `fetch` is injectable so all tests are deterministic and never touch a real
 * provider API.
 */

import { ModelProviderError } from './errors.js';
import type { ModelErrorCode } from './errors.js';
import { redactSecrets } from './redact.js';

/** Native fetch signature — injectable for deterministic tests. */
export type FetchFn = typeof fetch;

export interface HttpStatusClassification {
  readonly code: ModelErrorCode;
  readonly retryable: boolean;
}

/**
 * Shared HTTP status → normalized model error classification.
 * Used by OpenAI-compatible transport by default; provider adapters may wrap
 * it to handle vendor edge cases (e.g. Gemini's 400 auth responses).
 */
export function classifyHttpStatus(status: number): HttpStatusClassification {
  switch (status) {
    case 401:
    case 403:
      return { code: 'AUTHENTICATION_ERROR', retryable: false };
    case 404:
      return { code: 'MODEL_NOT_FOUND', retryable: false };
    case 429:
      return { code: 'RATE_LIMITED', retryable: true };
    case 400:
      return { code: 'INVALID_REQUEST', retryable: false };
    default:
      if (status >= 500) {
        return { code: 'PROVIDER_ERROR', retryable: true };
      }
      return { code: 'UNKNOWN', retryable: false };
  }
}

/** True when `value` is a plain (non-array) object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Strip query params and userinfo from a URL for safe diagnostics.
 * Never includes secrets; returns a fixed placeholder for unparseable input.
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return '[invalid URL]';
  }
}

/** Extract the provider's human-readable error message from a JSON body. */
export function extractErrorMessage(body: unknown): string | undefined {
  if (isRecord(body)) {
    const error = body.error;
    if (isRecord(error) && typeof error.message === 'string') {
      return error.message.slice(0, 500);
    }
  }
  return undefined;
}

/** Extract `error.status` (e.g. Gemini's `PERMISSION_DENIED`). */
export function extractErrorStatus(body: unknown): string | undefined {
  if (isRecord(body)) {
    const error = body.error;
    if (isRecord(error) && typeof error.status === 'string') {
      return error.status;
    }
  }
  return undefined;
}

export type AuthScheme =
  | { readonly scheme: 'bearer' }
  | { readonly scheme: 'header'; readonly name: string }
  | { readonly scheme: 'none' };

export interface TransportConfig {
  /** Provider id attached to errors produced by the transport. */
  readonly provider: string;
  /** API root URL. Trailing slashes are stripped at construction. */
  readonly baseUrl: string;
  /** API credential. Injected as a header; never logged or serialized. */
  readonly apiKey?: string;
  /** How the credential is attached. Defaults to a Bearer token. */
  readonly auth?: AuthScheme;
  /** Additional static headers on every request (e.g. `anthropic-version`). */
  readonly extraHeaders?: Record<string, string>;
  /** Injectable fetch. Defaults to the global fetch. */
  readonly fetchFn: FetchFn;
  /** Explicit secret values to redact from all diagnostics. */
  readonly secrets?: readonly string[];
  /** Optional provider-specific HTTP status classifier. */
  readonly classify?: (
    status: number,
    body?: Record<string, unknown>,
  ) => HttpStatusClassification;
}

export interface TransportRequest {
  /** Path appended to `baseUrl` (e.g. `/chat/completions`). */
  readonly path: string;
  /** JSON-serializable request body. Omitted from the request when undefined. */
  readonly body?: unknown;
  /** Cancellation/deadline signal (from `withTimeout`). */
  readonly signal?: AbortSignal;
  /** Per-request extra headers merged over the static ones. */
  readonly headers?: Record<string, string>;
}

interface FetchFailure {
  readonly provider: string;
  readonly error: unknown;
  readonly url: string;
  readonly aborted: boolean;
}

/** Map a fetch rejection into a normalized, redacted model error. */
export function mapFetchFailure(
  failure: FetchFailure,
  secrets: readonly string[],
): ModelProviderError {
  const { provider, error, url, aborted } = failure;
  const cause = sanitizedCause(error, secrets);

  if (aborted) {
    return new ModelProviderError('Model request cancelled', {
      provider,
      code: 'CANCELLED',
      retryable: false,
      cause,
    });
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return new ModelProviderError(
      `Request to ${sanitizeUrl(url)} timed out`,
      { provider, code: 'TIMEOUT', retryable: true, cause },
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return new ModelProviderError(
    `Network error calling ${sanitizeUrl(url)}: ${redactSecrets(message, secrets)}`,
    { provider, code: 'NETWORK_ERROR', retryable: true, cause },
  );
}

/** Build a redacted clone of an error so secrets never reach the `cause`. */
function sanitizedCause(
  error: unknown,
  secrets: readonly string[],
): Error | undefined {
  if (!(error instanceof Error)) return undefined;
  const message = redactSecrets(error.message, secrets);
  const cause = new Error(message);
  cause.name = error.name;
  if (error.stack !== undefined) {
    cause.stack = redactSecrets(error.stack, secrets);
  }
  return cause;
}

/**
 * Minimal HTTP POST transport shared by the concrete adapters.
 *
 * Unparseable bodies, HTTP errors, and network failures are all normalized
 * into {@link ModelProviderError}s with provider-appropriate codes. The raw
 * `Response` object never escapes the transport.
 */
export class HttpTransport {
  private readonly provider: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly auth: AuthScheme;
  private readonly extraHeaders: Record<string, string>;
  private readonly fetchFn: FetchFn;
  private readonly secrets: readonly string[];
  private readonly classify: (
    status: number,
    body?: Record<string, unknown>,
  ) => HttpStatusClassification;

  constructor(config: TransportConfig) {
    this.provider = config.provider;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.auth = config.auth ?? { scheme: 'bearer' };
    this.extraHeaders = { ...config.extraHeaders };
    this.fetchFn = config.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.secrets = [
      ...(config.apiKey !== undefined ? [config.apiKey] : []),
      ...(config.secrets ?? []),
    ];
    this.classify = config.classify ?? classifyHttpStatus;
  }

  /** The normalized API root (no trailing slash). */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** POST a JSON body and return the parsed JSON response. */
  async post(request: TransportRequest): Promise<unknown> {
    const url = this.endpoint(request.path);
    const body = request.body === undefined ? undefined : JSON.stringify(request.body);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: this.buildHeaders(request.headers),
        ...(body !== undefined ? { body } : {}),
        signal: request.signal,
      });
    } catch (error: unknown) {
      throw mapFetchFailure(
        { provider: this.provider, error, url, aborted: request.signal?.aborted ?? false },
        this.secrets,
      );
    }

    if (!response.ok) {
      throw await this.mapHttpError(response);
    }

    try {
      return await response.json();
    } catch {
      throw new ModelProviderError('Failed to parse provider response as JSON', {
        provider: this.provider,
        code: 'PROVIDER_ERROR',
        retryable: false,
      });
    }
  }

  private endpoint(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.baseUrl}${path}`;
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
      ...extra,
    };
    if (this.apiKey === undefined || this.apiKey === '') {
      return headers;
    }
    if (this.auth.scheme === 'bearer') {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    } else if (this.auth.scheme === 'header') {
      headers[this.auth.name] = this.apiKey;
    }
    return headers;
  }

  private async mapHttpError(response: Response): Promise<ModelProviderError> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    const rawMessage = extractErrorMessage(body) ?? `HTTP ${response.status}`;
    const message = redactSecrets(rawMessage, this.secrets);
    const { code, retryable } = this.classify(
      response.status,
      isRecord(body) ? body : undefined,
    );

    return new ModelProviderError(
      `Provider error (${response.status}): ${message}`,
      { provider: this.provider, code, retryable },
    );
  }
}