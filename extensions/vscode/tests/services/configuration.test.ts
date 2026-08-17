import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_EXTENSION_CONFIG,
  EXTENSION_LOG_LEVELS,
  ENV_KEYS,
  Configuration,
  WorkspaceConfigurationReader,
  resolveConfiguration,
  readRawSettings,
  toEnvOverrides,
  ConfigurationReader,
} from '../../src/services/configuration.js';
import { ExtensionConfigError } from '../../src/errors.js';

function reader(values: Record<string, unknown>): ConfigurationReader {
  return { get: <T>(key: string): T | undefined => values[key] as T | undefined };
}

describe('resolveConfiguration', () => {
  it('applies defaults for an empty config', () => {
    expect(resolveConfiguration({})).toEqual(DEFAULT_EXTENSION_CONFIG);
  });

  it('keeps explicitly set values', () => {
    const config = resolveConfiguration({ provider: 'openai-compatible', model: 'gpt-4o', baseUrl: 'http://x', maxAttempts: 5, logLevel: 'debug' });
    expect(config.provider).toBe('openai-compatible');
    expect(config.model).toBe('gpt-4o');
    expect(config.maxAttempts).toBe(5);
    expect(config.logLevel).toBe('debug');
  });

  it('rejects an invalid log level', () => {
    expect(() => resolveConfiguration({ logLevel: 'verbose' as never })).toThrow(ExtensionConfigError);
  });

  it('rejects an invalid provider', () => {
    expect(() => resolveConfiguration({ provider: 'anthropic' as never })).toThrow(ExtensionConfigError);
  });

  it('rejects a negative maxAttempts', () => {
    expect(() => resolveConfiguration({ maxAttempts: -1 })).toThrow(ExtensionConfigError);
  });

  it('rejects a fractional maxAttempts', () => {
    expect(() => resolveConfiguration({ maxAttempts: 2.5 })).toThrow(ExtensionConfigError);
  });

  it('accepts zero maxAttempts', () => {
    expect(resolveConfiguration({ maxAttempts: 0 }).maxAttempts).toBe(0);
  });

  it('requires model when provider is openai-compatible', () => {
    expect(() => resolveConfiguration({ provider: 'openai-compatible' })).toThrow(ExtensionConfigError);
  });

  it('requires baseUrl when provider is openai-compatible', () => {
    expect(() => resolveConfiguration({ provider: 'openai-compatible', model: 'gpt-4o' })).toThrow(ExtensionConfigError);
  });

  it('accepts a fully configured openai-compatible provider', () => {
    const config = resolveConfiguration({ provider: 'openai-compatible', model: 'gpt-4o', baseUrl: 'http://x' });
    expect(config.provider).toBe('openai-compatible');
  });

  it('accepts every documented log level', () => {
    for (const level of EXTENSION_LOG_LEVELS) {
      expect(resolveConfiguration({ logLevel: level }).logLevel).toBe(level);
    }
  });
});

describe('readRawSettings', () => {
  it('reads each setting by key', () => {
    const values = {
      provider: 'fake',
      model: 'm',
      baseUrl: 'u',
      apiKey: 'k',
      maxAttempts: 2,
      autoRepair: true,
      confirmRiskyChanges: false,
      autoApprove: true,
      logLevel: 'warn',
    };
    expect(readRawSettings(reader(values))).toEqual(values);
  });

  it('leaves unset keys undefined', () => {
    expect(readRawSettings(reader({}))).toEqual({
      provider: undefined,
      model: undefined,
      baseUrl: undefined,
      apiKey: undefined,
      maxAttempts: undefined,
      autoRepair: undefined,
      confirmRiskyChanges: undefined,
      autoApprove: undefined,
      logLevel: undefined,
    });
  });
});

describe('toEnvOverrides', () => {
  it('maps each explicitly-set setting to its env key', () => {
    const env = toEnvOverrides({ provider: 'openai-compatible', model: 'gpt-4o', maxAttempts: 5, logLevel: 'trace' });
    expect(env[ENV_KEYS.provider]).toBe('openai-compatible');
    expect(env[ENV_KEYS.model]).toBe('gpt-4o');
    expect(env[ENV_KEYS.maxAttempts]).toBe('5');
    expect(env[ENV_KEYS.logLevel]).toBe('trace');
  });

  it('stringifies numeric settings', () => {
    expect(toEnvOverrides({ maxAttempts: 1 })[ENV_KEYS.maxAttempts]).toBe('1');
  });

  it('ignores unset settings', () => {
    expect(Object.keys(toEnvOverrides({}))).toHaveLength(0);
  });

  it('ignores auto toggles (they are not env-forwarded)', () => {
    const env = toEnvOverrides({ autoRepair: false, autoApprove: true });
    expect(Object.keys(env)).toHaveLength(0);
  });
});

describe('WorkspaceConfigurationReader', () => {
  it('delegates get to the underlying config', () => {
    const config = { get: <T>(key: string): T | undefined => (key === 'model' ? ('gpt-4o' as T) : undefined) };
    const wc = new WorkspaceConfigurationReader(config);
    expect(wc.get('model')).toBe('gpt-4o');
    expect(wc.get('baseUrl')).toBeUndefined();
  });
});

describe('Configuration service', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('read resolves raw settings to a full configuration', () => {
    const config = new Configuration(reader({ maxAttempts: 7 }));
    expect(config.read().maxAttempts).toBe(7);
    expect(config.read().provider).toBe('fake');
  });

  it('toCliOptions derives engine options', () => {
    const config = new Configuration(reader({ logLevel: 'debug', autoApprove: true }));
    expect(config.toCliOptions()).toEqual({ json: true, debug: true, autoApprove: true });
  });

  it('toCliOptions is not debug for info level', () => {
    const config = new Configuration(reader({ logLevel: 'info' }));
    expect(config.toCliOptions().debug).toBe(false);
  });

  it('toEnvOverrides forwards raw settings', () => {
    const config = new Configuration(reader({ provider: 'fake' }));
    expect(config.toEnvOverrides()[ENV_KEYS.provider]).toBe('fake');
  });

  it('notifyChanged invokes the subscriber with the resolved config', () => {
    const listener = vi.fn();
    const config = new Configuration(reader({ maxAttempts: 3 }), listener);
    config.notifyChanged();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 3 }));
  });
});
