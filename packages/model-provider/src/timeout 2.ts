/**
 * Timeout + cancellation handling (DF-026A).
 *
 * Runs an async operation with an internal deadline and an optional external
 * cancellation signal. Distinguishes the two causes deterministically:
 *
 *  - internal timeout elapsed → `TIMEOUT`, retryable `true`
 *  - external signal aborted → `CANCELLED`, retryable `false`
 *
 * Whichever fires first wins; the losing outcome is suppressed so no spurious
 * rejection leaks. A `timeoutMs <= 0` disables the deadline while still
 * honouring external cancellation.
 */

import { ModelProviderError } from './errors.js';

export interface TimeoutOptions {
  /** Deadline in milliseconds. Values <= 0 disable the timeout. */
  timeoutMs: number;
  /** External cancellation signal (from the caller). */
  signal?: AbortSignal;
  /** Operation name used in error messages (e.g. 'generate'). */
  operation?: string;
  /** Provider id attached to produced errors. */
  provider?: string;
}

/**
 * Run `work`, providing an internal {@link AbortSignal} that aborts when the
 * deadline or the external signal fires. Rejects with a `TIMEOUT` (retryable)
 * or `CANCELLED` (non-retryable) model error, or propagates the work's own
 * rejection when it settles first.
 */
export function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T> | T,
  options: TimeoutOptions,
): Promise<T> {
  const { timeoutMs, signal } = options;
  const operation = options.operation ?? 'operation';
  const provider = options.provider ?? 'unknown';

  const timeoutError = new ModelProviderError(
    `Operation '${operation}' timed out after ${timeoutMs}ms`,
    { provider, code: 'TIMEOUT', retryable: true },
  );
  const cancelledError = new ModelProviderError(
    `Operation '${operation}' cancelled`,
    { provider, code: 'CANCELLED', retryable: false },
  );

  const controller = new AbortController();

  if (signal?.aborted) {
    return Promise.reject(cancelledError);
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    };
    const onExternalAbort = (): void => {
      if (settled) return;
      settled = true;
      controller.abort();
      cleanup();
      reject(cancelledError);
    };

    if (signal) {
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        controller.abort();
        cleanup();
        reject(timeoutError);
      }, timeoutMs);
    }

    Promise.resolve()
      .then(() => work(controller.signal))
      .then(
        (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        },
      );
  });
}

/**
 * Streaming counterpart of {@link withTimeout}.
 *
 * Drives a generator-based stream (`source`) behind an internal deadline and
 * an optional external cancellation signal. Exactly like {@link withTimeout}:
 *
 *  - internal timeout elapsed → `TIMEOUT`, retryable `true`
 *  - external signal aborted → `CANCELLED`, retryable `false`
 *  - `timeoutMs <= 0` disables the deadline while still honouring cancellation
 *
 * The winner suppresses the loser, and whichever fires first aborts the
 * internal signal so the underlying transport tears the request down. Events
 * are never yielded after the outcome is decided ("no events after
 * cancellation"), and the source's own errors are passed through untouched
 * when no outcome has been decided yet.
 */
export async function* withStreamTimeout<T>(
  source: (signal: AbortSignal) => AsyncIterable<T>,
  options: TimeoutOptions,
): AsyncGenerator<T> {
  const { timeoutMs, signal } = options;
  const operation = options.operation ?? 'operation';
  const provider = options.provider ?? 'unknown';

  const timeoutError = new ModelProviderError(
    `Operation '${operation}' timed out after ${timeoutMs}ms`,
    { provider, code: 'TIMEOUT', retryable: true },
  );
  const cancelledError = new ModelProviderError(
    `Operation '${operation}' cancelled`,
    { provider, code: 'CANCELLED', retryable: false },
  );

  if (signal?.aborted) {
    throw cancelledError;
  }

  const controller = new AbortController();
  let outcome: ModelProviderError | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onExternalAbort = (): void => {
    if (outcome) return;
    outcome = cancelledError;
    controller.abort();
  };

  if (signal) {
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      if (outcome) return;
      outcome = timeoutError;
      controller.abort();
    }, timeoutMs);
  }

  try {
    for await (const value of source(controller.signal)) {
      if (outcome) throw outcome;
      yield value;
    }
    if (outcome) throw outcome;
  } catch (error) {
    if (outcome) throw outcome;
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
