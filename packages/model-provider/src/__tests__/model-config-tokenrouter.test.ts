import { describe, it, expect } from 'vitest';
import { parseModelConfigEnv } from '../model-config.js';

/**
 * Regression tests: the generic OpenAI-compatible config parser must resolve
 * the API key from TOKENROUTER_API_KEY (a vendor-standard OpenAI-compatible
 * gateway variable) as a fallback — without any dedicated provider. DEVFORGE_*
 * keys always win when present.
 */

describe('model-config env parsing — TOKENROUTER_API_KEY (DF-032)', () => {
  it('resolves apiKey from TOKENROUTER_API_KEY when no DEVFORGE key is set', () => {
    const env = {
      DEVFORGE_MODEL_PROVIDER: 'openai-compatible',
      DEVFORGE_MODEL: 'qwen/qwen3.8-max-free',
      DEVFORGE_MODEL_BASE_URL: 'https://api.tokenrouter.com/v1',
      TOKENROUTER_API_KEY: 'tr-secret',
    };
    const parsed = parseModelConfigEnv(env);
    expect((parsed.default as { apiKey?: string }).apiKey).toBe('tr-secret');
    expect((parsed.default as { model?: string }).model).toBe('qwen/qwen3.8-max-free');
  });

  it('prefers DEVFORGE_MODEL_API_KEY over TOKENROUTER_API_KEY', () => {
    const env = {
      DEVFORGE_MODEL_API_KEY: 'devforge-secret',
      TOKENROUTER_API_KEY: 'tr-secret',
    };
    const parsed = parseModelConfigEnv(env);
    expect((parsed.default as { apiKey?: string }).apiKey).toBe('devforge-secret');
  });

  it('preserves a namespaced model id from env without stripping the namespace', () => {
    const env = {
      DEVFORGE_MODEL: 'qwen/qwen3.8-max-free',
    };
    const parsed = parseModelConfigEnv(env);
    expect((parsed.default as { model?: string }).model).toBe('qwen/qwen3.8-max-free');
  });
});
