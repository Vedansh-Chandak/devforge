/**
 * @devforge/cli — Configuration validation (M1).
 *
 * Validates a raw config object and produces a fully-resolved DevForgeConfig
 * merged over defaults. Pure and deterministic; never touches disk.
 */

import type { DevForgeConfig, ProviderKind, RawDevForgeConfig, LogLevel } from './config.js';
import { DEFAULT_CONFIG, DEFAULT_TEMPERATURE } from './config.js';

/** Result of config validation. */
export interface ConfigValidationResult {
  readonly ok: boolean;
  readonly config?: DevForgeConfig;
  readonly errors: readonly string[];
}

const PROVIDER_KINDS: readonly ProviderKind[] = ['fake', 'openai-compatible'];
const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];

/**
 * Validate a raw config and merge it over defaults.
 * Returns either a resolved config or a list of human-readable errors.
 */
export function validateConfig(raw: RawDevForgeConfig | undefined): ConfigValidationResult {
  const errors: string[] = [];
  const input = raw ?? {};

  const provider = input.provider ?? DEFAULT_CONFIG.provider;
  if (!PROVIDER_KINDS.includes(provider)) {
    errors.push(`Invalid provider "${input.provider}": expected one of ${PROVIDER_KINDS.join(', ')}`);
  }

  if (provider === 'openai-compatible') {
    if (!input.model || input.model.trim().length === 0) {
      errors.push('provider "openai-compatible" requires a "model"');
    }
    if (!input.baseUrl || input.baseUrl.trim().length === 0) {
      errors.push('provider "openai-compatible" requires a "baseUrl"');
    }
  }

  if (input.temperature !== undefined) {
    if (typeof input.temperature !== 'number' || Number.isNaN(input.temperature)) {
      errors.push('temperature must be a number');
    } else if (input.temperature < 0 || input.temperature > 2) {
      errors.push('temperature must be between 0 and 2');
    }
  }

  if (input.maxRepairAttempts !== undefined) {
    if (typeof input.maxRepairAttempts !== 'number' || !Number.isInteger(input.maxRepairAttempts)) {
      errors.push('maxRepairAttempts must be an integer');
    } else if (input.maxRepairAttempts < 0) {
      errors.push('maxRepairAttempts must be 0 or greater');
    }
  }

  if (input.timeoutMs !== undefined && (typeof input.timeoutMs !== 'number' || input.timeoutMs < 0)) {
    errors.push('timeoutMs must be a non-negative number');
  }

  const logLevel = input.logLevel ?? DEFAULT_CONFIG.logLevel;
  if (!LOG_LEVELS.includes(logLevel)) {
    errors.push(`Invalid logLevel "${input.logLevel}": expected one of ${LOG_LEVELS.join(', ')}`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const config: DevForgeConfig = {
    provider,
    model: input.model,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    timeoutMs: input.timeoutMs,
    temperature: input.temperature ?? DEFAULT_TEMPERATURE,
    maxRepairAttempts: input.maxRepairAttempts,
    workspace: input.workspace,
    logLevel,
  };

  return { ok: true, config, errors: [] };
}

/** Validate an openai-compatible provider block (thin wrapper). */
export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === 'string' && PROVIDER_KINDS.includes(value as ProviderKind);
}