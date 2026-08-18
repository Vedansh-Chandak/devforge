import { describe, it, expect } from 'vitest';
import {
  parseModelConfigEnv,
  mergeModelConfig,
  validateModelConfig,
  redactModelConfig,
  isModelProviderKind,
  isMissingModel,
  MODEL_PROVIDER_KINDS,
  MODEL_ROLES,
} from '../model-config.js';

describe('parseModelConfigEnv', () => {
  it('parses the default model environment', () => {
    const parsed = parseModelConfigEnv({
      DEVFORGE_MODEL_PROVIDER: 'openai-compatible',
      DEVFORGE_MODEL: 'openai/gpt-oss-120b:free',
      DEVFORGE_MODEL_BASE_URL: 'https://openrouter.ai/api/v1',
      DEVFORGE_MODEL_API_KEY: 'sk-secret',
      DEVFORGE_MODEL_TIMEOUT_MS: '45000',
      DEVFORGE_MODEL_MAX_RETRIES: '3',
    });
    expect(parsed.default).toEqual({
      provider: 'openai-compatible',
      model: 'openai/gpt-oss-120b:free',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-secret',
      timeoutMs: 45000,
      maxRetries: 3,
    });
    expect(parsed.roles).toEqual({});
  });

  it('parses role-specific model ids', () => {
    const parsed = parseModelConfigEnv({
      DEVFORGE_REASONING_MODEL: 'openai/gpt-oss-120b:free',
      DEVFORGE_CODING_MODEL: 'cohere/north-mini-code:free',
      DEVFORGE_FAST_MODEL: 'openai/gpt-oss-20b:free',
    });
    expect(parsed.roles).toEqual({
      reasoning: { model: 'openai/gpt-oss-120b:free' },
      coding: { model: 'cohere/north-mini-code:free' },
      fast: { model: 'openai/gpt-oss-20b:free' },
    });
    expect(parsed.default).toEqual({});
  });

  it('is empty for an empty env', () => {
    const parsed = parseModelConfigEnv({});
    expect(parsed.default).toEqual({});
    expect(parsed.roles).toEqual({});
  });

  it('skips unknown providers and malformed numbers without throwing', () => {
    const parsed = parseModelConfigEnv({
      DEVFORGE_MODEL_PROVIDER: 'not-a-provider',
      DEVFORGE_MODEL_TIMEOUT_MS: 'abc',
      DEVFORGE_MODEL_MAX_RETRIES: 'nope',
    });
    expect(parsed.default).toEqual({});
  });

  it('does not accept an empty role model id', () => {
    const parsed = parseModelConfigEnv({ DEVFORGE_FAST_MODEL: '' });
    expect(parsed.roles.fast).toBeUndefined();
  });
});

describe('mergeModelConfig', () => {
  it('merges role config over the default deterministically', () => {
    const merged = mergeModelConfig(
      {
        provider: 'openai-compatible',
        model: 'default-model',
        baseUrl: 'https://x/v1',
        apiKey: 'sk-x',
      },
      { model: 'role-model' },
    );
    expect(merged).toEqual({
      provider: 'openai-compatible',
      model: 'role-model',
      baseUrl: 'https://x/v1',
      apiKey: 'sk-x',
    });
  });

  it('returns the base unchanged when there is no override', () => {
    const base = { provider: 'fake' as const };
    expect(mergeModelConfig(base)).toEqual(base);
  });
});

describe('validateModelConfig', () => {
  it('accepts a complete openai-compatible config', () => {
    const result = validateModelConfig({
      provider: 'openai-compatible',
      model: 'gpt-4o',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-x',
      timeoutMs: 5000,
      maxRetries: 2,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a fake config without a model', () => {
    expect(validateModelConfig({ provider: 'fake' }).ok).toBe(true);
  });

  it('rejects a missing provider', () => {
    const result = validateModelConfig({ model: 'gpt-4o' });
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown provider', () => {
    const result = validateModelConfig({ provider: 'claude' as never });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-fake provider without a model', () => {
    const result = validateModelConfig({ provider: 'anthropic' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path === 'model')).toBe(true);
    }
  });

  it('rejects an invalid baseUrl', () => {
    const result = validateModelConfig({
      provider: 'openai-compatible',
      model: 'm',
      baseUrl: 'not-a-url',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path === 'baseUrl')).toBe(true);
    }
  });

  it('rejects negative timeoutMs and non-integer maxRetries', () => {
    const result = validateModelConfig({
      provider: 'openai-compatible',
      model: 'm',
      baseUrl: 'https://x/v1',
      timeoutMs: -1,
      maxRetries: 1.5,
    });
    expect(result.ok).toBe(false);
  });
});

describe('redactModelConfig', () => {
  it('masks the apiKey but leaves other fields intact', () => {
    const redacted = redactModelConfig({
      provider: 'openai-compatible',
      model: 'gpt-4o',
      baseUrl: 'https://x/v1',
      apiKey: 'sk-secret-value',
      timeoutMs: 5000,
    });
    expect(redacted.apiKey).toBe('***');
    expect(redacted.model).toBe('gpt-4o');
    expect(redacted.baseUrl).toBe('https://x/v1');
    expect(redacted.timeoutMs).toBe(5000);
  });

  it('leaves an absent apiKey untouched', () => {
    const redacted = redactModelConfig({ provider: 'fake' });
    expect(redacted).toEqual({ provider: 'fake' });
  });
});

describe('model-config constants', () => {
  it('declares the supported provider kinds in order', () => {
    expect(MODEL_PROVIDER_KINDS).toEqual([
      'openai-compatible',
      'gemini',
      'anthropic',
      'fake',
    ]);
  });

  it('declares the supported roles in order', () => {
    expect(MODEL_ROLES).toEqual(['reasoning', 'coding', 'fast']);
  });

  it('isModelProviderKind guards values', () => {
    expect(isModelProviderKind('gemini')).toBe(true);
    expect(isModelProviderKind('fake')).toBe(true);
    expect(isModelProviderKind('ollama')).toBe(false);
  });

  it('isMissingModel is false only for fake without a model', () => {
    expect(isMissingModel({ provider: 'fake' })).toBe(false);
    expect(isMissingModel({ provider: 'gemini' })).toBe(true);
    expect(isMissingModel({ provider: 'gemini', model: 'x' })).toBe(false);
  });
});