import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  validateProviderConfig,
  parseEnvConfig,
  mergeConfig,
  createModelProvider,
  createDevForge,
  DevForgeConfigError,
} from '../index.js';
import type { DevForgeConfig } from '../types.js';

const VALID_FAKE_CONFIG: DevForgeConfig = {
  repository: { root: '/tmp/test-repo' },
  model: { provider: 'fake' },
};

const VALID_OPENAI_CONFIG: DevForgeConfig = {
  repository: { root: '/tmp/test-repo' },
  model: {
    provider: 'openai-compatible',
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test-key',
  },
};

describe('validateConfig', () => {
  it('accepts valid fake config', () => {
    const result = validateConfig(VALID_FAKE_CONFIG);
    expect(result.model.provider).toBe('fake');
    expect(result.repository.root).toBe('/tmp/test-repo');
  });

  it('accepts valid openai-compatible config', () => {
    const result = validateConfig(VALID_OPENAI_CONFIG);
    expect(result.model.provider).toBe('openai-compatible');
  });

  it('rejects empty repository root', () => {
    expect(() =>
      validateConfig({ repository: { root: '' }, model: { provider: 'fake' } }),
    ).toThrow(DevForgeConfigError);
  });

  it('rejects unknown provider', () => {
    expect(() =>
      validateConfig({ repository: { root: '/tmp' }, model: { provider: 'anthropic' } }),
    ).toThrow(DevForgeConfigError);
  });

  it('rejects invalid URL for openai-compatible baseUrl', () => {
    expect(() =>
      validateConfig({
        repository: { root: '/tmp' },
        model: { provider: 'openai-compatible', model: 'gpt-4o', baseUrl: 'not-a-url' },
      }),
    ).toThrow(DevForgeConfigError);
  });

  it('rejects negative timeoutMs', () => {
    expect(() =>
      validateConfig({
        repository: { root: '/tmp' },
        model: { provider: 'openai-compatible', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', timeoutMs: -100 },
      }),
    ).toThrow(DevForgeConfigError);
  });

  it('rejects missing model for openai-compatible', () => {
    expect(() =>
      validateConfig({
        repository: { root: '/tmp' },
        model: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
      }),
    ).toThrow(DevForgeConfigError);
  });

  it('rejects null path with null byte', () => {
    expect(() =>
      validateConfig({ repository: { root: '/tmp\x00evil' }, model: { provider: 'fake' } }),
    ).toThrow(DevForgeConfigError);
  });
});

describe('validateProviderConfig', () => {
  it('validates fake provider', () => {
    const result = validateProviderConfig({ provider: 'fake' });
    expect(result.provider).toBe('fake');
  });

  it('validates openai-compatible provider', () => {
    const result = validateProviderConfig({
      provider: 'openai-compatible',
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
    });
    expect(result.provider).toBe('openai-compatible');
  });
});

describe('parseEnvConfig', () => {
  it('parses present env vars', () => {
    const env = {
      DEVFORGE_MODEL_PROVIDER: 'fake',
      DEVFORGE_MODEL_NAME: 'gpt-4o',
      DEVFORGE_MODEL_BASE_URL: 'https://api.openai.com/v1',
      DEVFORGE_MODEL_API_KEY: 'sk-key',
      DEVFORGE_MODEL_TIMEOUT_MS: '5000',
      DEVFORGE_REPOSITORY_ROOT: '/tmp/repo',
    };
    const result = parseEnvConfig(env);
    expect(result.DEVFORGE_MODEL_PROVIDER).toBe('fake');
    expect(result.DEVFORGE_MODEL_TIMEOUT_MS).toBe('5000');
  });

  it('returns undefined for missing env vars', () => {
    const result = parseEnvConfig({});
    expect(result.DEVFORGE_MODEL_PROVIDER).toBeUndefined();
  });
});

describe('mergeConfig', () => {
  it('uses explicit config over env', () => {
    const merged = mergeConfig(VALID_FAKE_CONFIG, {});
    expect(merged.model.provider).toBe('fake');
  });

  it('uses env when explicit is partial', () => {
    const merged = mergeConfig(
      { repository: { root: '/tmp/repo' } },
      { DEVFORGE_MODEL_PROVIDER: 'fake' },
    );
    expect(merged.model.provider).toBe('fake');
  });

  it('throws when no repo root provided', () => {
    expect(() => mergeConfig({}, {})).toThrow(DevForgeConfigError);
  });

  it('throws when no model provider provided', () => {
    expect(() => mergeConfig({ repository: { root: '/tmp' } }, {})).toThrow(DevForgeConfigError);
  });

  it('throws for unknown env provider', () => {
    expect(() =>
      mergeConfig({}, { DEVFORGE_MODEL_PROVIDER: 'anthropic' }),
    ).toThrow(DevForgeConfigError);
  });
});

describe('createModelProvider', () => {
  it('creates fake provider', () => {
    const provider = createModelProvider({ provider: 'fake' });
    expect(provider.id).toBe('fake-provider');
  });

  it('creates openai-compatible provider', () => {
    const provider = createModelProvider({
      provider: 'openai-compatible',
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    });
    expect(provider).toBeDefined();
  });
});

describe('createDevForge', () => {
  it('creates application with fake provider', async () => {
    const app = await createDevForge({
      repository: { root: '/tmp/test-repo' },
      model: { provider: 'fake' },
    });
    expect(app.ready).toBe(false);
    await app.initialize();
    expect(app.ready).toBe(true);
    await app.dispose();
    expect(app.ready).toBe(false);
  });

  it('ask() throws when not initialized', async () => {
    const app = await createDevForge({
      repository: { root: '/tmp/test-repo' },
      model: { provider: 'fake' },
    });
    await expect(app.ask('test')).rejects.toThrow(DevForgeConfigError);
    await app.dispose();
  });

  it('full pipeline with fake provider', async () => {
    const app = await createDevForge({
      repository: { root: '/tmp/test-repo' },
      model: { provider: 'fake' },
    });
    await app.initialize();
    const result = await app.ask('Explain code');
    expect(result.status).not.toBe('invalid');
    await app.dispose();
  });

  it('askWithDiagnostics returns diagnostics', async () => {
    const app = await createDevForge({
      repository: { root: '/tmp/test-repo' },
      model: { provider: 'fake' },
    });
    await app.initialize();
    const diag = await app.askWithDiagnostics('Find DevForgeRuntime');
    expect(diag.diagnostics).toBeDefined();
    expect(diag.diagnostics.intent).toBeDefined();
    expect(diag.diagnostics.runtime).toBeDefined();
    expect(diag.diagnostics.timing.totalDuration).toBeGreaterThan(0);
    await app.dispose();
  });

  it('dispose is idempotent', async () => {
    const app = await createDevForge({
      repository: { root: '/tmp/test-repo' },
      model: { provider: 'fake' },
    });
    await app.initialize();
    await app.dispose();
    await app.dispose(); // should not throw
  });
});

describe('DevForgeConfigError', () => {
  it('has correct name and fields', () => {
    const err = new DevForgeConfigError('test', 'field', 'CODE');
    expect(err.name).toBe('DevForgeConfigError');
    expect(err.field).toBe('field');
    expect(err.code).toBe('CODE');
    expect(err).toBeInstanceOf(Error);
  });
});