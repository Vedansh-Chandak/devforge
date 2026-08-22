import { describe, it, expect } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible.js';
import { GeminiProvider } from '../gemini.js';
import { AnthropicProvider } from '../anthropic.js';
import { retry, DEFAULT_RETRYABLE_CODES } from '../retry.js';
import type { RetryOptions } from '../retry.js';
import { redactSecrets } from '../redact.js';
import { createMockFetch } from './helpers/mock-fetch.js';

const OPENAI_KEY = 'sk-openai-secret-abc123';
const GEMINI_KEY = 'geminiapikey-secret-abc123';
const ANTHROPIC_KEY = 'anthropic-secret-abc123';

describe('security', () => {
  describe('API keys never appear in thrown errors', () => {
    it('across all providers, including when the provider echoes the key', async () => {
      const keyedBodies = [
        {
          provider: () =>
            new OpenAICompatibleProvider(
              { baseUrl: 'https://x/v1', model: 'm', apiKey: OPENAI_KEY },
              createMockFetch({
                kind: 'json',
                status: 401,
                body: { error: { message: `invalid api key ${OPENAI_KEY}` } },
              }).fetchFn,
            ),
          keys: [OPENAI_KEY],
        },
        {
          provider: () =>
            new GeminiProvider(
              { model: 'm', apiKey: GEMINI_KEY },
              createMockFetch({
                kind: 'json',
                status: 400,
                body: { error: { message: `bad API key ${GEMINI_KEY}` } },
              }).fetchFn,
            ),
          keys: [GEMINI_KEY],
        },
        {
          provider: () =>
            new AnthropicProvider(
              { model: 'm', apiKey: ANTHROPIC_KEY },
              createMockFetch({
                kind: 'json',
                status: 401,
                body: { error: { message: `auth failed ${ANTHROPIC_KEY}` } },
              }).fetchFn,
            ),
          keys: [ANTHROPIC_KEY],
        },
      ];

      for (const { provider, keys } of keyedBodies) {
        const instance = provider();
        try {
          await instance.generate({ messages: [{ role: 'user', content: 'hi' }] });
          expect.fail('expected a provider failure');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          for (const key of keys) {
            expect(message).not.toContain(key);
          }
        }
      }
    });
  });

  describe('API keys never appear in serialized errors', () => {
    it('JSON.stringify of every provider error excludes all keys', async () => {
      const cases: Array<{ make: () => { generate: () => Promise<unknown> }; keys: string[] }> = [
        {
          make: () => ({
            generate: () =>
              new OpenAICompatibleProvider(
                { baseUrl: 'https://x/v1', model: 'm', apiKey: OPENAI_KEY },
                createMockFetch({
                  kind: 'throw',
                  error: new Error(`network failed ${OPENAI_KEY}`),
                }).fetchFn,
              ).generate({ messages: [{ role: 'user', content: 'hi' }] }),
          }),
          keys: [OPENAI_KEY],
        },
        {
          make: () => ({
            generate: () =>
              new GeminiProvider(
                { model: 'm', apiKey: GEMINI_KEY },
                createMockFetch({
                  kind: 'throw',
                  error: new Error(`connect failed ${GEMINI_KEY}`),
                }).fetchFn,
              ).generate({ messages: [{ role: 'user', content: 'hi' }] }),
          }),
          keys: [GEMINI_KEY],
        },
        {
          make: () => ({
            generate: () =>
              new AnthropicProvider(
                { model: 'm', apiKey: ANTHROPIC_KEY },
                createMockFetch({
                  kind: 'throw',
                  error: new Error(`socket error ${ANTHROPIC_KEY}`),
                }).fetchFn,
              ).generate({ messages: [{ role: 'user', content: 'hi' }] }),
          }),
          keys: [ANTHROPIC_KEY],
        },
      ];

      for (const { make, keys } of cases) {
        try {
          await make().generate();
          expect.fail('expected failure');
        } catch (error) {
          const serialized = JSON.stringify(error);
          for (const key of keys) {
            expect(serialized).not.toContain(key);
            expect(serialized).not.toContain('authorization');
            expect(serialized).not.toContain('x-api-key');
          }
        }
      }
    });
  });

  describe('API keys never appear in retry metadata', () => {
    it('onRetry callbacks only observe redacted errors', async () => {
      const seen: unknown[] = [];
      const options: RetryOptions = {
        operation: 'test',
        provider: 'test',
        policy: { maxRetries: 1, backoffMs: 1, backoffMultiplier: 1, maxBackoffMs: 2, jitter: 0 },
        onRetry: (info) => seen.push(info),
      };

      await retry(
        () => {
          throw new Error(`attempt failed with ${OPENAI_KEY}`);
        },
        options,
      ).catch(() => {
        // expected
      });

      const serialized = JSON.stringify(seen);
      expect(serialized).not.toContain(OPENAI_KEY);
    });
  });

  describe('API keys never appear in logs / diagnostics', () => {
    it('redactSecrets removes keys from arbitrary diagnostic text', () => {
      const diagnostic = `request failed with key ${ANTHROPIC_KEY} and bearer ${GEMINI_KEY}`;
      const redacted = redactSecrets(diagnostic, [ANTHROPIC_KEY, GEMINI_KEY]);
      expect(redacted).not.toContain(ANTHROPIC_KEY);
      expect(redacted).not.toContain(GEMINI_KEY);
      expect(redacted).toContain('[REDACTED]');
    });

    it('redactSecrets is deterministic', () => {
      const diagnostic = `key ${OPENAI_KEY} present`;
      expect(redactSecrets(diagnostic, [OPENAI_KEY])).toBe(redactSecrets(diagnostic, [OPENAI_KEY]));
    });
  });

  describe('Authorization headers are not exposed through public responses', () => {
    it('ModelResponse carries no headers or credentials', async () => {
      const mock = createMockFetch({
        kind: 'json',
        body: {
          id: 'chatcmpl-1',
          model: 'm',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        },
      });
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://x/v1', model: 'm', apiKey: OPENAI_KEY },
        mock.fetchFn,
      );
      const response = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      const serialized = JSON.stringify(response);
      expect(serialized).not.toContain(OPENAI_KEY);
      expect(serialized).not.toContain('Authorization');
      expect(serialized).not.toContain('headers');
      expect(serialized).toContain('openai-compatible');
    });
  });

  describe('provider responses cannot inject secrets into error messages', () => {
    it('a hostile provider body that echoes the key is redacted', async () => {
      const mock = createMockFetch({
        kind: 'json',
        status: 500,
        body: { error: { message: `internal: leaked ${OPENAI_KEY}` } },
      });
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://x/v1', model: 'm', apiKey: OPENAI_KEY },
        mock.fetchFn,
      );
      try {
        await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
        expect.fail('expected a provider failure');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(OPENAI_KEY);
        expect(message).toContain('[REDACTED]');
      }
    });
  });

  describe('retry classification remains centralized', () => {
    it('CANCELLED is never in the default retryable set', () => {
      expect(DEFAULT_RETRYABLE_CODES).not.toContain('CANCELLED');
      expect(DEFAULT_RETRYABLE_CODES).toEqual(
        expect.arrayContaining(['RATE_LIMITED', 'TIMEOUT', 'NETWORK_ERROR', 'PROVIDER_ERROR']),
      );
    });
  });
});