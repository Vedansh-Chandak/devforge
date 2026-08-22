import { describe, it, expect } from 'vitest';
import {
  GeminiProvider,
  geminiClassifyHttpStatus,
  mapGeminiFinishReason,
  extractGeminiUsage,
  toGeminiContents,
} from '../gemini.js';
import {
  createMockFetch,
  fastRetryPolicy,
} from './helpers/mock-fetch.js';
import type { MockBehavior } from './helpers/mock-fetch.js';

const SCHEMA = {
  type: 'object' as const,
  properties: { ok: { type: 'boolean' as const } },
  required: ['ok'],
  additionalProperties: false,
};

function geminiBody(content = 'hello from gemini', overrides: Record<string, unknown> = {}) {
  return {
    candidates: [
      {
        content: { parts: [{ text: content }], role: 'model' },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    },
    modelVersion: 'gemini-2.5-flash',
    ...overrides,
  };
}

function makeProvider(
  behavior: MockBehavior,
  config: Record<string, unknown> = {},
) {
  const mock = createMockFetch(behavior);
  const provider = new GeminiProvider(
    { model: 'gemini-2.5-flash', apiKey: 'google-key-test-1', ...config },
    mock.fetchFn,
  );
  return { provider, mock };
}

describe('GeminiProvider', () => {
  describe('successful generation', () => {
    it('returns a normalized ModelResponse', async () => {
      const { provider } = makeProvider({ kind: 'json', body: geminiBody() });
      const result = await provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(result).toEqual({
        content: 'hello from gemini',
        model: 'gemini-2.5-flash',
        finishReason: 'stop',
        provider: 'gemini',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });
    });

    it('joins multiple parts into the final content', async () => {
      const { provider } = makeProvider({
        kind: 'json',
        body: geminiBody('', {
          candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] }, finishReason: 'STOP' }],
        }),
      });
      const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.content).toBe('ab');
    });
  });

  describe('request normalization', () => {
    it('posts to the model generateContent endpoint with x-goog-api-key', async () => {
      const { provider, mock } = makeProvider({ kind: 'json', body: geminiBody() });
      await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(mock.last().url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      );
      const headers = mock.requestHeaders();
      expect(headers['x-goog-api-key']).toBe('google-key-test-1');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('uses a configurable baseUrl', async () => {
      const { provider, mock } = makeProvider(
        { kind: 'json', body: geminiBody() },
        { baseUrl: 'https://my-proxy.example.com' },
      );
      await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(mock.last().url).toBe(
        'https://my-proxy.example.com/v1beta/models/gemini-2.5-flash:generateContent',
      );
    });

    it('maps roles and system instructions', async () => {
      const { provider, mock } = makeProvider({ kind: 'json', body: geminiBody() });
      await provider.generate({
        messages: [
          { role: 'system', content: 'Be terse.' },
          { role: 'user', content: 'Explain' },
          { role: 'assistant', content: 'Short.' },
          { role: 'user', content: 'Again' },
        ],
      });
      const body = mock.requestBodies()[0]!;
      expect(body.contents).toEqual([
        { role: 'user', parts: [{ text: 'Explain' }] },
        { role: 'model', parts: [{ text: 'Short.' }] },
        { role: 'user', parts: [{ text: 'Again' }] },
      ]);
      expect(body.systemInstruction).toEqual({ parts: [{ text: 'Be terse.' }] });
    });

    it('maps temperature and maxTokens into generationConfig', async () => {
      const { provider, mock } = makeProvider({ kind: 'json', body: geminiBody() });
      await provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.3,
        maxTokens: 128,
      });
      const body = mock.requestBodies()[0]!;
      expect(body.generationConfig).toEqual({ temperature: 0.3, maxOutputTokens: 128 });
    });

    it('omits generationConfig when nothing is requested', async () => {
      const { provider, mock } = makeProvider({ kind: 'json', body: geminiBody() });
      await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(mock.requestBodies()[0]!.generationConfig).toBeUndefined();
    });

    it('translates structured-output requests into responseMimeType + responseSchema', async () => {
      const { provider, mock } = makeProvider({
        kind: 'json',
        body: geminiBody('{"ok":true}'),
      });
      await provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
        responseFormat: { type: 'json_schema', schema: SCHEMA },
      });
      const body = mock.requestBodies()[0]!;
      expect(body.generationConfig).toEqual({
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { ok: { type: 'BOOLEAN' } },
          required: ['ok'],
        },
      });
    });
  });

  describe('response normalization', () => {
    it('maps finish reasons', async () => {
      const cases: Array<[string | null | undefined, string]> = [
        ['STOP', 'stop'],
        ['MAX_TOKENS', 'length'],
        ['SAFETY', 'content_filter'],
        ['RECITATION', 'content_filter'],
        ['SOMETHING_ELSE', 'unknown'],
        [null, 'unknown'],
      ];
      for (const [raw, expected] of cases) {
        expect(mapGeminiFinishReason(raw)).toBe(expected);
      }
    });

    it('maps usage metadata and leaves absent counts undefined', async () => {
      expect(
        extractGeminiUsage({ promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 }),
      ).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3 });
      expect(extractGeminiUsage({ promptTokenCount: 4 })).toEqual({ inputTokens: 4 });
      expect(extractGeminiUsage(undefined)).toBeUndefined();
    });
  });

  describe('structured output', () => {
    it('validates a matching response', async () => {
      const { provider } = makeProvider({ kind: 'json', body: geminiBody('{"ok":true}') });
      const result = await provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
        responseFormat: { type: 'json_schema', schema: SCHEMA },
      });
      expect(result.content).toBe('{"ok":true}');
    });

    it('rejects a schema-mismatched structured response', async () => {
      const { provider } = makeProvider({ kind: 'json', body: geminiBody('{"ok":"nope"}') });
      await expect(
        provider.generate({
          messages: [{ role: 'user', content: 'hi' }],
          responseFormat: { type: 'json_schema', schema: SCHEMA },
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
    });
  });

  describe('errors', () => {
    it.each([
      [400, { error: { message: 'blah', status: 'INVALID_ARGUMENT' } }, 'INVALID_REQUEST', false],
      [401, { error: { message: 'no key', status: 'UNAUTHENTICATED' } }, 'AUTHENTICATION_ERROR', false],
      [403, { error: { message: 'nope', status: 'PERMISSION_DENIED' } }, 'AUTHENTICATION_ERROR', false],
      [404, { error: { message: 'missing model' } }, 'MODEL_NOT_FOUND', false],
      [429, { error: { message: 'quota', status: 'RESOURCE_EXHAUSTED' } }, 'RATE_LIMITED', true],
      [500, { error: { message: 'internal' } }, 'PROVIDER_ERROR', true],
    ])('HTTP %d → %s retryable=%s', async (status, body, code, retryable) => {
      const { provider } = makeProvider({
        kind: 'json',
        status,
        body,
      });
      await expect(provider.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject(
        { code, retryable, provider: 'gemini' },
      );
    });

    it('normalizes Gemini 400 auth-shaped errors to AUTHENTICATION_ERROR', async () => {
      expect(
        geminiClassifyHttpStatus(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }),
      ).toEqual({ code: 'AUTHENTICATION_ERROR', retryable: false });
      expect(
        geminiClassifyHttpStatus(400, { error: { message: 'bad request', status: 'INVALID_ARGUMENT' } }),
      ).toEqual({ code: 'INVALID_REQUEST', retryable: false });
    });

    it('rejects responses with no candidates', async () => {
      const { provider } = makeProvider({ kind: 'json', body: { candidates: [] } });
      await expect(
        provider.generate({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
    });

    it('rejects responses with no content parts', async () => {
      const { provider } = makeProvider({
        kind: 'json',
        body: { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] },
      });
      await expect(
        provider.generate({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
    });
  });

  describe('timeout and cancellation', () => {
    it('rejects TIMEOUT when the internal deadline fires', async () => {
      const { provider } = makeProvider({ kind: 'listen' }, { timeoutMs: 10 });
      await expect(provider.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
        code: 'TIMEOUT',
        retryable: true,
      });
    });

    it('rejects CANCELLED when the external signal aborts mid-flight', async () => {
      const mock = createMockFetch({ kind: 'listen' });
      const provider = new GeminiProvider({ model: 'gemini-2.5-flash' }, mock.fetchFn);
      const controller = new AbortController();
      const pending = provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 5);
      await expect(pending).rejects.toMatchObject({ code: 'CANCELLED', retryable: false });
    });

    it('rejects CANCELLED for an already-aborted signal without calling fetch', async () => {
      const { provider, mock } = makeProvider({ kind: 'json', body: geminiBody() });
      const controller = new AbortController();
      controller.abort();
      await expect(
        provider.generate({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal }),
      ).rejects.toMatchObject({ code: 'CANCELLED', retryable: false });
      expect(mock.calls).toHaveLength(0);
    });
  });

  describe('retry', () => {
    it('retries a rate limit and succeeds on recovery', async () => {
      const mock = createMockFetch();
      mock.enqueue({ kind: 'json', status: 429, body: { error: { message: 'slow' } } });
      mock.setDefault({ kind: 'json', body: geminiBody() });
      const provider = new GeminiProvider(
        { model: 'gemini-2.5-flash', retryPolicy: fastRetryPolicy(2) },
        mock.fetchFn,
      );
      const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.content).toBe('hello from gemini');
      expect(mock.calls).toHaveLength(2);
    });

    it('does not retry authentication failures', async () => {
      const { provider, mock } = makeProvider({
        kind: 'json',
        status: 401,
        body: { error: { message: 'no' } },
      });
      await expect(provider.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
        code: 'AUTHENTICATION_ERROR',
      });
      expect(mock.calls).toHaveLength(1);
    });
  });

  describe('toGeminiContents', () => {
    it('separates system instructions from the conversation', () => {
      const { contents, systemInstruction } = toGeminiContents([
        { role: 'system', content: 's1' },
        { role: 'system', content: 's2' },
        { role: 'user', content: 'u' },
      ]);
      expect(systemInstruction).toBe('s1\ns2');
      expect(contents).toEqual([{ role: 'user', parts: [{ text: 'u' }] }]);
    });

    it('returns empty contents and no system instruction for empty input', () => {
      expect(toGeminiContents([])).toEqual({ contents: [], systemInstruction: undefined, systemParts: [] });
    });
  });
});