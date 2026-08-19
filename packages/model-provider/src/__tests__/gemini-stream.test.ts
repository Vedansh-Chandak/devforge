import { describe, it, expect, vi } from 'vitest';
import { GeminiProvider } from '../gemini.js';
import { collectStream, streamedText } from '../streaming.js';
import { createStreamFetch, sseFrame } from './helpers/mock-fetch.js';
import type { StreamSource } from './helpers/mock-fetch.js';

function geminiChunk(overrides: Record<string, unknown> = {}) {
  return {
    candidates: [
      { content: { parts: [{ text: 'hello ' }], role: 'model' } },
    ],
    ...overrides,
  };
}

function streamProvider(
  sources: readonly StreamSource[] | StreamSource,
  config: Record<string, unknown> = {},
) {
  const mock = createStreamFetch(sources);
  const provider = new GeminiProvider(
    { model: 'gemini-2.5-flash', apiKey: 'google-key-stream-1', ...config },
    mock.fetchFn,
  );
  return { provider, mock };
}

describe('GeminiProvider streaming (DF-026D)', () => {
  it('normalizes text chunks into text_delta events and completes', async () => {
    const { provider } = streamProvider({
      chunks: [
        sseFrame(JSON.stringify(geminiChunk({ candidates: [{ content: { parts: [{ text: 'hello ' }], role: 'model' } }] }))),
        sseFrame(JSON.stringify(geminiChunk({ candidates: [{ content: { parts: [{ text: 'world' }], role: 'model' } }] }))),
        sseFrame(JSON.stringify(geminiChunk({ candidates: [{ content: { parts: [{ text: '' }], role: 'model' }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }))),
      ],
    });
    const events = await collectStream(
      provider.stream({ messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(streamedText(events)).toBe('hello world');
    const usage = events.filter((event) => event.type === 'usage');
    expect(usage).toEqual([
      {
        type: 'usage',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        provider: 'gemini',
      },
    ]);
    const completed = events.filter((event) => event.type === 'completed');
    expect(completed).toEqual([
      {
        type: 'completed',
        finishReason: 'stop',
        model: undefined,
        provider: 'gemini',
      },
    ]);
  });

  it('uses the streamGenerateContent endpoint with alt=sse', async () => {
    const { provider, mock } = streamProvider({
      chunks: [sseFrame(JSON.stringify(geminiChunk())), sseFrame(JSON.stringify(geminiChunk({ candidates: [{ content: { parts: [{ text: '' }], role: 'model' }, finishReason: 'STOP' }] })))],
    });
    await collectStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(mock.calls[0]!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
    );
  });

  it('rejects malformed SSE chunks', async () => {
    const { provider } = streamProvider({
      chunks: ['data: not json\n\n'],
    });
    await expect(
      collectStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
  });

  it('rejects a truncated stream with no content and no completion', async () => {
    const { provider } = streamProvider({
      chunks: [sseFrame(JSON.stringify({ candidates: [] }))],
    });
    await expect(
      collectStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    ).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: expect.stringContaining('without content or completion'),
    });
  });

  it('normalizes HTTP errors before the first event', async () => {
    const { provider } = streamProvider({
      status: 429,
      jsonError: { error: { message: 'quota', status: 'RESOURCE_EXHAUSTED' } },
    });
    await expect(
      collectStream(
        provider.stream({ messages: [{ role: 'user', content: 'hi' }], maxRetries: 0 }),
      ),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });

  it('cancels mid-stream and emits no events after cancellation', async () => {
    const controller = new AbortController();
    const onCancel = vi.fn();
    const { provider, mock } = streamProvider({
      chunks: [
        sseFrame(JSON.stringify(geminiChunk({ candidates: [{ content: { parts: [{ text: 'partial ' }], role: 'model' } }] }))),
      ],
      stallAfter: 0,
      onCancel,
    });
    const iterator = provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value).toEqual({ type: 'text_delta', text: 'partial ' });

    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'CANCELLED',
      retryable: false,
    });
    expect(onCancel).toHaveBeenCalled();
    expect(mock.cancelled).toHaveLength(1);
  });

  it('rejects TIMEOUT when the internal deadline fires mid-stream', async () => {
    const { provider } = streamProvider(
      {
        chunks: [
          sseFrame(JSON.stringify(geminiChunk({ candidates: [{ content: { parts: [{ text: 'partial ' }], role: 'model' } }] }))),
        ],
        stallAfter: 0,
      },
      { timeoutMs: 30 },
    );
    const iterator = provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
    })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({
      type: 'text_delta',
      text: 'partial ',
    });
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });
  });
});
