import { describe, it, expect } from 'vitest';
import { redactSecrets, redactSecretText, MIN_SECRET_LENGTH } from '../redact.js';

describe('redactSecretText (reused from @devforge/errors)', () => {
  it('redacts bearer tokens', () => {
    const out = redactSecretText('Authorization: Bearer sk-abc123');
    expect(out).not.toContain('sk-abc123');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts API-key headers', () => {
    expect(redactSecretText('API_KEY=sk-super-secret')).toContain('[REDACTED]');
    expect(redactSecretText('x-api-key: "abcd1234"')).toContain('[REDACTED]');
  });

  it('redacts environment interpolations', () => {
    expect(redactSecretText('using ${OPENAI_API_KEY} here')).not.toContain('OPENAI_API_KEY');
    expect(redactSecretText('key process.env.OPENAI_API_KEY now')).toContain('[REDACTED]');
  });

  it('redacts URL credentials', () => {
    expect(redactSecretText('https://user:pass@host.example/v1')).toBe(
      'https://[REDACTED]@host.example/v1',
    );
  });

  it('redacts private key blocks', () => {
    const input =
      '-----BEGIN RSA PRIVATE KEY-----\nSECRETMATERIAL\n-----END RSA PRIVATE KEY-----';
    const out = redactSecretText(input);
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('SECRETMATERIAL');
  });

  it('leaves benign text untouched', () => {
    const text = 'The model responded with a plan in 3 steps.';
    expect(redactSecretText(text)).toBe(text);
  });
});

describe('redactSecrets', () => {
  it('redacts configured API key values', () => {
    const out = redactSecrets('my key is sk-super-secret-key and sk-super-secret-key again', [
      'sk-super-secret-key',
    ]);
    expect(out).toBe('my key is [REDACTED] and [REDACTED] again');
    expect(out).not.toContain('sk-super-secret-key');
  });

  it('applies structural redaction in addition to value redaction', () => {
    const out = redactSecrets('token Bearer tok-abc, key=sk-abc123', ['sk-abc123']);
    expect(out).not.toContain('sk-abc123');
    expect(out).not.toContain('Bearer tok-abc');
  });

  it('ignores secrets shorter than the minimum length', () => {
    const out = redactSecrets('pin is 1234', ['1234']);
    expect(out).toBe('pin is 1234');
    expect(MIN_SECRET_LENGTH).toBe(6);
  });

  it('does not throw on empty secret lists', () => {
    expect(redactSecrets('plain text', [])).toBe('plain text');
    expect(redactSecrets('plain text', undefined)).toBe('plain text');
  });

  it('is deterministic for a fixed input', () => {
    const input = 'key=sk-abcdef123456 and API_KEY=sk-abcdef123456';
    const a = redactSecrets(input, ['sk-abcdef123456']);
    const b = redactSecrets(input, ['sk-abcdef123456']);
    expect(a).toBe(b);
  });
});
