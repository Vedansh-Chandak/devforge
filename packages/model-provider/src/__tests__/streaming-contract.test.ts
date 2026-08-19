import { describe, it, expect } from 'vitest';
import {
  isStreamingModelProvider,
  collectStream,
  streamedText,
} from '../streaming.js';
import type { ModelStreamEvent, StreamingModelProvider } from '../streaming.js';
import type { ModelProvider, ModelRequest, ModelResponse } from '../types.js';
import { ModelProviderError } from '../errors.js';
import { OpenAICompatibleProvider } from '../openai-compatible.js';
import { GeminiProvider } from '../gemini.js';
import { AnthropicProvider } from '../anthropic.js';
import { FakeModelProvider } from '../testing/fake-provider.js';
import { createModelRouter } from '../router.js';

/** A generate-only provider that is NOT streaming-capable. */
class GenerateOnlyProvider implements ModelProvider {
  readonly id = 'generate-only';
  async generate(_request: ModelRequest): Promise<ModelResponse> {
    return { content: 'ok', finishReason: 'stop' };
  }
}

describe('streaming contract (DF-026D)', () => {
  describe('capability detection', () => {
    it('detects every built-in streaming provider', () => {
      expect(isStreamingModelProvider(new FakeModelProvider())).toBe(true);
      expect(
        isStreamingModelProvider(
          new OpenAICompatibleProvider({ baseUrl: 'https://x', model: 'm' }),
        ),
      ).toBe(true);
      expect(
        isStreamingModelProvider(new GeminiProvider({ model: 'm' })),
      ).toBe(true);
      expect(
        isStreamingModelProvider(new AnthropicProvider({ model: 'm' })),
      ).toBe(true);
    });

    it('does not claim generate-only providers are streaming', () => {
      expect(isStreamingModelProvider(new GenerateOnlyProvider())).toBe(false);
    });

    it('rejects non-provider values', () => {
      expect(isStreamingModelProvider(null)).toBe(false);
      expect(isStreamingModelProvider(undefined)).toBe(false);
      expect(isStreamingModelProvider('provider')).toBe(false);
      expect(isStreamingModelProvider({ id: 'x' })).toBe(false);
    });
  });

  describe('backward compatibility', () => {
    it('keeps generate() working on a streaming provider', async () => {
      const provider = new FakeModelProvider();
      const response = await provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(response.content).toBe('Fake response');
    });

    it('leaves generate-only providers usable without stream()', async () => {
      const provider: ModelProvider = new GenerateOnlyProvider();
      const response = await provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(response.content).toBe('ok');
    });
  });

  describe('stream() contract', () => {
    it('rejects invalid requests with INVALID_REQUEST before any network', async () => {
      const provider = new FakeModelProvider();
      const stream = provider.stream({ messages: [] });
      await expect(collectStream(stream)).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
      });
    });

    it('is an async iterable that yields only normalized events', async () => {
      const provider: StreamingModelProvider = new FakeModelProvider({
        stream: {
          events: [
            { type: 'text_delta', text: 'Hi' },
            { type: 'tool_call', id: 't1', name: 'search', arguments: '{}' },
            { type: 'usage', inputTokens: 1, outputTokens: 2, totalTokens: 3 },
            { type: 'completed', finishReason: 'stop' },
          ],
        },
      });
      const events = await collectStream(
        provider.stream({ messages: [{ role: 'user', content: 'hi' }] }),
      );
      const types = events.map((event) => event.type);
      expect(types).toEqual(['text_delta', 'tool_call', 'usage', 'completed']);
    });

    it('supports the error event variant in the vocabulary', () => {
      const errorEvent: ModelStreamEvent = {
        type: 'error',
        error: new ModelProviderError('boom', {
          provider: 'x',
          code: 'PROVIDER_ERROR',
        }),
      };
      expect(errorEvent.type).toBe('error');
      expect(errorEvent.error.code).toBe('PROVIDER_ERROR');
    });
  });

  describe('helpers', () => {
    it('collectStream drains events and streamedText concatenates deltas', async () => {
      const provider = new FakeModelProvider({
        stream: {
          events: [
            { type: 'text_delta', text: 'a' },
            { type: 'text_delta', text: 'b' },
            { type: 'completed' },
          ],
        },
      });
      const events = await collectStream(
        provider.stream({ messages: [{ role: 'user', content: 'x' }] }),
      );
      expect(streamedText(events)).toBe('ab');
    });
  });

  describe('streaming capability through the role router (DF-027)', () => {
    it('preserves streaming capability on routed providers', () => {
      const router = createModelRouter({
        defaultConfig: { provider: 'fake' },
      });
      const coding = router.select('coding');
      // Routing must not strip the streaming capability: consumers detect it
      // structurally and stream from the very provider they were routed.
      expect(isStreamingModelProvider(coding)).toBe(true);
      const reasoning = router.select('reasoning');
      expect(isStreamingModelProvider(reasoning)).toBe(true);
    });

    it('falls back to generate() only when the routed provider is non-streaming', async () => {
      // A consumer pattern that streams when capable and otherwise uses
      // generate() — never impersonating a stream from a fake/other provider.
      const router = createModelRouter({
        defaultConfig: { provider: 'fake' },
      });
      const provider = router.select('reasoning');
      if (!isStreamingModelProvider(provider)) {
        const response = await provider.generate({
          messages: [{ role: 'user', content: 'hi' }],
        });
        expect(response.content.length).toBeGreaterThan(0);
        return;
      }
      const events = await collectStream(
        provider.stream({ messages: [{ role: 'user', content: 'hi' }] }),
      );
      expect(streamedText(events)).toBe('Fake response');
    });

    it('does not fabricate streaming from a generate-only routed provider', () => {
      const generateOnly: ModelProvider = new GenerateOnlyProvider();
      expect(isStreamingModelProvider(generateOnly)).toBe(false);
    });
  });
});
