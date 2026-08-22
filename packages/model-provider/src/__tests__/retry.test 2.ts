import { describe, it, expect } from 'vitest';
import {
  retry,
  shouldRetry,
  isRetryableCode,
  DEFAULT_RETRYABLE_CODES,
  computeBackoff,
  normalizePolicy,
  defaultSleep,
} from '../retry.js';
import { ModelProviderError } from '../errors.js';
import type { RetryOptions } from '../retry.js';

function providerError(
  code: 'AUTHENTICATION_ERROR' | 'RATE_LIMITED' | 'TIMEOUT' | 'NETWORK_ERROR' | 'PROVIDER_ERROR' | 'CANCELLED',
  retryable: boolean,
): ModelProviderError {
  return new ModelProviderError(`boom: ${code}`, {
    provider: 'test-provider',
    code,
    retryable,
  });
}

/** Deterministic retry harness with a captured backoff log and immediate sleep. */
function makeHarness(overrides: Partial<RetryOptions> = {}) {
  const delays: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    delays.push(ms);
  };
  const options: RetryOptions = {
    operation: 'generate',
    provider: 'test-provider',
    sleep,
    random: () => 0,
    ...overrides,
  };
  return { options, delays };
}

describe('retry', () => {
  it('succeeds on the first attempt without retrying', async () => {
    const { options } = makeHarness();
    let calls = 0;
    const result = await retry(async () => {
      calls += 1;
      return 'ok';
    }, options);
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries a retryable error and succeeds on the second attempt', async () => {
    const { options, delays } = makeHarness();
    let calls = 0;
    const result = await retry(async () => {
      calls += 1;
      if (calls === 1) throw providerError('RATE_LIMITED', true);
      return 'ok';
    }, options);
    expect(result).toBe('ok');
    expect(calls).toBe(2);
    expect(delays).toHaveLength(1);
  });

  it('exhausts maxRetries and re-throws the last error unchanged', async () => {
    const { options } = makeHarness();
    let calls = 0;
    const error = providerError('TIMEOUT', true);
    await expect(
      retry(async () => {
        calls += 1;
        throw error;
      }, options),
    ).rejects.toBe(error);
    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  it('does not retry a non-retryable error', async () => {
    const { options } = makeHarness();
    let calls = 0;
    const error = providerError('AUTHENTICATION_ERROR', false);
    await expect(
      retry(async () => {
        calls += 1;
        throw error;
      }, options),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
  });

  it('does not retry CANCELLED errors', async () => {
    const { options } = makeHarness();
    let calls = 0;
    const error = providerError('CANCELLED', false);
    await expect(
      retry(async () => {
        calls += 1;
        throw error;
      }, options),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
  });

  it('does not retry plain (non-model) errors', async () => {
    const { options } = makeHarness();
    let calls = 0;
    const error = new Error('not a model error');
    await expect(
      retry(async () => {
        calls += 1;
        throw error;
      }, options),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
  });

  it('does not retry errors outside the configured retryableCodes set', async () => {
    const { options } = makeHarness({
      policy: { maxRetries: 3, retryableCodes: ['RATE_LIMITED'] },
    });
    let calls = 0;
    const error = providerError('PROVIDER_ERROR', true);
    await expect(
      retry(async () => {
        calls += 1;
        throw error;
      }, options),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
  });

  it('retries only codes in the configured retryableCodes set', async () => {
    const { options } = makeHarness({
      policy: { maxRetries: 3, retryableCodes: ['RATE_LIMITED'] },
    });
    let calls = 0;
    const result = await retry(async () => {
      calls += 1;
      if (calls === 1) throw providerError('RATE_LIMITED', true);
      return 'ok';
    }, options);
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('honours maxRetries: 0 (no retry)', async () => {
    const { options } = makeHarness({ policy: { maxRetries: 0 } });
    let calls = 0;
    const error = providerError('RATE_LIMITED', true);
    await expect(
      retry(async () => {
        calls += 1;
        throw error;
      }, options),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
  });

  it('computes exponential backoff delays deterministically', async () => {
    const { options, delays } = makeHarness({
      policy: { maxRetries: 4, backoffMs: 100, backoffMultiplier: 2, maxBackoffMs: 1000, jitter: 0 },
    });
    let calls = 0;
    await expect(
      retry(async () => {
        calls += 1;
        throw providerError('NETWORK_ERROR', true);
      }, options),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(delays).toEqual([100, 200, 400, 800]);
  });

  it('caps backoff at maxBackoffMs', async () => {
    const { options, delays } = makeHarness({
      policy: { maxRetries: 4, backoffMs: 1000, backoffMultiplier: 2, maxBackoffMs: 1500, jitter: 0 },
    });
    let calls = 0;
    await expect(
      retry(async () => {
        calls += 1;
        throw providerError('NETWORK_ERROR', true);
      }, options),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(delays).toEqual([1000, 1500, 1500, 1500]);
  });

  it('calls onRetry with attempt index and delay before each retry', async () => {
    const retried: Array<{ attempt: number; delayMs: number }> = [];
    const { options } = makeHarness({
      policy: { maxRetries: 2, backoffMs: 50, backoffMultiplier: 2, jitter: 0 },
      onRetry: ({ attempt, delayMs }) => {
        retried.push({ attempt, delayMs });
      },
    });
    let calls = 0;
    await retry(async () => {
      calls += 1;
      if (calls <= 2) throw providerError('RATE_LIMITED', true);
      return 'ok';
    }, options);
    expect(retried).toEqual([
      { attempt: 0, delayMs: 50 },
      { attempt: 1, delayMs: 100 },
    ]);
  });

  it('rejects CANCELLED when the external signal aborts during a backoff wait', async () => {
    const controller = new AbortController();
    const { options } = makeHarness({
      signal: controller.signal,
      sleep: (ms, signal) => {
        return new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, ms);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new ModelProviderError('cancelled', {
              provider: 'test-provider',
              code: 'CANCELLED',
              retryable: false,
            }));
          }, { once: true });
        });
      },
    });
    let calls = 0;
    const pending = retry(async () => {
      calls += 1;
      throw providerError('RATE_LIMITED', true);
    }, options);
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED', retryable: false });
    expect(calls).toBe(1);
  });

  it('rejects CANCELLED immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { options } = makeHarness({ signal: controller.signal });
    let calls = 0;
    await expect(
      retry(async () => {
        calls += 1;
        return 'ok';
      }, options),
    ).rejects.toMatchObject({ code: 'CANCELLED', retryable: false });
    expect(calls).toBe(0);
  });

  it('is deterministic for identical inputs', async () => {
    const run = async () => {
      const { options, delays } = makeHarness({
        policy: { maxRetries: 2, backoffMs: 10, backoffMultiplier: 3, jitter: 0 },
      });
      let calls = 0;
      await expect(
        retry(async () => {
          calls += 1;
          throw providerError('TIMEOUT', true);
        }, options),
      ).rejects.toMatchObject({ code: 'TIMEOUT' });
      return { calls, delays };
    };
    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
  });
});

describe('defaultSleep', () => {
  it('resolves after the delay without a signal', async () => {
    const start = Date.now();
    await defaultSleep(5);
    expect(Date.now() - start).toBeGreaterThanOrEqual(4);
  });

  it('rejects CANCELLED when the signal aborts mid-wait', async () => {
    const controller = new AbortController();
    const pending = defaultSleep(1000, controller.signal, 'test-provider', 'generate');
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED', retryable: false });
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      defaultSleep(100, controller.signal, 'test-provider', 'generate'),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('classification helpers', () => {
  it('marks the default retryable codes', () => {
    expect(DEFAULT_RETRYABLE_CODES).toEqual([
      'RATE_LIMITED',
      'TIMEOUT',
      'NETWORK_ERROR',
      'PROVIDER_ERROR',
    ]);
  });

  it('isRetryableCode reflects the default set', () => {
    expect(isRetryableCode('RATE_LIMITED')).toBe(true);
    expect(isRetryableCode('TIMEOUT')).toBe(true);
    expect(isRetryableCode('NETWORK_ERROR')).toBe(true);
    expect(isRetryableCode('PROVIDER_ERROR')).toBe(true);
    expect(isRetryableCode('AUTHENTICATION_ERROR')).toBe(false);
    expect(isRetryableCode('INVALID_REQUEST')).toBe(false);
    expect(isRetryableCode('CANCELLED')).toBe(false);
    expect(isRetryableCode('MODEL_NOT_FOUND')).toBe(false);
    expect(isRetryableCode('UNKNOWN')).toBe(false);
  });

  it('shouldRetry respects attempt budget', () => {
    const policy = { maxRetries: 2 };
    const error = providerError('RATE_LIMITED', true);
    expect(shouldRetry(error, 0, policy)).toBe(true);
    expect(shouldRetry(error, 1, policy)).toBe(true);
    expect(shouldRetry(error, 2, policy)).toBe(false);
  });

  it('shouldRetry is false for non-retryable and non-model errors', () => {
    expect(shouldRetry(providerError('AUTHENTICATION_ERROR', false), 0, {})).toBe(false);
    expect(shouldRetry(providerError('CANCELLED', false), 0, {})).toBe(false);
    expect(shouldRetry(new Error('plain'), 0, {})).toBe(false);
    expect(shouldRetry(null, 0, {})).toBe(false);
  });

  it('shouldRetry respects retryableCodes override', () => {
    const policy = { maxRetries: 3, retryableCodes: ['RATE_LIMITED'] as const };
    expect(shouldRetry(providerError('RATE_LIMITED', true), 0, policy)).toBe(true);
    expect(shouldRetry(providerError('NETWORK_ERROR', true), 0, policy)).toBe(false);
  });
});

describe('normalizePolicy and computeBackoff', () => {
  it('applies deterministic defaults', () => {
    expect(normalizePolicy()).toEqual({
      maxRetries: 2,
      backoffMs: 200,
      backoffMultiplier: 2,
      maxBackoffMs: 8000,
      jitter: 0.1,
      retryableCodes: [...DEFAULT_RETRYABLE_CODES],
    });
  });

  it('clamps negative maxRetries to zero', () => {
    expect(normalizePolicy({ maxRetries: -5 }).maxRetries).toBe(0);
  });

  it('clamps jitter into [0, 1]', () => {
    expect(normalizePolicy({ jitter: 5 }).jitter).toBe(1);
    expect(normalizePolicy({ jitter: -1 }).jitter).toBe(0);
  });

  it('computeBackoff is deterministic with jitter 0', () => {
    expect(computeBackoff(0, { backoffMs: 100, backoffMultiplier: 2, maxBackoffMs: 1000, jitter: 0 }, () => 0)).toBe(100);
    expect(computeBackoff(1, { backoffMs: 100, backoffMultiplier: 2, maxBackoffMs: 1000, jitter: 0 }, () => 0)).toBe(200);
    expect(computeBackoff(2, { backoffMs: 100, backoffMultiplier: 2, maxBackoffMs: 1000, jitter: 0 }, () => 0)).toBe(400);
  });

  it('computeBackoff includes jitter when random returns a fraction', () => {
    const base = computeBackoff(0, { backoffMs: 100, backoffMultiplier: 2, maxBackoffMs: 1000, jitter: 0.5 }, () => 0);
    const withJitter = computeBackoff(0, { backoffMs: 100, backoffMultiplier: 2, maxBackoffMs: 1000, jitter: 0.5 }, () => 1);
    expect(withJitter).toBe(base + 100 * 0.5);
  });
});
