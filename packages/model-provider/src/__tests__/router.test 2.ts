import { describe, it, expect } from 'vitest';
import { ModelRouter, ModelRouterError, createModelRouter, resolveRoleConfig } from '../router.js';
import { createModelProviderFromConfig } from '../factory.js';
import { OpenAICompatibleProvider } from '../openai-compatible.js';
import { GeminiProvider } from '../gemini.js';
import { AnthropicProvider } from '../anthropic.js';
import { FakeModelProvider } from '../testing/fake-provider.js';
import { ModelProviderError } from '../errors.js';
import { createMockFetch } from './helpers/mock-fetch.js';

const OPENROUTER = {
  provider: 'openai-compatible' as const,
  model: 'openai/gpt-oss-120b:free',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-or-test',
};

const DEFAULT_ROUTER = new ModelRouter({
  defaultConfig: OPENROUTER,
  roleConfigs: {
    coding: { model: 'cohere/north-mini-code:free' },
    fast: { model: 'openai/gpt-oss-20b:free' },
  },
});

describe('ModelRouter.select', () => {
  it('resolves the reasoning role from the default config', () => {
    const provider = DEFAULT_ROUTER.select('reasoning');
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(provider.id).toBe('openai-compatible');
  });

  it('resolves coding and fast from explicit role configuration', () => {
    const coding = DEFAULT_ROUTER.select('coding');
    const fast = DEFAULT_ROUTER.select('fast');
    expect(coding).toBeInstanceOf(OpenAICompatibleProvider);
    expect(fast).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it('constructs gemini and anthropic providers from normalized config', () => {
    const geminiRouter = new ModelRouter({
      defaultConfig: { provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'gk-test' },
    });
    const anthropicRouter = new ModelRouter({
      defaultConfig: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: 'ak-test' },
    });
    expect(geminiRouter.select('reasoning')).toBeInstanceOf(GeminiProvider);
    expect(anthropicRouter.select('reasoning')).toBeInstanceOf(AnthropicProvider);
  });

  it('returns a FakeModelProvider for fake configuration', () => {
    const router = new ModelRouter({ defaultConfig: { provider: 'fake' } });
    expect(router.select('reasoning')).toBeInstanceOf(FakeModelProvider);
  });

  it('returns the SAME provider instance for the same role', () => {
    expect(DEFAULT_ROUTER.select('coding')).toBe(DEFAULT_ROUTER.select('coding'));
  });

  it('throws ModelRouterError when no configuration and no fake fallback', () => {
    const router = new ModelRouter({});
    expect(() => router.select('reasoning')).toThrow(ModelRouterError);
    expect(() => router.select('reasoning')).toThrow(/No model configured/);
  });

  it('fallback to FakeModelProvider only when allowFakeFallback is set', () => {
    const router = new ModelRouter({ allowFakeFallback: true });
    expect(router.select('reasoning')).toBeInstanceOf(FakeModelProvider);
    expect(router.select('coding')).toBeInstanceOf(FakeModelProvider);
    expect(router.select('fast')).toBeInstanceOf(FakeModelProvider);
  });

  it('rejects invalid provider configuration with INVALID_PROVIDER_CONFIG', () => {
    const router = new ModelRouter({
      defaultConfig: { provider: 'openai-compatible', model: 'm' },
    });
    try {
      router.select('reasoning');
      expect.fail('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRouterError);
      expect((error as ModelRouterError).code).toBe('INVALID_PROVIDER_CONFIG');
    }
  });

  it('rejects an unknown provider kind', () => {
    const router = new ModelRouter({
      defaultConfig: { provider: 'ollama' as never, model: 'm' },
    });
    expect(() => router.select('reasoning')).toThrow(ModelRouterError);
  });
});

describe('ModelRouter.resolve + configFor', () => {
  it('tracks the source as explicit when a role override exists', () => {
    const resolved = DEFAULT_ROUTER.resolve('coding');
    expect(resolved.source).toBe('explicit');
    expect(resolved.config.model).toBe('cohere/north-mini-code:free');
    expect(resolved.config.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('tracks the source as default when only the default applies', () => {
    const resolved = DEFAULT_ROUTER.resolve('reasoning');
    expect(resolved.source).toBe('default');
    expect(resolved.config.model).toBe('openai/gpt-oss-120b:free');
  });

  it('tracks source fake for fake fallback routes', () => {
    const router = new ModelRouter({ allowFakeFallback: true });
    expect(router.resolve('fast').source).toBe('fake');
  });

  it('configFor returns undefined for unconfigured roles', () => {
    const router = new ModelRouter({});
    expect(router.configFor('reasoning')).toBeUndefined();
  });

  it('redactedConfigFor masks the apiKey', () => {
    const redacted = DEFAULT_ROUTER.redactedConfigFor('reasoning');
    expect(redacted?.apiKey).toBe('***');
  });
});

describe('ModelRouter.has/list', () => {
  it('has reports configured roles', () => {
    expect(DEFAULT_ROUTER.has('reasoning')).toBe(true);
    expect(DEFAULT_ROUTER.has('coding')).toBe(true);
    expect(DEFAULT_ROUTER.has('fast')).toBe(true);
  });

  it('an empty router resolves nothing', () => {
    const router = new ModelRouter({});
    expect(router.has('reasoning')).toBe(false);
    expect(router.list()).toEqual([]);
  });

  it('list returns roles in stable declaration order', () => {
    expect(DEFAULT_ROUTER.list()).toEqual(['reasoning', 'coding', 'fast']);
  });
});

describe('forwarding injected fetch to real providers', () => {
  it('routes through the normalized factory with mocked http', async () => {
    const mock = createMockFetch({
      kind: 'json',
      body: {
        id: 'chatcmpl-1',
        model: 'openai/gpt-oss-120b:free',
        choices: [{ index: 0, message: { role: 'assistant', content: 'routed answer' }, finish_reason: 'stop' }],
      },
    });
    const router = new ModelRouter({ defaultConfig: OPENROUTER, fetchFn: mock.fetchFn });
    const result = await router.select('reasoning').generate({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.content).toBe('routed answer');
    expect(mock.last().url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('keeps runtime failures as real failures', async () => {
    const mock = createMockFetch({ kind: 'json', status: 401, body: { error: { message: 'bad key' } } });
    const router = new ModelRouter({ defaultConfig: OPENROUTER, fetchFn: mock.fetchFn });
    await expect(
      router.select('reasoning').generate({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_ERROR' });
  });

  it('redacts api keys from routed failures', async () => {
    const mock = createMockFetch({
      kind: 'json',
      status: 401,
      body: { error: { message: 'failed with sk-or-test echoed' } },
    });
    const router = new ModelRouter({ defaultConfig: OPENROUTER, fetchFn: mock.fetchFn });
    try {
      await router.select('reasoning').generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect.fail('should throw');
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      expect(text).not.toContain('sk-or-test');
      expect(text).not.toContain('bad key');
      expect((error as ModelProviderError).code).toBe('AUTHENTICATION_ERROR');
    }
  });

  it('never falls back to fake after a real provider failure', async () => {
    const mock = createMockFetch({ kind: 'json', status: 500, body: { error: { message: 'boom' } } });
    const router = new ModelRouter({ defaultConfig: OPENROUTER, fetchFn: mock.fetchFn });
    await expect(
      router.select('reasoning').generate({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(ModelProviderError);
  });
});

describe('resolveRoleConfig', () => {
  it('merges role override over the default', () => {
    const merged = resolveRoleConfig(
      { defaultConfig: OPENROUTER, roleConfigs: { fast: { model: 'fast-model' } } },
      'fast',
    );
    expect(merged).toEqual({ ...OPENROUTER, model: 'fast-model' });
  });

  it('returns undefined when nothing is configured', () => {
    expect(resolveRoleConfig({}, 'reasoning')).toBeUndefined();
  });

  it('is deterministic across calls', () => {
    const a = resolveRoleConfig({ defaultConfig: { provider: 'fake' as const } }, 'coding');
    const b = resolveRoleConfig({ defaultConfig: { provider: 'fake' as const } }, 'coding');
    expect(a).toEqual(b);
  });
});

describe('createModelRouter + factory round trip', () => {
  it('createModelRouter matches new ModelRouter', () => {
    expect(createModelRouter({ allowFakeFallback: true })).toBeInstanceOf(ModelRouter);
  });

  it('factory constructs the same adapter the router selects', () => {
    const viaFactory = createModelProviderFromConfig(OPENROUTER);
    expect(viaFactory).toBeInstanceOf(OpenAICompatibleProvider);
  });
});