import { describe, it, expect, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible.js';
import { ModelProviderError } from '../errors.js';
import type { ModelStreamEvent } from '../streaming.js';
import { collectStream, streamedText } from '../streaming.js';
import {
  createStreamFetch,
  sseFrame,
  fastRetryPolicy,
} from './helpers/mock-fetch.js';
import type { StreamSource } from './helpers/mock-fetch.js';

function openaiChunk(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    model: 'gpt-4o',
    choices: [
      { index: 0, delta: { content: 'Hello' }, finish_reason: null },
    ],
    ...overrides,
  };
}

function streamProvider(
  sources: readonly StreamSource[] | StreamSource,
  config: Record<string, unknown> = {},
) {
  const mock = createStreamFetch(sources);
  const provider = new OpenAICompatibleProvider(
    { baseUrl: 'https://x/v1', model: 'gpt-4o', ...config },
    mock.fetchFn,
  );
  return { provider, mock };
}

describe('OpenAICompatibleProvider streaming (DF-026D)', () => {
  describe('text deltas', () => {
    it('yields incremental text deltas without buffering the response', async () => {
      const { provider } = streamProvider({
        chunks: [
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] }))),
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null }] }))),
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }))),
          'data: [DONE]\n\n',
        ],
      });
      const events = await collectStream(
        provider.stream({ messages: [{ role: 'user', content: 'hi' }] }),
      );
      const deltas = events.filter((event) => event.type === 'text_delta');
      expect(deltas).toEqual([
        { type: 'text_delta', text: 'Hello' },
        { type: 'text_delta', text: ' world' },
      ]);
      expect(streamedText(events)).toBe('Hello world');
    });

    it('emits a normalized completed event at the end', async () => {
      const { provider } = streamProvider({
        chunks: [
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] }))),
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }))),
          'data: [DONE]\n\n',
        ],
      });
      const events = await collectStream(
        provider.stream({ messages: [{ role: 'user', content: 'hi' }] }),
      );
      const completed = events.filter((event) => event.type === 'completed');
      expect(completed).toEqual([
        {
          type: 'completed',
          finishReason: 'stop',
          id: 'chatcmpl-1',
          model: 'gpt-4o',
          provider: 'openai-compatible',
        },
      ]);
    });

    it('sends stream:true in the request body', async () => {
      const { provider, mock } = streamProvider({
        chunks: [sseFrame(JSON.stringify(openaiChunk())), 'data: [DONE]\n\n'],
      });
      await collectStream(
        provider.stream({ messages: [{ role: 'user', content: 'hi' }] }),
      );
      const body = JSON.parse(mock.calls[0]!.init!.body as string) as Record<string, unknown>;
      expect(body.stream).toBe(true);
      expect(body.model).toBe('gpt-4o');
    });
  });

  describe('usage', () => {
    it('emits a usage event when a chunk carries token accounting', async () => {
      const { provider } = streamProvider({
        chunks: [
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: { content: 'x' }, finish_reason: null }] }))),
          sseFrame(JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })),
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }))),
          'data: [DONE]\n\n',
        ],
      });
      const events = await collectStream(
        provider.stream({ messages: [{ role: 'user', content: 'hi' }] }),
      );
      const usage = events.filter((event) => event.type === 'usage');
      expect(usage).toEqual([
        {
          type: 'usage',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          provider: 'openai-compatible',
        },
      ]);
    });
  });

  describe('tool calls', () => {
    it('reassembles streamed tool-call fragments into one event', async () => {
      const { provider } = streamProvider({
        chunks: [
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'search', arguments: '' } }] }, finish_reason: null }] }))),
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] }, finish_reason: null }] }))),
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"devforge"}' } }] }, finish_reason: 'tool_calls' }] }))),
          'data: [DONE]\n\n',
        ],
      });
      const events = await collectStream(
        provider.stream({ messages: [{ role: 'user', content: 'hi' }] }),
      );
      const toolCalls = events.filter((event) => event.type === 'tool_call');
      expect(toolCalls).toEqual([
        {
          type: 'tool_call',
          id: 'call_1',
          name: 'search',
          arguments: '{"q":"devforge"}',
        },
      ]);
      const completed = events.filter((event) => event.type === 'completed');
      expect(completed[0]).toMatchObject({ type: 'completed', finishReason: 'tool_call' });
    });
  });

  describe('malformed streams', () => {
    it('rejects non-JSON SSE payloads with a provider error', async () => {
      const { provider } = streamProvider({
        chunks: ['data: this is not json\n\n'],
      });
      await expect(
        collectStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
    });

    it('rejects a stream that ends without completion', async () => {
      const { provider } = streamProvider({
        chunks: [
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }] }))),
        ],
      });
      await expect(
        collectStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
      ).rejects.toMatchObject({
        code: 'PROVIDER_ERROR',
        message: expect.stringContaining('before completion'),
      });
    });
  });

  describe('HTTP failures', () => {
    it('normalizes HTTP errors before the first event', async () => {
      const { provider } = streamProvider({
        status: 500,
        jsonError: { error: { message: 'boom' } },
      });
      await expect(
        collectStream(
          provider.stream({
            messages: [{ role: 'user', content: 'hi' }],
            maxRetries: 0,
          }),
        ),
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: true });
    });
  });

  describe('retry semantics (DF-026D)', () => {
    function retryableProvider(
      sources: readonly StreamSource[] | StreamSource,
    ) {
      return streamProvider(sources, {
        retryPolicy: fastRetryPolicy(2),
        apiKey: 'sk-stream-secret-1',
      });
    }

    it('retries a retryable failure before the first event and succeeds', async () => {
      const { provider, mock } = retryableProvider([
        { status: 429, jsonError: { error: { message: 'slow down' } } },
        {
          status: 200,
          chunks: [sseFrame(JSON.stringify(openaiChunk())), 'data: [DONE]\n\n'],
        },
      ]);
      const events = await collectStream(
        provider.stream({ messages: [{ role: 'user', content: 'hi' }] }),
      );
      expect(streamedText(events)).toBe('Hello');
      expect(mock.calls).toHaveLength(2);
    });

    it('does not retry non-retryable failures', async () => {
      const { provider, mock } = retryableProvider({
        status: 401,
        jsonError: { error: { message: 'nope' } },
      });
      await expect(
        collectStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
      ).rejects.toMatchObject({ code: 'AUTHENTICATION_ERROR', retryable: false });
      expect(mock.calls).toHaveLength(1);
    });

    it('never retries after output has already been emitted', async () => {
      const { provider, mock } = retryableProvider({
        chunks: [
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: { content: 'partial ' }, finish_reason: null }] }))),
        ],
        errorAfter: 1,
      });
      const iterator = provider.stream({
        messages: [{ role: 'user', content: 'hi' }],
      })[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.done).toBe(false);
      expect(first.value).toEqual({ type: 'text_delta', text: 'partial ' });

      await expect(iterator.next()).rejects.toMatchObject({
        code: 'PROVIDER_ERROR',
        retryable: false,
      });
      expect(mock.calls).toHaveLength(1);
    });
  });

  describe('timeout', () => {
    it('terminates an active stream with TIMEOUT and stays retryable', async () => {
      const { provider } = streamProvider(
        {
          chunks: [
            sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: { content: 'partial ' }, finish_reason: null }] }))),
          ],
          stallAfter: 0,
        },
        { timeoutMs: 30 },
      );
      const iterator = provider.stream({
        messages: [{ role: 'user', content: 'hi' }],
      })[Symbol.asyncIterator]();

      const first = await iterator.next();
      expect(first.value).toEqual({ type: 'text_delta', text: 'partial ' });

      await expect(iterator.next()).rejects.toMatchObject({
        code: 'TIMEOUT',
        retryable: true,
      });
    });

    it('rejects an already-aborted signal immediately without calling fetch', async () => {
      const { provider, mock } = streamProvider({
        chunks: [sseFrame(JSON.stringify(openaiChunk())), 'data: [DONE]\n\n'],
      });
      const controller = new AbortController();
      controller.abort();
      await expect(
        collectStream(
          provider.stream({
            messages: [{ role: 'user', content: 'hi' }],
            signal: controller.signal,
          }),
        ),
      ).rejects.toMatchObject({ code: 'CANCELLED', retryable: false });
      expect(mock.calls).toHaveLength(0);
    });
  });

  describe('cancellation', () => {
    it('cancels mid-stream, emits no further events, and tears down the request', async () => {
      const controller = new AbortController();
      const onCancel = vi.fn();
      const { provider, mock } = streamProvider({
        chunks: [
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: { content: 'first ' }, finish_reason: null }] }))),
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: { content: 'second ' }, finish_reason: null }] }))),
        ],
        stallAfter: 1,
        onCancel,
      });
      const iterator = provider.stream({
        messages: [{ role: 'user', content: 'hi' }],
        signal: controller.signal,
      })[Symbol.asyncIterator]();

      const first = await iterator.next();
      expect(first.value).toEqual({ type: 'text_delta', text: 'first ' });
      const second = await iterator.next();
      expect(second.value).toEqual({ type: 'text_delta', text: 'second ' });

      controller.abort();
      await expect(iterator.next()).rejects.toMatchObject({
        code: 'CANCELLED',
        retryable: false,
      });

      const rest = await iterator.next();
      expect(rest.done).toBe(true);
      expect(onCancel).toHaveBeenCalled();
      expect(mock.cancelled).toHaveLength(1);
    });
  });

  describe('structured output', () => {
    const schema = {
      type: 'object' as const,
      properties: { ok: { type: 'boolean' as const } },
      required: ['ok'],
      additionalProperties: false,
    };

    it('emits completed only for valid streamed JSON', async () => {
      const { provider } = streamProvider({
        chunks: [
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: { content: '{"ok":' }, finish_reason: null }] }))),
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: { content: 'true}' }, finish_reason: null }] }))),
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }))),
          'data: [DONE]\n\n',
        ],
      });
      const events = await collectStream(
        provider.stream({
          messages: [{ role: 'user', content: 'hi' }],
          responseFormat: { type: 'json_schema', schema },
        }),
      );
      expect(streamedText(events)).toBe('{"ok":true}');
      expect(events.some((event) => event.type === 'completed')).toBe(true);
    });

    it('rejects malformed streamed JSON without a completed event', async () => {
      const { provider } = streamProvider({
        chunks: [
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: { content: '{"ok":' }, finish_reason: null }] }))),
          sseFrame(JSON.stringify(openaiChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }))),
          'data: [DONE]\n\n',
        ],
      });
      const events: ModelStreamEvent[] = [];
      const iterator = provider.stream({
        messages: [{ role: 'user', content: 'hi' }],
        responseFormat: { type: 'json_schema', schema },
      })[Symbol.asyncIterator]();
      await expect(
        (async () => {
          for (;;) {
            const { done, value } = await iterator.next();
            if (done) break;
            events.push(value);
          }
        })(),
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
      expect(events.some((event) => event.type === 'completed')).toBe(false);
    });
  });
});
