import { describe, it, expect } from 'vitest';
import { createModelProvider, getProviderInfo, listProviderKinds } from '../factory.js';
import { OpenAICompatibleProvider } from '../openai-compatible.js';
import { GeminiProvider } from '../gemini.js';
import { AnthropicProvider } from '../anthropic.js';
import { createMockFetch } from './helpers/mock-fetch.js';

describe('createModelProvider', () => {
  it('constructs an OpenAI-compatible provider for the openai-compatible kind', () => {
    const mock = createMockFetch();
    const provider = createModelProvider(
      'openai-compatible',
      { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o' },
      mock.fetchFn,
    );
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(provider.id).toBe('openai-compatible');
  });

  it('constructs a Gemini provider for the gemini kind', () => {
    const mock = createMockFetch();
    const provider = createModelProvider('gemini', { model: 'gemini-2.5-flash' }, mock.fetchFn);
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.id).toBe('gemini');
  });

  it('constructs an Anthropic provider for the anthropic kind', () => {
    const mock = createMockFetch();
    const provider = createModelProvider(
      'anthropic',
      { model: 'claude-sonnet-4-20250514' },
      mock.fetchFn,
    );
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.id).toBe('anthropic');
  });

  it('supports OpenRouter through the openai-compatible transport with a baseUrl', async () => {
    const mock = createMockFetch({
      kind: 'json',
      body: {
        id: 'chatcmpl-1',
        model: 'openai/gpt-4o',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'routed' }, finish_reason: 'stop' },
        ],
      },
    });
    const provider = createModelProvider(
      'openai-compatible',
      {
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'openrouter-key',
        model: 'openai/gpt-4o',
      },
      mock.fetchFn,
    );
    const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.content).toBe('routed');
    expect(mock.last().url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(mock.requestHeaders().Authorization).toBe('Bearer openrouter-key');
  });
});

describe('registry metadata', () => {
  it('lists exactly the supported provider kinds', () => {
    expect(listProviderKinds()).toEqual(['openai-compatible', 'gemini', 'anthropic']);
  });

  it('reports provider info deterministically', () => {
    expect(getProviderInfo('gemini')).toMatchObject({ id: 'gemini', name: 'Gemini' });
    expect(getProviderInfo('openai-compatible').openAICompatible).toBe(true);
    expect(getProviderInfo('anthropic').openAICompatible).toBe(false);
  });
});