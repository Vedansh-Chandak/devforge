/**
 * @devforge/github — Typed errors (DF-021).
 *
 * Error hierarchy:
 *
 *   GitHubError (base)
 *   ├── GitHubAuthError        — missing/invalid credentials
 *   ├── GitHubApiError         — non-2xx API response
 *   │   ├── GitHubNotFoundError  — 404
 *   │   ├── GitHubRateLimitError — 403 with rate-limit headers / 429
 *   │   └── GitHubConflictError  — 409
 *   ├── GitHubNetworkError     — transport-level failure
 *   ├── GitHubTimeoutError     — request exceeded timeout
 *   ├── GitHubValidationError  — bad input to a service method
 *   └── GitHubWebhookError     — webhook parse/verify failures
 */

/** Machine-readable error codes for the GitHub subsystem. */
export const GITHUB_ERROR_CODES = {
  AUTH_MISSING: 'AUTH_MISSING',
  AUTH_INVALID: 'AUTH_INVALID',
  APP_TOKEN_FAILED: 'APP_TOKEN_FAILED',
  API_ERROR: 'API_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFLICT: 'CONFLICT',
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  WEBHOOK_VERIFICATION_FAILED: 'WEBHOOK_VERIFICATION_FAILED',
  WEBHOOK_UNSUPPORTED: 'WEBHOOK_UNSUPPORTED',
  RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',
} as const;

export type GitHubErrorCode = (typeof GITHUB_ERROR_CODES)[keyof typeof GITHUB_ERROR_CODES];

export interface GitHubErrorOptions {
  readonly code?: GitHubErrorCode;
  readonly status?: number;
  readonly path?: string;
  readonly responseBody?: string;
  readonly cause?: unknown;
}

/** Base class for every error thrown by the GitHub subsystem. */
export class GitHubError extends Error {
  readonly code: GitHubErrorCode;
  readonly status?: number;
  readonly path?: string;
  readonly responseBody?: string;
  readonly cause?: unknown;

  constructor(message: string, options: GitHubErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code ?? GITHUB_ERROR_CODES.API_ERROR;
    this.status = options.status;
    this.path = options.path;
    this.responseBody = options.responseBody;
    this.cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised when credentials are missing, malformed, or rejected. */
export class GitHubAuthError extends GitHubError {
  constructor(message: string, options: GitHubErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? GITHUB_ERROR_CODES.AUTH_INVALID });
  }
}

/** Raised when a GitHub App installation token cannot be obtained. */
export class GitHubAppTokenError extends GitHubAuthError {
  constructor(message: string, options: GitHubErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? GITHUB_ERROR_CODES.APP_TOKEN_FAILED });
  }
}

/** Raised when the API returns a non-2xx status. */
export class GitHubApiError extends GitHubError {
  constructor(message: string, options: GitHubErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? GITHUB_ERROR_CODES.API_ERROR });
  }
}

/** Raised on 404 responses. */
export class GitHubNotFoundError extends GitHubApiError {
  constructor(message: string, options: GitHubErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? GITHUB_ERROR_CODES.NOT_FOUND, status: options.status ?? 404 });
  }
}

/** Raised on 403 rate-limit or 429 responses. */
export class GitHubRateLimitError extends GitHubApiError {
  constructor(message: string, options: GitHubErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? GITHUB_ERROR_CODES.RATE_LIMITED, status: options.status ?? 429 });
  }
}

/** Raised on 409 responses (e.g. non-fast-forward updates). */
export class GitHubConflictError extends GitHubApiError {
  constructor(message: string, options: GitHubErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? GITHUB_ERROR_CODES.CONFLICT, status: options.status ?? 409 });
  }
}

/** Raised for transport-level failures. */
export class GitHubNetworkError extends GitHubError {
  constructor(message: string, options: GitHubErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? GITHUB_ERROR_CODES.NETWORK });
  }
}

/** Raised when a request exceeds its timeout. */
export class GitHubTimeoutError extends GitHubError {
  constructor(message: string, options: GitHubErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? GITHUB_ERROR_CODES.TIMEOUT });
  }
}

/** Raised when a service method receives invalid input. */
export class GitHubValidationError extends GitHubError {
  constructor(message: string, options: GitHubErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? GITHUB_ERROR_CODES.INVALID_ARGUMENT });
  }
}

/** Raised when a webhook signature fails verification or the event is unsupported. */
export class GitHubWebhookError extends GitHubError {
  constructor(message: string, options: GitHubErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? GITHUB_ERROR_CODES.WEBHOOK_UNSUPPORTED });
  }
}
