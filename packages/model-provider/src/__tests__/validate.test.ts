import { describe, it, expect } from 'vitest';
import {
  validateProviderConfig,
  assertValidProviderConfig,
  isHttpUrl,
} from '../validate.js';
import { ModelProviderError } from '../errors.js';

const VALID = {
  model: 'gpt-4o',
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.com/v1',
  timeoutMs: 30_000,
  maxRetries: 2,
  headers: { 'X-Custom': 'value' },
};

describe('validateProviderConfig', () => {
  it('accepts a fully valid config', () => {
    expect(validateProviderConfig(VALID)).toEqual({ ok: true });
  });

  it('accepts a minimal config (model only)', () => {
    expect(validateProviderConfig({ model: 'gpt-4o' })).toEqual({ ok: true });
  });

  it('rejects a missing model', () => {
    const result = validateProviderConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({ path: 'model', message: 'is required' });
    }
  });

  it('rejects a null model', () => {
    const result = validateProviderConfig({ model: null });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string model', () => {
    const result = validateProviderConfig({ model: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        path: 'model',
        message: 'must be a non-empty string',
      });
    }
  });

  it('rejects an empty/whitespace model', () => {
    expect(validateProviderConfig({ model: '' }).ok).toBe(false);
    expect(validateProviderConfig({ model: '   ' }).ok).toBe(false);
  });

  it('accepts http and https baseUrls', () => {
    expect(validateProviderConfig({ model: 'm', baseUrl: 'https://api.example.com' }).ok).toBe(true);
    expect(validateProviderConfig({ model: 'm', baseUrl: 'http://localhost:11434/v1' }).ok).toBe(true);
  });

  it('rejects a non-http(s) baseUrl', () => {
    const result = validateProviderConfig({ model: 'm', baseUrl: 'ftp://host' });
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed baseUrl', () => {
    expect(validateProviderConfig({ model: 'm', baseUrl: 'not a url' }).ok).toBe(false);
    expect(validateProviderConfig({ model: 'm', baseUrl: 42 }).ok).toBe(false);
  });

  it('rejects a negative timeoutMs', () => {
    const result = validateProviderConfig({ model: 'm', timeoutMs: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe('timeoutMs');
    }
  });

  it('accepts timeoutMs of 0 (disable timeout)', () => {
    expect(validateProviderConfig({ model: 'm', timeoutMs: 0 }).ok).toBe(true);
  });

  it('rejects a non-number timeoutMs', () => {
    expect(validateProviderConfig({ model: 'm', timeoutMs: '5000' }).ok).toBe(false);
    expect(validateProviderConfig({ model: 'm', timeoutMs: NaN }).ok).toBe(false);
  });

  it('rejects a negative or fractional maxRetries', () => {
    expect(validateProviderConfig({ model: 'm', maxRetries: -1 }).ok).toBe(false);
    expect(validateProviderConfig({ model: 'm', maxRetries: 2.5 }).ok).toBe(false);
  });

  it('accepts a non-negative integer maxRetries', () => {
    expect(validateProviderConfig({ model: 'm', maxRetries: 0 }).ok).toBe(true);
    expect(validateProviderConfig({ model: 'm', maxRetries: 3 }).ok).toBe(true);
  });

  it('rejects an empty apiKey', () => {
    expect(validateProviderConfig({ model: 'm', apiKey: '' }).ok).toBe(false);
    expect(validateProviderConfig({ model: 'm', apiKey: '   ' }).ok).toBe(false);
  });

  it('rejects headers with a non-string value', () => {
    const result = validateProviderConfig({ model: 'm', headers: { 'X-Key': 42 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({ path: 'headers.X-Key', message: 'must be a string' });
    }
  });

  it('rejects non-object headers', () => {
    expect(validateProviderConfig({ model: 'm', headers: [] }).ok).toBe(false);
    expect(validateProviderConfig({ model: 'm', headers: 'x' }).ok).toBe(false);
  });

  it('aggregates multiple issues deterministically', () => {
    const result = validateProviderConfig({ baseUrl: 'nope', timeoutMs: -5, maxRetries: 1.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues.map((i) => i.path);
      expect(paths).toEqual(['model', 'baseUrl', 'timeoutMs', 'maxRetries']);
    }
  });
});

describe('assertValidProviderConfig', () => {
  it('does not throw for a valid config', () => {
    expect(() => assertValidProviderConfig({ model: 'gpt-4o' })).not.toThrow();
  });

  it('throws a non-retryable INVALID_REQUEST ModelProviderError on failure', () => {
    try {
      assertValidProviderConfig({ baseUrl: 'nope' });
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelProviderError);
      const pe = error as ModelProviderError;
      expect(pe.code).toBe('INVALID_REQUEST');
      expect(pe.retryable).toBe(false);
      expect(pe.message).toContain('model');
      expect(pe.message).toContain('baseUrl');
    }
  });
});

describe('isHttpUrl', () => {
  it('recognizes valid http(s) URLs', () => {
    expect(isHttpUrl('https://api.openai.com/v1')).toBe(true);
    expect(isHttpUrl('http://localhost:11434')).toBe(true);
  });

  it('rejects non-URLs and other schemes', () => {
    expect(isHttpUrl('gpt-4o')).toBe(false);
    expect(isHttpUrl('ftp://host')).toBe(false);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpUrl(42)).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});
