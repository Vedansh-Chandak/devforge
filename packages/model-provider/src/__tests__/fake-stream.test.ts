import { describe, it, expect } from 'vitest';
import { FakeModelProvider } from '../testing/fake-provider.js';
import { collectStream, streamedText } from '../streaming.js';
import { ModelProviderError } from '../errors.js';

describe('FakeModelProvider streaming (DF-026D)', () => {
  it('emits a scripted sequence of events deterministically', async () => {
    const provider = new FakeModelProvider({
      stream: {
        events: [
          { type: 'text_delta', text: 'one' },
          { type: 'text_delta', text: ' two' },
          { type: 'usage', inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          { type: 'completed', finishReason: 'stop', provider: 'fake-provider' },
        ],
      },
    });
    const events = await collectStream(
      provider.stream({ messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(events).toEqual([
      { type: 'text_delta', text: 'one' },
      { type: 'text_delta', text: ' two' },
      { type: 'usage', inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      { type: 'completed', finishReason: 'stop', provider: 'fake-provider' },
    ]);
    expect(streamedText(events)).toBe('one two');
  });

  it('derives a canonical text → usage → completed stream by default', async () => {
    const provider = new FakeModelProvider({
      response: {
        content: 'Deterministic answer',
        usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
      },
    });
    const events = await collectStream(
      provider.stream({ messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(events).toEqual([
      { type: 'text_delta', text: 'Deterministic answer' },
      {
        type: 'usage',
        inputTokens: 4,
        outputTokens: 6,
        totalTokens: 10,
        provider: 'fake-provider',
      },
      { type: 'completed', provider: 'fake-provider' },
    ]);
  });

  it('records streamed requests in history', async () => {
    const provider = new FakeModelProvider();
    await collectStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(provider.getRequestHistory()).toHaveLength(1);
    expect(provider.getRequestHistory()[0]?.messages[0]?.content).toBe('hi');
  });

  it('simulates failure when configured', async () => {
    const provider = new FakeModelProvider({
      stream: {
        error: { message: 'stream blew up', code: 'PROVIDER_ERROR', retryable: true },
      },
    });
    await expect(
      collectStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    ).rejects.toMatchObject({
      message: 'stream blew up',
      code: 'PROVIDER_ERROR',
      retryable: true,
      provider: 'fake-provider',
    });
  });

  it('cancels a scripted stream when the signal aborts', async () => {
    const controller = new AbortController();
    const provider = new FakeModelProvider({
      stream: {
        events: [
          { type: 'text_delta', text: 'a' },
          { type: 'text_delta', text: 'b' },
          { type: 'completed' },
        ],
        delay: 5,
      },
    });
    const iterator = provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value).toEqual({ type: 'text_delta', text: 'a' });
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'CANCELLED',
      retryable: false,
    });
  });

  it('rejects an already-aborted signal immediately', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new FakeModelProvider();
    await expect(
      collectStream(
        provider.stream({
          messages: [{ role: 'user', content: 'hi' }],
          signal: controller.signal,
        }),
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED', retryable: false });
  });

  it('keeps generate() behavior unchanged', async () => {
    const provider = new FakeModelProvider({
      response: { content: 'unchanged' },
    });
    expect((await provider.generate({ messages: [{ role: 'user', content: 'x' }] })).content).toBe('unchanged');

    const failing = new FakeModelProvider({
      error: { message: 'auth failed', code: 'AUTHENTICATION_ERROR' },
    });
    await expect(
      failing.generate({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_ERROR' });
  });

  it('supports the error event variant in scripted output', async () => {
    const error = new ModelProviderError('boom', {
      provider: 'fake-provider',
      code: 'PROVIDER_ERROR',
      retryable: false,
    });
    const provider = new FakeModelProvider({
      stream: { events: [{ type: 'error', error }] },
    });
    const events = await collectStream(
      provider.stream({ messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(events).toEqual([{ type: 'error', error }]);
  });
});
