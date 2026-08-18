import { describe, it, expect } from 'vitest';
import { createModelRouterFromConfig } from '../router.js';
import type { RoleModelsConfig } from '../types.js';

describe('createModelRouterFromConfig', () => {
  it('routes role models through the default provider config', () => {
    const roleModels: RoleModelsConfig = {
      reasoning: 'openai/gpt-oss-120b:free',
      coding: 'cohere/north-mini-code:free',
    };
    const router = createModelRouterFromConfig(
      {
        provider: 'openai-compatible',
        model: 'openai/gpt-oss-120b:free',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-test',
      },
      roleModels,
    );

    expect(router.list()).toEqual(['reasoning', 'coding', 'fast']);
    const reasoning = router.configFor('reasoning');
    expect(reasoning?.model).toBe('openai/gpt-oss-120b:free');
    expect(reasoning?.baseUrl).toBe('https://openrouter.ai/api/v1');
    const coding = router.configFor('coding');
    expect(coding?.model).toBe('cohere/north-mini-code:free');
    expect(coding?.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('falls back to default route when a role has no model id', () => {
    const router = createModelRouterFromConfig(
      { provider: 'fake' },
      { fast: 'openai/gpt-oss-20b:free' },
    );
    expect(router.select('reasoning').id).toBe('fake-provider');
    expect(router.select('coding').id).toBe('fake-provider');
    expect(router.select('fast').id).toBe('fake-provider');
  });

  it('does not allow fake fallback for real providers', () => {
    const router = createModelRouterFromConfig(
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      },
      { reasoning: 'claude-opus-4-20250514' },
    );
    expect(router.has('coding')).toBe(true); // inherits default config
    expect(router.resolve('coding').config.model).toBe('claude-sonnet-4-20250514');
  });

  it('redacts apiKey from displayed config', () => {
    const router = createModelRouterFromConfig(
      {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        apiKey: 'super-secret-key',
      },
      { reasoning: 'gemini-2.5-pro' },
    );
    const redacted = router.redactedConfigFor('reasoning');
    expect(redacted?.apiKey).toBe('***');
    expect(JSON.stringify(redacted)).not.toContain('super-secret-key');
  });

  it('routes gemini/anthropic role configs with kind preserved', () => {
    const router = createModelRouterFromConfig(
      { provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'k' },
      { coding: 'gemini-2.5-pro', fast: 'gemini-2.5-flash-lite' },
    );
    expect(router.resolve('coding').config.provider).toBe('gemini');
    expect(router.resolve('coding').config.model).toBe('gemini-2.5-pro');
    expect(router.resolve('fast').config.provider).toBe('gemini');
  });
});