import { describe, it, expect } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible.js';
import { GeminiProvider } from '../gemini.js';
import { AnthropicProvider } from '../anthropic.js';
import type { ModelStreamEvent } from '../streaming.js';
import { collectStream, streamedText } from '../streaming.js';
import { createStreamFetch, sseFrame } from './helpers/mock-fetch.js';

const SCHEMA = {
  type: 'object' as const,
  properties: { ok: { type: 'boolean' as const } },
  required: ['ok'],
  additionalProperties: false,
};

function openaiChunk(content: string) {
  return JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    model: 'gpt-4o',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  });
}

describe('streaming structured output (DF-026D)', () => {
  it('emits completed only after validating streamed JSON (openai)', async () => {
    const mock = createStreamFetch({
      chunks: [
        sseFrame(openaiChunk('{"ok":')),
        sseFrame(openaiChunk('true}')),
        sseFrame(JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })),
        'data: [DONE]\n\n',
      ],
    });
    const provider = new OpenAICompatibleProvider(
      { baseUrl: 'https://x/v1', model: 'gpt-4o' },
      mock.fetchFn,
    );
    const events = await collectStream(
      provider.stream({
        messages: [{ role: 'user', content: 'hi' }],
        responseFormat: { type: 'json_schema', schema: SCHEMA },
      }),
    );
    expect(streamedText(events)).toBe('{"ok":true}');
    expect(events.some((event) => event.type === 'completed')).toBe(true);
  });

  it('rejects malformed streamed JSON with no completed event (openai)', async () => {
    const mock = createStreamFetch({
      chunks: [
        sseFrame(openaiChunk('{"ok":')),
        sseFrame(JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })),
        'data: [DONE]\n\n',
      ],
    });
    const provider = new OpenAICompatibleProvider(
      { baseUrl: 'https://x/v1', model: 'gpt-4o' },
      mock.fetchFn,
    );
    const events: ModelStreamEvent[] = [];
    const iterator = provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      responseFormat: { type: 'json_schema', schema: SCHEMA },
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

  it('rejects a validation failure and never reports success (openai)', async () => {
    const mock = createStreamFetch({
      chunks: [
        sseFrame(openaiChunk('{"ok":"yes"}')),
        sseFrame(JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })),
        'data: [DONE]\n\n',
      ],
    });
    const provider = new OpenAICompatibleProvider(
      { baseUrl: 'https://x/v1', model: 'gpt-4o' },
      mock.fetchFn,
    );
    const events: ModelStreamEvent[] = [];
    const iterator = provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      responseFormat: { type: 'json_schema', schema: SCHEMA },
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

  it('validates streamed JSON for Gemini structured output', async () => {
    const mock = createStreamFetch({
      chunks: [
        sseFrame(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":' }], role: 'model' } }] })),
        sseFrame(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'true}' }], role: 'model' } }] })),
        sseFrame(JSON.stringify({ candidates: [{ content: { parts: [{ text: '' }], role: 'model' }, finishReason: 'STOP' }] })),
      ],
    });
    const provider = new GeminiProvider(
      { model: 'gemini-2.5-flash', apiKey: 'k' },
      mock.fetchFn,
    );
    const events = await collectStream(
      provider.stream({
        messages: [{ role: 'user', content: 'hi' }],
        responseFormat: { type: 'json_schema', schema: SCHEMA },
      }),
    );
    expect(streamedText(events)).toBe('{"ok":true}');
    expect(events.some((event) => event.type === 'completed')).toBe(true);
  });

  it('validates streamed JSON for Anthropic structured output', async () => {
    const start = sseFrame(
      JSON.stringify({ type: 'message_start', message: { id: 'm', model: 'claude-sonnet-4-20250514', usage: { input_tokens: 1, output_tokens: 0 } } }),
      'message_start',
    );
    const delta = (text: string) =>
      sseFrame(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }), 'content_block_delta');
    const stop = sseFrame(JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }), 'message_delta');
    const end = sseFrame(JSON.stringify({ type: 'message_stop' }), 'message_stop');

    const mock = createStreamFetch({
      chunks: [
        start,
        sseFrame(JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }), 'content_block_start'),
        delta('{"ok":true}'),
        sseFrame(JSON.stringify({ type: 'content_block_stop', index: 0 }), 'content_block_stop'),
        stop,
        end,
      ],
    });
    const provider = new AnthropicProvider(
      { model: 'claude-sonnet-4-20250514', apiKey: 'k' },
      mock.fetchFn,
    );
    const events = await collectStream(
      provider.stream({
        messages: [{ role: 'user', content: 'hi' }],
        responseFormat: { type: 'json_schema', schema: SCHEMA },
      }),
    );
    expect(streamedText(events)).toBe('{"ok":true}');
    expect(events.some((event) => event.type === 'completed')).toBe(true);
  });

  it('rejects malformed streamed JSON for Anthropic structured output', async () => {
    const start = sseFrame(
      JSON.stringify({ type: 'message_start', message: { id: 'm', model: 'claude-sonnet-4-20250514', usage: { input_tokens: 1, output_tokens: 0 } } }),
      'message_start',
    );
    const delta = sseFrame(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"ok":' } }), 'content_block_delta');
    const stop = sseFrame(JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }), 'message_delta');
    const end = sseFrame(JSON.stringify({ type: 'message_stop' }), 'message_stop');

    const mock = createStreamFetch({
      chunks: [
        start,
        sseFrame(JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }), 'content_block_start'),
        delta,
        sseFrame(JSON.stringify({ type: 'content_block_stop', index: 0 }), 'content_block_stop'),
        stop,
        end,
      ],
    });
    const provider = new AnthropicProvider(
      { model: 'claude-sonnet-4-20250514', apiKey: 'k' },
      mock.fetchFn,
    );
    const events: ModelStreamEvent[] = [];
    const iterator = provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      responseFormat: { type: 'json_schema', schema: SCHEMA },
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
