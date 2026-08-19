import { describe, it, expect, vi } from 'vitest';
import { AnthropicProvider } from '../anthropic.js';
import { collectStream, streamedText } from '../streaming.js';
import { createStreamFetch, sseFrame } from './helpers/mock-fetch.js';
import type { StreamSource } from './helpers/mock-fetch.js';

function messageStart(overrides: Record<string, unknown> = {}) {
  return {
    type: 'message_start',
    message: {
      id: 'msg_01abc',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 10, output_tokens: 0 },
    },
    ...overrides,
  };
}

function streamProvider(
  sources: readonly StreamSource[] | StreamSource,
  config: Record<string, unknown> = {},
) {
  const mock = createStreamFetch(sources);
  const provider = new AnthropicProvider(
    { model: 'claude-sonnet-4-20250514', apiKey: 'anthropic-key-stream-1', ...config },
    mock.fetchFn,
  );
  return { provider, mock };
}

describe('AnthropicProvider streaming (DF-026D)', () => {
  it('normalizes text deltas, usage, and completion', async () => {
    const { provider } = streamProvider({
      chunks: [
        sseFrame(JSON.stringify(messageStart()), 'message_start'),
        sseFrame(JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }), 'content_block_start'),
        sseFrame(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } }), 'content_block_delta'),
        sseFrame(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } }), 'content_block_delta'),
        sseFrame(JSON.stringify({ type: 'content_block_stop', index: 0 }), 'content_block_stop'),
        sseFrame(JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }), 'message_delta'),
        sseFrame(JSON.stringify({ type: 'message_stop' }), 'message_stop'),
      ],
    });
    const events = await collectStream(
      provider.stream({ messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(streamedText(events)).toBe('Hello world');
    expect(events.filter((event) => event.type === 'usage')).toEqual([
      {
        type: 'usage',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        provider: 'anthropic',
      },
    ]);
    expect(events.filter((event) => event.type === 'completed')).toEqual([
      {
        type: 'completed',
        finishReason: 'stop',
        id: 'msg_01abc',
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
      },
    ]);
  });

  it('reassembles tool_use blocks into a complete tool_call event', async () => {
    const { provider } = streamProvider({
      chunks: [
        sseFrame(JSON.stringify(messageStart()), 'message_start'),
        sseFrame(JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'search', input: {} } }), 'content_block_start'),
        sseFrame(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"q":' } }), 'content_block_delta'),
        sseFrame(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"devforge"}' } }), 'content_block_delta'),
        sseFrame(JSON.stringify({ type: 'content_block_stop', index: 0 }), 'content_block_stop'),
        sseFrame(JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } }), 'message_delta'),
        sseFrame(JSON.stringify({ type: 'message_stop' }), 'message_stop'),
      ],
    });
    const events = await collectStream(
      provider.stream({ messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(events.filter((event) => event.type === 'tool_call')).toEqual([
      {
        type: 'tool_call',
        id: 't1',
        name: 'search',
        arguments: '{"q":"devforge"}',
      },
    ]);
  });

  it('sends stream:true in the request body', async () => {
    const { provider, mock } = streamProvider({
      chunks: [
        sseFrame(JSON.stringify(messageStart()), 'message_start'),
        sseFrame(JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }), 'message_delta'),
        sseFrame(JSON.stringify({ type: 'message_stop' }), 'message_stop'),
      ],
    });
    await collectStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }));
    const body = JSON.parse(mock.calls[0]!.init!.body as string) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(4096);
  });

  it('rejects a malformed SSE payload', async () => {
    const { provider } = streamProvider({
      chunks: ['data: not json\n\n'],
    });
    await expect(
      collectStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
  });

  it('rejects a stream that ends without message_stop', async () => {
    const { provider } = streamProvider({
      chunks: [
        sseFrame(JSON.stringify(messageStart()), 'message_start'),
        sseFrame(JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }), 'content_block_start'),
        sseFrame(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } }), 'content_block_delta'),
      ],
    });
    await expect(
      collectStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    ).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: expect.stringContaining('message_stop'),
    });
  });

  it('normalizes in-band overloaded errors as retryable provider errors', async () => {
    const { provider } = streamProvider({
      chunks: [
        sseFrame(JSON.stringify(messageStart()), 'message_start'),
        sseFrame(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), 'error'),
      ],
    });
    await expect(
      collectStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: true });
  });

  it('cancels mid-stream and emits no events after cancellation', async () => {
    const controller = new AbortController();
    const onCancel = vi.fn();
    const { provider, mock } = streamProvider({
      chunks: [
        sseFrame(JSON.stringify(messageStart()), 'message_start'),
        sseFrame(JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }), 'content_block_start'),
        sseFrame(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } }), 'content_block_delta'),
      ],
      stallAfter: 2,
      onCancel,
    });
    const iterator = provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value).toEqual({ type: 'text_delta', text: 'partial' });

    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'CANCELLED',
      retryable: false,
    });
    expect(onCancel).toHaveBeenCalled();
    expect(mock.cancelled).toHaveLength(1);
  });
});
