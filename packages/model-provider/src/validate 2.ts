/**
 * Provider config validation (DF-026A).
 *
 * Provider-agnostic validation of the common configuration shape. Returns a
 * structured result (no throwing) so callers decide how to react; a throwing
 * convenience wrapper is provided for constructor use.
 */

import { ModelProviderError } from './errors.js';

/** Loose shape accepted by the validator (unknown inputs allowed). */
export interface ProviderConfigShape {
  readonly model?: unknown;
  readonly apiKey?: unknown;
  readonly baseUrl?: unknown;
  readonly timeoutMs?: unknown;
  readonly maxRetries?: unknown;
  readonly headers?: unknown;
}

export interface ConfigIssue {
  readonly path: string;
  readonly message: string;
}

export type ConfigValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

/** True when `value` is a string http(s) URL. */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Validate a provider config shape without throwing. Deterministic. */
export function validateProviderConfig(
  config: ProviderConfigShape,
): ConfigValidationResult {
  const issues: ConfigIssue[] = [];

  if (config.model === undefined || config.model === null) {
    issues.push({ path: 'model', message: 'is required' });
  } else if (typeof config.model !== 'string' || config.model.trim().length === 0) {
    issues.push({ path: 'model', message: 'must be a non-empty string' });
  }

  if (
    config.apiKey !== undefined &&
    config.apiKey !== null &&
    (typeof config.apiKey !== 'string' || config.apiKey.trim().length === 0)
  ) {
    issues.push({ path: 'apiKey', message: 'must be a non-empty string' });
  }

  if (config.baseUrl !== undefined && config.baseUrl !== null && !isHttpUrl(config.baseUrl)) {
    issues.push({ path: 'baseUrl', message: 'must be a valid http(s) URL' });
  }

  if (
    config.timeoutMs !== undefined &&
    config.timeoutMs !== null &&
    (typeof config.timeoutMs !== 'number' ||
      !Number.isFinite(config.timeoutMs) ||
      config.timeoutMs < 0)
  ) {
    issues.push({ path: 'timeoutMs', message: 'must be a non-negative number' });
  }

  if (
    config.maxRetries !== undefined &&
    config.maxRetries !== null &&
    (typeof config.maxRetries !== 'number' ||
      !Number.isInteger(config.maxRetries) ||
      config.maxRetries < 0)
  ) {
    issues.push({ path: 'maxRetries', message: 'must be a non-negative integer' });
  }

  if (config.headers !== undefined && config.headers !== null) {
    if (typeof config.headers !== 'object' || Array.isArray(config.headers)) {
      issues.push({ path: 'headers', message: 'must be an object of string values' });
    } else {
      for (const [key, value] of Object.entries(
        config.headers as Record<string, unknown>,
      )) {
        if (typeof value !== 'string') {
          issues.push({ path: `headers.${key}`, message: 'must be a string' });
        }
      }
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/** Validate and throw a non-retryable `INVALID_REQUEST` on failure. */
export function assertValidProviderConfig(config: ProviderConfigShape): void {
  const result = validateProviderConfig(config);
  if (!result.ok) {
    const detail = result.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    throw new ModelProviderError(`Invalid provider config — ${detail}`, {
      provider: 'config',
      code: 'INVALID_REQUEST',
      retryable: false,
    });
  }
}
