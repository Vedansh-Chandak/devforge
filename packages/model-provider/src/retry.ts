/**
 * Retry primitives (DF-026A).
 *
 * Provider-agnostic retry with deterministic classification, exponential
 * backoff and cancellation awareness. The clock (`sleep`) and randomness can
 * be injected so behaviour is fully deterministic under test.
 *
 * Contract (matches DF-025 hardening):
 *  - external abort during a backoff wait → `CANCELLED`, retryable `false`
 *  - only classified errors are retried; an unknown thrown value is never retried
 *  - after exhaustion the last error is re-thrown unchanged (preserving its
 *    `retryable` flag so an upstream policy may still act on it)
 */

import { isModelProviderError, ModelProviderError } from './errors.js';
import type { ModelErrorCode } from './errors.js';

/** Error codes retried by default. CANCELLED is intentionally excluded. */
export const DEFAULT_RETRYABLE_CODES: readonly ModelErrorCode[] = [
  'RATE_LIMITED',
  'TIMEOUT',
  'NETWORK_ERROR',
  'PROVIDER_ERROR',
];

/** True when a model error code belongs to the default retryable set. */
export function isRetryableCode(code: ModelErrorCode): boolean {
  return DEFAULT_RETRYABLE_CODES.includes(code);
}

export interface RetryPolicy {
  /** Additional attempts after the initial call. Default 2. */
  maxRetries?: number;
  /** Initial backoff in milliseconds. Default 200. */
  backoffMs?: number;
  /** Backoff multiplier per retry. Default 2. */
  backoffMultiplier?: number;
  /** Ceiling for the backoff in milliseconds. Default 8000. */
  maxBackoffMs?: number;
  /** Jitter fraction in [0, 1] added on top of the computed delay. Default 0.1. */
  jitter?: number;
  /** Codes eligible for retry. Defaults to {@link DEFAULT_RETRYABLE_CODES}. */
  retryableCodes?: readonly ModelErrorCode[];
}

export interface RetryOptions {
  /** Operation name used in diagnostics and error messages (e.g. 'generate'). */
  operation: string;
  /** Provider id attached to cancellation errors produced by the retry loop. */
  provider: string;
  policy?: RetryPolicy;
  /** External cancellation signal. Abort during a backoff wait → CANCELLED. */
  signal?: AbortSignal;
  /** Injectable sleep used by deterministic tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injectable randomness used for jitter. Defaults to Math.random. */
  random?: () => number;
  /** Called immediately before each retry, with the failed attempt index. */
  onRetry?: (info: { attempt: number; error: ModelProviderError; delayMs: number }) => void;
}

export interface NormalizedRetryPolicy {
  readonly maxRetries: number;
  readonly backoffMs: number;
  readonly backoffMultiplier: number;
  readonly maxBackoffMs: number;
  readonly jitter: number;
  readonly retryableCodes: readonly ModelErrorCode[];
}

/** Fill a partial policy with deterministic defaults. */
export function normalizePolicy(policy?: RetryPolicy): NormalizedRetryPolicy {
  const codes = policy?.retryableCodes ?? DEFAULT_RETRYABLE_CODES;
  return {
    maxRetries: Math.max(0, policy?.maxRetries ?? 2),
    backoffMs: Math.max(0, policy?.backoffMs ?? 200),
    backoffMultiplier: policy?.backoffMultiplier ?? 2,
    maxBackoffMs: Math.max(0, policy?.maxBackoffMs ?? 8000),
    jitter: Math.min(1, Math.max(0, policy?.jitter ?? 0.1)),
    retryableCodes: [...codes],
  };
}

/** Compute the backoff delay (ms) for a failed attempt, including jitter. */
export function computeBackoff(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const normalized = normalizePolicy(policy);
  const base = Math.min(
    normalized.backoffMs * normalized.backoffMultiplier ** Math.max(0, attempt),
    normalized.maxBackoffMs,
  );
  const jitter =
    normalized.jitter <= 0 ? 0 : random() * base * normalized.jitter;
  return base + jitter;
}

/** Deterministic classification: should a thrown error trigger a retry? */
export function shouldRetry(
  error: unknown,
  attempt: number,
  policy: RetryPolicy,
): boolean {
  const normalized = normalizePolicy(policy);
  if (attempt >= normalized.maxRetries) return false;
  if (!isModelProviderError(error)) return false;
  if (!error.retryable) return false;
  if (error.code === 'CANCELLED') return false;
  return normalized.retryableCodes.includes(error.code);
}

/** Default cancellation-aware sleep: resolves after `ms`, rejects CANCELLED on abort. */
export function defaultSleep(
  ms: number,
  signal?: AbortSignal,
  provider = 'unknown',
  operation = 'operation',
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(cancelledDuringBackoff(provider, operation));
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(cancelledDuringBackoff(provider, operation));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function cancelledDuringBackoff(provider: string, operation: string): ModelProviderError {
  return new ModelProviderError(
    `Operation '${operation}' cancelled during retry backoff`,
    { provider, code: 'CANCELLED', retryable: false },
  );
}

/**
 * Run `fn` with retry. Attempt 0 is the initial call; retries happen only for
 * retryable model errors. On success the value is returned; on final failure
 * the last error is re-thrown. Aborting `signal` cancels both the backoff
 * waits and (when already aborted) the call itself with a `CANCELLED` error.
 */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const policy = normalizePolicy(options.policy);
  const sleep = options.sleep ?? ((ms: number, signal?: AbortSignal) =>
    defaultSleep(ms, signal, options.provider, options.operation));
  const random = options.random ?? Math.random;

  if (options.signal?.aborted) {
    throw new ModelProviderError(
      `Operation '${options.operation}' cancelled before it started`,
      { provider: options.provider, code: 'CANCELLED', retryable: false },
    );
  }

  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (!shouldRetry(error, attempt, policy)) throw error;
      const delayMs = computeBackoff(attempt, policy, random);
      options.onRetry?.({ attempt, error: error as ModelProviderError, delayMs });
      await sleep(delayMs, options.signal);
      attempt += 1;
    }
  }
}
