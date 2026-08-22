import { describe, it, expect, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible.js';
import { ModelProviderError } from '../errors.js';
import { createMockFetch } from './helpers/mock-fetch.js';
import type { MockBehavior } from './helpers/mock-fetch.js';

/**
 * Regression tests for TokenRouter-style OpenAI-compatible integration (DF-032).
 *
 * These prove, with a fully mocked `fetch` (no network, no real key):
 *  - namespaced model IDs such as `qwen/qwen3.8-max-free` are preserved
 *    verbatim and sent as the exact `model` field;
 *  - the `Authorization: Bearer <key>` header is constructed correctly;
 *  - the `/v1` base URL is joined to `/chat/completions` correctly;
 *  - pre-existing non-namespaced OpenAI-compatible models keep working;
 *  - secrets never leak into error output / diagnostics.
 */

const TOKENROUTER_BASE = 'https://api.tokenrouter.com/v1';
const NAMESPACED_MODEL = 'qwen/qwen3.8-max-free';
const FAKE_KEY = 'tr-real-secret-key-1234567890';

function chatOk(model = NAMESPACED_MODEL): MockBehavior {
  return {
    kind: 'json',
    status: 200,
    body: {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      model: 'qwen3.8-max-pd',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'hello' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  };
}

describe('OpenAI-compatible provider — namespaced model IDs (DF-032)', () => {
  it('preserves and sends the exact namespaced model id (qwen/qwen3.8-max-free)', async () => {
    const mock = createMockFetch(chatOk());
    const provider = new OpenAICompatibleProvider(
      { baseUrl: TOKENROUTER_BASE, apiKey: FAKE_KEY, model: NAMESPACED_MODEL },
      mock.fetchFn,
    );

    const result = await provider.generate({
      messages: [{ role: 'user', content: 'Reply with exactly: hello' }],
    });

    const body = mock.requestBodies()[0]!;
    expect(body.model).toBe('qwen/qwen3.8-max-free');
    // The model is the complete id; the qwen/ namespace is never stripped.
    expect(body.model).toContain('/');
    expect(result.content).toBe('hello');
  });

  it('posts to <baseUrl>/chat/completions and sends Bearer auth', async () => {
    const mock = createMockFetch(chatOk());
    const provider = new OpenAICompatibleProvider(
      { baseUrl: TOKENROUTER_BASE, apiKey: FAKE_KEY, model: NAMESPACED_MODEL },
      mock.fetchFn,
    );

    await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });

    expect(mock.last().url).toBe('https://api.tokenrouter.com/v1/chat/completions');
    expect(mock.requestHeaders().Authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(mock.requestHeaders()['Content-Type']).toBe('application/json');
  });

  it('handles a base URL that already ends with /v1 and trailing slashes', async () => {
    const mock = createMockFetch(chatOk());
    const provider = new OpenAICompatibleProvider(
      { baseUrl: 'https://api.tokenrouter.com/v1///', apiKey: FAKE_KEY, model: NAMESPACED_MODEL },
      mock.fetchFn,
    );

    await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });

    expect(mock.last().url).toBe('https://api.tokenrouter.com/v1/chat/completions');
  });

  it('does not re-normalize or split the model namespace when sent on the request', async () => {
    const mock = createMockFetch(chatOk());
    const provider = new OpenAICompatibleProvider(
      { baseUrl: TOKENROUTER_BASE, apiKey: FAKE_KEY, model: 'gpt-4o' },
      mock.fetchFn,
    );

    // An explicit namespaced model on the request must also survive untouched.
    await provider.generate({
      model: NAMESPACED_MODEL,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(mock.requestBodies()[0]!.model).toBe('qwen/qwen3.8-max-free');
  });

  it('continues to work for pre-existing non-namespaced OpenAI models', async () => {
    const mock = createMockFetch(chatOk('gpt-4o'));
    const provider = new OpenAICompatibleProvider(
      { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-openai', model: 'gpt-4o' },
      mock.fetchFn,
    );

    const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
    expect(mock.requestBodies()[0]!.model).toBe('gpt-4o');
    expect(result.content).toBe('hello');
  });

  it('never leaks the api key into error output on a 401', async () => {
    const mock = createMockFetch({
      kind: 'json',
      status: 401,
      body: { error: { message: 'Invalid token' } },
    });
    const provider = new OpenAICompatibleProvider(
      { baseUrl: TOKENROUTER_BASE, apiKey: FAKE_KEY, model: NAMESPACED_MODEL },
      mock.fetchFn,
    );

    let thrown: unknown;
    try {
      await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ModelProviderError);
    const rendered = thrown instanceof Error ? `${thrown.message}\n${thrown.stack ?? ''}` : String(thrown);
    expect(rendered).not.toContain(FAKE_KEY);
    // The provider-surface message still exposes the normalized status reason.
    expect(thrown instanceof Error ? thrown.message : '').toContain('Provider error (401)');
  });
});
