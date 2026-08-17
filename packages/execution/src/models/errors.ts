/**
 * @devforge/execution — Model Integration Errors (DF-016C).
 *
 * Typed errors for provider-backed models.
 * All errors carry structured metadata for debugging and recovery.
 */

import type { ModelErrorCode } from '@devforge/model-provider';
import { ModelProviderError } from '@devforge/model-provider';

/** Base options accepted by ModelIntegrationError. */
export interface IntegrationErrorOptions {
  readonly code?: string;
  readonly cause?: unknown;
}

/** Base class for all model integration errors. */
export class ModelIntegrationError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(message: string, options: IntegrationErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code ?? 'MODEL_INTEGRATION_ERROR';
    this.cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised when prompt building fails. */
export class PromptError extends ModelIntegrationError {
  constructor(message: string, options: IntegrationErrorOptions = {}) {
    super(message, { ...options, code: 'PROMPT_BUILD_FAILED' });
  }
}

/** Structured failure metadata carried by parse errors. */
export interface ParseFailureOptions {
  readonly code: string;
  readonly rawOutput: string;
  readonly recoveryAttempted: boolean;
  readonly partialValue?: unknown;
}

/** Raised when parsing model output fails (with recovery info). */
export class ParseError extends ModelIntegrationError {
  readonly parseFailure: ParseFailureOptions;

  constructor(
    message: string,
    parseFailure: ParseFailureOptions,
    options: IntegrationErrorOptions = {},
  ) {
    super(message, { ...options, code: 'PARSE_FAILED' });
    this.parseFailure = parseFailure;
  }
}

/** Raised when patch parsing fails specifically. */
export class PatchParseError extends ParseError {
  constructor(message: string, parseFailure: ParseFailureOptions) {
    super(message, parseFailure, { code: 'PATCH_PARSE_FAILED' });
    this.name = 'PatchParseError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised when reasoning parsing fails specifically. */
export class ReasoningParseError extends ParseError {
  constructor(message: string, parseFailure: ParseFailureOptions) {
    super(message, parseFailure, { code: 'REASONING_PARSE_FAILED' });
    this.name = 'ReasoningParseError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised when the provider returns an error (wraps ModelProviderError). */
export class ProviderError extends ModelIntegrationError {
  readonly provider: string;
  readonly providerCode: ModelErrorCode;
  readonly retryable: boolean;

  constructor(
    message: string,
    provider: string,
    providerCode: ModelErrorCode,
    retryable: boolean,
    options: IntegrationErrorOptions = {},
  ) {
    super(message, { ...options, code: 'PROVIDER_ERROR' });
    this.provider = provider;
    this.providerCode = providerCode;
    this.retryable = retryable;
  }

  /** Create from a ModelProviderError. */
  static fromProviderError(error: ModelProviderError): ProviderError {
    return new ProviderError(
      error.message,
      error.provider,
      error.code,
      error.retryable,
      { cause: error.cause },
    );
  }
}

/** Raised when cancellation is requested. */
export class CancellationError extends ModelIntegrationError {
  constructor(message = 'Operation cancelled', options: IntegrationErrorOptions = {}) {
    super(message, { ...options, code: 'CANCELLED' });
  }
}

/** Type guard for ProviderError. */
export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

/** Type guard for ParseError. */
export function isParseError(error: unknown): error is ParseError {
  return error instanceof ParseError;
}

/** Type guard for CancellationError. */
export function isCancellationError(error: unknown): error is CancellationError {
  return error instanceof CancellationError;
}