import { describe, it, expect } from 'vitest';
import {
  createModelProvider,
  createModelProviderFromConfig,
} from '../factory.js';
import { OpenAICompatibleProvider } from '../openai-compatible.js';
import { GeminiProvider } from '../gemini.js';
import { AnthropicProvider } from '../anthropic.js';
import { FakeModelProvider } from '../testing/fake-provider.js';
import { ModelProviderError } from '../errors.js';
import { createMockFetch } from './helpers/mock-fetch.js';

describe('createModelProvider (normalized config form)', () => {
  it('selects the OpenAI-compatible adapter from a normalized config', () => {
    const provider = createModelProvider({
      provider: 'openai-compatible',
      model: 'openai/gpt-oss-120b:free',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
    });
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(provider.id).toBe('openai-compatible');
  });

  it('selects the Gemini adapter from a normalized config', () => {
    const provider = createModelProvider({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      apiKey: 'gk-test',
    });
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.id).toBe('gemini');
  });

  it('selects the Anthropic adapter from a normalized config', () => {
    const provider = createModelProvider({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'ak-test',
    });
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.id).toBe('anthropic');
  });

  it('selects the FakeModelProvider for the fake kind', () => {
    const provider = createModelProvider({ provider: 'fake' });
    expect(provider).toBeInstanceOf(FakeModelProvider);
  });

  it('rejects an unknown provider kind', () => {
    expect(() =>
      createModelProvider({ provider: 'ollama' as never, model: 'm' }),
    ).toThrow(ModelProviderError);
  });

  it('rejects a non-fake provider without a model', () => {
    expect(() =>
      createModelProvider({ provider: 'anthropic' as const }),
    ).toThrow(ModelProviderError);
  });

  it('rejects an openai-compatible config without a baseUrl', () => {
    expect(() =>
      createModelProvider({ provider: 'openai-compatible', model: 'm' }),
    ).toThrow(ModelProviderError);
  });

  it('works end-to-end with the OpenRouter-style config', async () => {
    const mock = createMockFetch({
      kind: 'json',
      body: {
        id: 'chatcmpl-1',
        model: 'openai/gpt-oss-20b:free',
        choices: [{ index: 0, message: { role: 'assistant', content: 'hello from openrouter' }, finish_reason: 'stop' }],
      },
    });
    const provider = createModelProvider(
      {
        provider: 'openai-compatible',
        model: 'openai/gpt-oss-20b:free',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or',
      },
      mock.fetchFn,
    );
    const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.content).toBe('hello from openrouter');
    expect(mock.last().url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('keeps the kind+config form working for existing callers', () => {
    const provider = createModelProvider(
      'openai-compatible',
      { baseUrl: 'https://x/v1', model: 'gpt-4o' },
    );
    expect(provider.id).toBe('openai-compatible');
  });
});

describe('createModelProviderFromConfig', () => {
  it('is a deterministic alias for the normalized factory path', () => {
    const config = {
      provider: 'fake' as const,
      model: 'fake-model',
    };
    const a = createModelProviderFromConfig(config);
    const b = createModelProvider(config);
    expect(a).toBeInstanceOf(FakeModelProvider);
    expect(b).toBeInstanceOf(FakeModelProvider);
    expect(createModelProviderFromConfig(config).id).toBe(b.id);
  });
});