import { describe, it, expect } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible.js';
import { GeminiProvider } from '../gemini.js';
import { AnthropicProvider } from '../anthropic.js';
import { FakeModelProvider } from '../testing/fake-provider.js';
import type { ModelProvider, ModelRequest, ModelResponse } from '../types.js';
import { ModelProviderError } from '../errors.js';
import { createMockFetch } from './helpers/mock-fetch.js';

const REQUEST: ModelRequest = {
  messages: [
    { role: 'system', content: 'Be terse.' },
    { role: 'user', content: 'Explain cancellation.' },
  ],
  temperature: 0.2,
  maxTokens: 64,
};

function makeAllProviders() {
  const openAi = createMockFetch({
    kind: 'json',
    body: {
      id: 'chatcmpl-1',
      model: 'gpt-4o',
      choices: [
        { index: 0, message: { role: 'assistant', content: 'openai answer' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  });
  const gemini = createMockFetch({
    kind: 'json',
    body: {
      candidates: [{ content: { parts: [{ text: 'gemini answer' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    },
  });
  const anthropic = createMockFetch({
    kind: 'json',
    body: {
      id: 'msg_1',
      content: [{ type: 'text', text: 'anthropic answer' }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  });

  return {
    openai: new OpenAICompatibleProvider({ baseUrl: 'https://x/v1', model: 'gpt-4o', apiKey: 'sk-x' }, openAi.fetchFn),
    gemini: new GeminiProvider({ model: 'gemini-2.5-flash', apiKey: 'gk-x' }, gemini.fetchFn),
    anthropic: new AnthropicProvider({ model: 'claude-sonnet-4-20250514', apiKey: 'ak-x' }, anthropic.fetchFn),
  };
}

describe('cross-provider', () => {
  describe('identical normalized request → provider-specific requests', () => {
    it('translates one normalized request into each vendor body shape', async () => {
      const openAi = createMockFetch({
        kind: 'json',
        body: { id: '1', model: 'gpt-4o', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] },
      });
      const gemini = createMockFetch({
        kind: 'json',
        body: { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] },
      });
      const anthropic = createMockFetch({
        kind: 'json',
        body: { id: 'm1', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } },
      });

      const openai = new OpenAICompatibleProvider({ baseUrl: 'https://x/v1', model: 'gpt-4o' }, openAi.fetchFn);
      const gem = new GeminiProvider({ model: 'gemini-2.5-flash' }, gemini.fetchFn);
      const anth = new AnthropicProvider({ model: 'claude-sonnet-4-20250514' }, anthropic.fetchFn);

      const sharedRequest: ModelRequest = {
        messages: [
          { role: 'system', content: 'Be terse.' },
          { role: 'user', content: 'Explain cancellation.' },
        ],
        temperature: 0.2,
        maxTokens: 64,
      };

      await openai.generate(sharedRequest);
      await gem.generate(sharedRequest);
      await anth.generate(sharedRequest);

      const openAiBody = openAi.requestBodies()[0]!;
      expect(openAiBody).toMatchObject({
        model: 'gpt-4o',
        messages: sharedRequest.messages,
        temperature: 0.2,
        max_tokens: 64,
      });

      const geminiBody = gemini.requestBodies()[0]!;
      expect(geminiBody.contents).toEqual([
        { role: 'user', parts: [{ text: 'Explain cancellation.' }] },
      ]);
      expect(geminiBody.systemInstruction).toEqual({ parts: [{ text: 'Be terse.' }] });
      expect(geminiBody.generationConfig).toEqual({ temperature: 0.2, maxOutputTokens: 64 });

      const anthropicBody = anthropic.requestBodies()[0]!;
      expect(anthropicBody).toMatchObject({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Explain cancellation.' }],
        system: 'Be terse.',
        temperature: 0.2,
        max_tokens: 64,
      });
    });

    it('constructs each adapter from the normalized config kinds', () => {
      const { openai, gemini, anthropic } = makeAllProviders();
      expect(openai).toBeInstanceOf(OpenAICompatibleProvider);
      expect(gemini).toBeInstanceOf(GeminiProvider);
      expect(anthropic).toBeInstanceOf(AnthropicProvider);
    });
  });

  describe('normalized responses', () => {
    it('all providers return the normalized ModelResponse shape', async () => {
      const { openai, gemini, anthropic } = makeAllProviders();
      const responses = await Promise.all([
        openai.generate(REQUEST),
        gemini.generate(REQUEST),
        anthropic.generate(REQUEST),
      ]);
      for (const response of responses) {
        expect(typeof response.content).toBe('string');
        expect(['stop', 'unknown', 'length', 'content_filter', 'tool_call', 'error']).toContain(
          response.finishReason,
        );
        expect(typeof response.provider).toBe('string');
        expect(response.usage).toBeDefined();
        expect(response.usage!.inputTokens).toBe(1);
        expect(response.usage!.outputTokens).toBe(1);
      }
      expect(responses.map((r) => r.provider)).toEqual([
        'openai-compatible',
        'gemini',
        'anthropic',
      ]);
    });
  });

  describe('normalized errors', () => {
    it('maps the same failure to the same normalized error across providers', async () => {
      const cases: Array<[number, string, boolean]> = [
        [401, 'AUTHENTICATION_ERROR', false],
        [429, 'RATE_LIMITED', true],
        [500, 'PROVIDER_ERROR', true],
      ];
      for (const [status, code, retryable] of cases) {
        const body = { error: { message: `status ${status}` } };
        const openAi = createMockFetch({ kind: 'json', status, body });
        const gemini = createMockFetch({ kind: 'json', status, body });
        const anthropic = createMockFetch({ kind: 'json', status, body });
        const providers = [
          new OpenAICompatibleProvider({ baseUrl: 'https://x/v1', model: 'm' }, openAi.fetchFn),
          new GeminiProvider({ model: 'm' }, gemini.fetchFn),
          new AnthropicProvider({ model: 'm' }, anthropic.fetchFn),
        ];
        for (const provider of providers) {
          await expect(provider.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
            code,
            retryable,
          });
        }
      }
    });
  });

  describe('secret redaction', () => {
    it('never leaks a provider key into thrown errors, even when echoed', async () => {
      const cases: Array<{
        key: string;
        make: (key: string) => ModelProvider;
      }> = [
        {
          key: 'sk-openai-secret',
          make: (key) =>
            new OpenAICompatibleProvider(
              { baseUrl: 'https://x/v1', model: 'm', apiKey: key },
              createMockFetch({
                kind: 'json',
                status: 401,
                body: { error: { message: 'failed with sk-openai-secret echoed back' } },
              }).fetchFn,
            ),
        },
        {
          key: 'gk-gemini-secret',
          make: (key) =>
            new GeminiProvider(
              { model: 'm', apiKey: key },
              createMockFetch({
                kind: 'json',
                status: 401,
                body: { error: { message: 'failed with gk-gemini-secret echoed back' } },
              }).fetchFn,
            ),
        },
        {
          key: 'ak-anthropic-secret',
          make: (key) =>
            new AnthropicProvider(
              { model: 'm', apiKey: key },
              createMockFetch({
                kind: 'json',
                status: 401,
                body: { error: { message: 'failed with ak-anthropic-secret echoed back' } },
              }).fetchFn,
            ),
        },
      ];

      for (const { key, make } of cases) {
        try {
          await make(key).generate({ messages: [{ role: 'user', content: 'hi' }] });
          expect.fail('should throw');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const serialized = JSON.stringify(error);
          expect(message).not.toContain(key);
          expect(serialized).not.toContain(key);
        }
      }
    });
  });

  describe('deterministic behavior', () => {
    it('produces identical output for identical input', async () => {
      const { openai } = makeAllProviders();
      const a = await openai.generate({ messages: [{ role: 'user', content: 'same' }] });
      const b = await openai.generate({ messages: [{ role: 'user', content: 'same' }] });
      expect(a).toEqual(b);
    });
  });

  describe('concurrent calls', () => {
    it('runs all three providers concurrently without interference', async () => {
      const { openai, gemini, anthropic } = makeAllProviders();
      const responses = await Promise.all([
        openai.generate({ messages: [{ role: 'user', content: '1' }] }),
        gemini.generate({ messages: [{ role: 'user', content: '2' }] }),
        anthropic.generate({ messages: [{ role: 'user', content: '3' }] }),
      ]);
      expect(responses.map((r) => r.content)).toEqual([
        'openai answer',
        'gemini answer',
        'anthropic answer',
      ]);
    });
  });

  describe('fake provider compatibility', () => {
    it('FakeModelProvider remains interchangeable via the ModelProvider contract', async () => {
      const fake = new FakeModelProvider({
        response: { content: 'fake answer', model: 'fake-model' },
      });
      const providers: ModelProvider[] = [
        fake,
        ...Object.values(makeAllProviders()),
      ];
      const responses = await Promise.all(
        providers.map((provider) => provider.generate({ messages: [{ role: 'user', content: 'hi' }] })),
      );
      expect(responses[0]).toBeDefined();
      expect(responses[0]!.content).toBe('fake answer');
      expect(responses).toHaveLength(4);
    });

    it('fake provider errors are ModelProviderErrors like real adapters', async () => {
      const fake = new FakeModelProvider({
        error: { message: 'boom', code: 'RATE_LIMITED', retryable: true },
      });
      await expect(fake.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toBeInstanceOf(
        ModelProviderError,
      );
    });
  });
});