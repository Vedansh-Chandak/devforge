/**
 * Model Provider Error Types
 */

export type ModelErrorCode =
  | 'AUTHENTICATION_ERROR'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_REQUEST'
  | 'MODEL_NOT_FOUND'
  | 'PROVIDER_ERROR'
  | 'UNKNOWN';

export class ModelProviderError extends Error {
  readonly provider: string;
  readonly code: ModelErrorCode;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      provider: string;
      code: ModelErrorCode;
      retryable?: boolean;
      cause?: Error;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'ModelProviderError';
    this.provider = options.provider;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
  }
}

export function isModelProviderError(
  error: unknown,
): error is ModelProviderError {
  return error instanceof ModelProviderError;
}

export function createProviderError(
  message: string,
  provider: string,
  code: ModelErrorCode,
  retryable = false,
  cause?: Error,
): ModelProviderError {
  return new ModelProviderError(message, {
    provider,
    code,
    retryable,
    cause,
  });
}