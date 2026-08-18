import { describe, it, expect } from 'vitest';
import { FakeModelProvider } from '../testing/fake-provider.js';
import { ModelProviderError, isModelProviderError } from '../errors.js';
import type { ModelRequest, ModelResponse } from '../types.js';

describe('ModelProvider Contract', () => {
  describe('ModelRequest validation', () => {
    it('accepts a valid request with user message', async () => {
      const provider = new FakeModelProvider();
      const request: ModelRequest = {
        messages: [{ role: 'user', content: 'Explain authentication' }],
      };
      const response = await provider.generate(request);
      expect(response.content).toBeDefined();
    });

    it('accepts system, user, and assistant messages', async () => {
      const provider = new FakeModelProvider();
      const request: ModelRequest = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Explain auth' },
          { role: 'assistant', content: 'Auth is...' },
          { role: 'user', content: 'How does it work?' },
        ],
      };
      const response = await provider.generate(request);
      expect(response.content).toBeDefined();
    });

    it('rejects empty messages array', async () => {
      const provider = new FakeModelProvider();
      await expect(
        provider.generate({ messages: [] }),
      ).rejects.toThrow('Request must contain at least one message');
    });

    it('rejects empty message content', async () => {
      const provider = new FakeModelProvider();
      await expect(
        provider.generate({ messages: [{ role: 'user', content: '' }] }),
      ).rejects.toThrow('Message content must be a non-empty string');
    });
  });

  describe('FakeModelProvider', () => {
    it('returns configured response', async () => {
      const provider = new FakeModelProvider({
        response: {
          content: 'Authentication uses JWT.',
          model: 'test-model',
          finishReason: 'stop',
        },
      });

      const response = await provider.generate({
        messages: [{ role: 'user', content: 'Explain auth' }],
      });

      expect(response.content).toBe('Authentication uses JWT.');
      expect(response.model).toBe('test-model');
      expect(response.finishReason).toBe('stop');
    });

    it('returns default response when not configured', async () => {
      const provider = new FakeModelProvider();
      const response = await provider.generate({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content).toBe('Fake response');
      expect(response.model).toBe('fake-model');
      expect(response.finishReason).toBe('stop');
    });

    it('records request history', async () => {
      const provider = new FakeModelProvider();

      await provider.generate({
        messages: [{ role: 'user', content: 'First' }],
      });
      await provider.generate({
        messages: [{ role: 'user', content: 'Second' }],
      });

      const history = provider.getRequestHistory();
      expect(history).toHaveLength(2);
      expect(history[0]!.messages[0]!.content).toBe('First');
      expect(history[1]!.messages[0]!.content).toBe('Second');
    });

    it('clears request history', async () => {
      const provider = new FakeModelProvider();
      await provider.generate({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      provider.clearHistory();
      expect(provider.getRequestHistory()).toHaveLength(0);
    });

    it('has correct provider id', () => {
      const provider = new FakeModelProvider();
      expect(provider.id).toBe('fake-provider');
    });
  });

  describe('FakeModelProvider error simulation', () => {
    it('throws configured error', async () => {
      const provider = new FakeModelProvider({
        error: {
          message: 'Rate limited',
          code: 'RATE_LIMITED',
          retryable: true,
        },
      });

      await expect(
        provider.generate({ messages: [{ role: 'user', content: 'Hello' }] }),
      ).rejects.toThrow('Rate limited');
    });

    it('throws ModelProviderError with correct properties', async () => {
      const provider = new FakeModelProvider({
        error: {
          message: 'Auth failed',
          code: 'AUTHENTICATION_ERROR',
          retryable: false,
        },
      });

      try {
        await provider.generate({
          messages: [{ role: 'user', content: 'Hello' }],
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(isModelProviderError(error)).toBe(true);
        if (isModelProviderError(error)) {
          expect(error.provider).toBe('fake-provider');
          expect(error.code).toBe('AUTHENTICATION_ERROR');
          expect(error.retryable).toBe(false);
        }
      }
    });
  });

  describe('ModelProviderError', () => {
    it('creates error with all properties', () => {
      const error = new ModelProviderError('Test error', {
        provider: 'test-provider',
        code: 'TIMEOUT',
        retryable: true,
      });

      expect(error.message).toBe('Test error');
      expect(error.provider).toBe('test-provider');
      expect(error.code).toBe('TIMEOUT');
      expect(error.retryable).toBe(true);
      expect(error.name).toBe('ModelProviderError');
    });

    it('defaults retryable to false', () => {
      const error = new ModelProviderError('Test', {
        provider: 'test',
        code: 'PROVIDER_ERROR',
      });

      expect(error.retryable).toBe(false);
    });

    it('supports cause', () => {
      const cause = new Error('original');
      const error = new ModelProviderError('Wrapped', {
        provider: 'test',
        code: 'NETWORK_ERROR',
        cause,
      });

      expect(error.cause).toBe(cause);
    });
  });

  describe('isModelProviderError', () => {
    it('returns true for ModelProviderError', () => {
      const error = new ModelProviderError('Test', {
        provider: 'test',
        code: 'UNKNOWN',
      });
      expect(isModelProviderError(error)).toBe(true);
    });

    it('returns false for regular Error', () => {
      expect(isModelProviderError(new Error('test'))).toBe(false);
    });

    it('returns false for null', () => {
      expect(isModelProviderError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isModelProviderError(undefined)).toBe(false);
    });
  });

  describe('usage metadata', () => {
    it('returns usage in response', async () => {
      const provider = new FakeModelProvider({
        response: {
          content: 'Response',
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
          },
        },
      });

      const response = await provider.generate({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.usage).toBeDefined();
      expect(response.usage?.inputTokens).toBe(100);
      expect(response.usage?.outputTokens).toBe(50);
      expect(response.usage?.totalTokens).toBe(150);
    });
  });

  describe('finish reasons', () => {
    it.each([
      ['stop', 'stop'],
      ['length', 'length'],
      ['tool_call', 'tool_call'],
      ['content_filter', 'content_filter'],
      ['error', 'error'],
      ['unknown', 'unknown'],
    ])('supports finish reason: %s', async (reason) => {
      const provider = new FakeModelProvider({
        response: {
          content: 'Response',
          finishReason: reason as any,
        },
      });

      const response = await provider.generate({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.finishReason).toBe(reason);
    });
  });

  describe('determinism', () => {
    it('produces identical results for same input', async () => {
      const provider = new FakeModelProvider({
        response: { content: 'Deterministic response' },
      });

      const request: ModelRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      const results = await Promise.all(
        Array.from({ length: 5 }, () => provider.generate(request)),
      );

      const contents = results.map((r) => r.content);
      expect(new Set(contents).size).toBe(1);
    });
  });

  describe('concurrent requests', () => {
    it('returns correct individual results under concurrency', async () => {
      const provider = new FakeModelProvider();
      const requests: ModelRequest[] = [
        { messages: [{ role: 'user', content: 'A' }] },
        { messages: [{ role: 'user', content: 'B' }] },
        { messages: [{ role: 'user', content: 'C' }] },
      ];

      const results = await Promise.all(requests.map((r) => provider.generate(r)));
      expect(results).toHaveLength(3);
      results.forEach((r) => expect(r.content).toBe('Fake response'));
    });

    it('records every concurrent request in history', async () => {
      const provider = new FakeModelProvider();
      const contents = ['Alpha', 'Bravo', 'Charlie'];
      await Promise.all(
        contents.map((content) =>
          provider.generate({ messages: [{ role: 'user', content }] }),
        ),
      );

      const history = provider.getRequestHistory();
      expect(history).toHaveLength(3);
      const recorded = history.map((r) => r.messages[0]?.content);
      expect(new Set(recorded)).toEqual(new Set(contents));
    });
  });

  describe('extended request fields', () => {
    it('accepts optional timeoutMs, maxRetries, metadata and responseFormat', async () => {
      const provider = new FakeModelProvider({
        response: { content: 'ok', finishReason: 'stop' },
      });
      const response = await provider.generate({
        messages: [{ role: 'user', content: 'Hi' }],
        timeoutMs: 5000,
        maxRetries: 1,
        metadata: { attempt: 3 },
        responseFormat: { type: 'json_object' },
      });
      expect(response.content).toBe('ok');

      const history = provider.getRequestHistory();
      expect(history[0]?.timeoutMs).toBe(5000);
      expect(history[0]?.maxRetries).toBe(1);
      expect(history[0]?.metadata).toEqual({ attempt: 3 });
      expect(history[0]?.responseFormat).toEqual({ type: 'json_object' });
    });

    it('preserves a structured-output schema on the request', async () => {
      const provider = new FakeModelProvider();
      await provider.generate({
        messages: [{ role: 'user', content: 'Plan it' }],
        responseFormat: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { goal: { type: 'string' } },
            required: ['goal'],
          },
        },
      });
      const recorded = provider.getRequestHistory()[0];
      expect(recorded?.responseFormat?.type).toBe('json_schema');
      if (recorded?.responseFormat?.type === 'json_schema') {
        expect(recorded.responseFormat.schema.properties).toEqual({ goal: { type: 'string' } });
      }
    });
  });
});