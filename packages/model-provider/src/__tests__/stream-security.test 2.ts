import { describe, it, expect } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible.js';
import { GeminiProvider } from '../gemini.js';
import { AnthropicProvider } from '../anthropic.js';
import { collectStream } from '../streaming.js';
import { createStreamFetch, sseFrame } from './helpers/mock-fetch.js';

async function errorFromStream(stream: Promise<unknown>): Promise<Error> {
  const outcome = await stream.catch((e: unknown) => e);
  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
}

describe('streaming security (DF-026D)', () => {
  it('redacts the API key from malformed SSE payloads', async () => {
    const mock = createStreamFetch({
      chunks: ['data: this echoes sk-stream-123456 right here\n\n'],
    });
    const provider = new OpenAICompatibleProvider(
      { baseUrl: 'https://x/v1', model: 'gpt-4o', apiKey: 'sk-stream-123456' },
      mock.fetchFn,
    );
    const error = await errorFromStream(
      collectStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    );
    expect(error).toMatchObject({
      code: 'PROVIDER_ERROR',
      message: expect.stringContaining('[REDACTED]'),
    });
    expect(JSON.stringify(error)).not.toContain('sk-stream-123456');
  });

  it('redacts a hostile HTTP error body that echoes the API key', async () => {
    const mock = createStreamFetch({
      status: 500,
      jsonError: { error: { message: 'boom sk-hostile-789 key' } },
    });
    const provider = new OpenAICompatibleProvider(
      { baseUrl: 'https://x/v1', model: 'gpt-4o', apiKey: 'sk-hostile-789' },
      mock.fetchFn,
    );
    const error = await errorFromStream(
      collectStream(
        provider.stream({ messages: [{ role: 'user', content: 'hi' }], maxRetries: 0 }),
      ),
    );
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain('sk-hostile-789');
    expect(error.message).toContain('[REDACTED]');
  });

  it('never leaks the API key through serialized stream errors', async () => {
    const mock = createStreamFetch({
      status: 401,
      jsonError: { error: { message: 'nope sk-gemini-redact-01' } },
    });
    const provider = new GeminiProvider(
      { model: 'gemini-2.5-flash', apiKey: 'sk-gemini-redact-01' },
      mock.fetchFn,
    );
    const error = await errorFromStream(
      collectStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    );
    expect(JSON.stringify(error)).not.toContain('sk-gemini-redact-01');
  });

  it('redacts the key from in-band Anthropic stream errors', async () => {
    const mock = createStreamFetch({
      chunks: [
        sseFrame(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'overloaded_error',
              message: 'Overloaded using anthropic-key-stream-99',
            },
          }),
          'error',
        ),
      ],
    });
    const provider = new AnthropicProvider(
      { model: 'claude-sonnet-4-20250514', apiKey: 'anthropic-key-stream-99' },
      mock.fetchFn,
    );
    const error = await errorFromStream(
      collectStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    );
    expect(error.message).not.toContain('anthropic-key-stream-99');
    expect(error.message).toContain('[REDACTED]');
  });
});
