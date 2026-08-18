import { describe, it, expect } from 'vitest';
import { withTimeout } from '../timeout.js';
import { ModelProviderError } from '../errors.js';

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('withTimeout', () => {
  it('resolves with the work value before the deadline', async () => {
    const value = await withTimeout(async () => {
      await delay(5);
      return 'done';
    }, { timeoutMs: 200, operation: 'generate', provider: 'test' });
    expect(value).toBe('done');
  });

  it('rejects with TIMEOUT (retryable) when the deadline elapses', async () => {
    await expect(
      withTimeout(async () => {
        await delay(200);
        return 'too slow';
      }, { timeoutMs: 10, operation: 'generate', provider: 'test' }),
    ).rejects.toMatchObject({
      name: 'ModelProviderError',
      code: 'TIMEOUT',
      retryable: true,
      provider: 'test',
    });
  });

  it('includes the operation and deadline in the timeout message', async () => {
    try {
      await withTimeout(async () => {
        await delay(200);
        return 'x';
      }, { timeoutMs: 10, operation: 'generate', provider: 'test' });
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelProviderError);
      expect((error as ModelProviderError).message).toContain('generate');
      expect((error as ModelProviderError).message).toContain('10ms');
    }
  });

  it('propagates the work rejection when it fails before the deadline', async () => {
    const workError = new ModelProviderError('network down', {
      provider: 'test',
      code: 'NETWORK_ERROR',
      retryable: true,
    });
    await expect(
      withTimeout(async () => {
        await delay(1);
        throw workError;
      }, { timeoutMs: 200, operation: 'generate', provider: 'test' }),
    ).rejects.toBe(workError);
  });

  it('propagates the work rejection even for plain errors', async () => {
    const plain = new Error('plain failure');
    await expect(
      withTimeout(async () => {
        throw plain;
      }, { timeoutMs: 200 }),
    ).rejects.toBe(plain);
  });

  it('rejects with CANCELLED (non-retryable) when the external signal aborts', async () => {
    const controller = new AbortController();
    const pending = withTimeout(async () => {
      await delay(200);
      return 'x';
    }, { timeoutMs: 1000, signal: controller.signal, operation: 'generate', provider: 'test' });
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toMatchObject({
      code: 'CANCELLED',
      retryable: false,
      provider: 'test',
    });
  });

  it('rejects with CANCELLED when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withTimeout(async () => 'x', {
        timeoutMs: 100,
        signal: controller.signal,
        operation: 'generate',
        provider: 'test',
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED', retryable: false });
  });

  it('keeps TIMEOUT when the internal deadline fires before the external abort', async () => {
    const controller = new AbortController();
    const pending = withTimeout(async () => {
      await delay(200);
      return 'x';
    }, { timeoutMs: 10, signal: controller.signal, operation: 'generate', provider: 'test' });
    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
  });

  it('keeps CANCELLED when the external abort fires before the deadline', async () => {
    const controller = new AbortController();
    const pending = withTimeout(async () => {
      await delay(200);
      return 'x';
    }, { timeoutMs: 1000, signal: controller.signal, operation: 'generate', provider: 'test' });
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED', retryable: false });
  });

  it('disables the deadline when timeoutMs <= 0', async () => {
    const value = await withTimeout(async () => {
      await delay(30);
      return 'late but fine';
    }, { timeoutMs: 0, operation: 'generate', provider: 'test' });
    expect(value).toBe('late but fine');
  });

  it('passes an AbortSignal into the work factory', async () => {
    let received: AbortSignal | undefined;
    await withTimeout((signal) => {
      received = signal;
      return 'ok';
    }, { timeoutMs: 100, operation: 'generate', provider: 'test' });
    expect(received).toBeInstanceOf(AbortSignal);
    expect(received?.aborted).toBe(false);
  });

  it('aborts the work signal when the deadline fires', async () => {
    let workSignal: AbortSignal | undefined;
    const pending = withTimeout((signal) => {
      workSignal = signal;
      return new Promise<string>((resolve) => {
        signal.addEventListener('abort', () => resolve('aborted'));
      });
    }, { timeoutMs: 10, operation: 'generate', provider: 'test' });
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(workSignal?.aborted).toBe(true);
  });

  it('does not throw when the external signal aborts after completion', async () => {
    const controller = new AbortController();
    const value = await withTimeout(async () => 'done', {
      timeoutMs: 100,
      signal: controller.signal,
      operation: 'generate',
      provider: 'test',
    });
    controller.abort();
    expect(value).toBe('done');
  });
});
