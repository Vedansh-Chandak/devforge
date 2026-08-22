/**
 * Normalized model configuration (DF-026C).
 *
 * Expresses the application-facing model configuration in provider-neutral
 * terms. Provider-specific request formats never appear here — they live
 * inside the concrete adapters. Configuration is resolved from an explicit
 * object, environment variables, or both, and can be validated, redacted,
 * and handed to {@link ModelRouter} for role-based selection.
 */

import type { ModelSelectionRole } from './types.js';

/** Supported provider kinds, including the offline/testing fake provider. */
export type ModelProviderKind =
  | 'openai-compatible'
  | 'gemini'
  | 'anthropic'
  | 'fake';

/** All supported provider kinds, in stable declaration order. */
export const MODEL_PROVIDER_KINDS: readonly ModelProviderKind[] = [
  'openai-compatible',
  'gemini',
  'anthropic',
  'fake',
];

/** All model roles that can be routed. */
export const MODEL_ROLES: readonly ModelSelectionRole[] = [
  'reasoning',
  'coding',
  'fast',
];

/** True when `value` is a supported provider kind. */
export function isModelProviderKind(value: unknown): value is ModelProviderKind {
  return (
    typeof value === 'string' &&
    (MODEL_PROVIDER_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Normalized model configuration.
 *
 * `model` is required for real providers (`openai-compatible`, `gemini`,
 * `anthropic`); the `fake` provider does not need one.
 */
export interface ModelConfig {
  /** Provider kind. */
  readonly provider: ModelProviderKind;
  /** Model identifier (e.g. "openai/gpt-oss-20b:free"). */
  readonly model?: string;
  /** API root URL for http providers (e.g. "https://openrouter.ai/api/v1"). */
  readonly baseUrl?: string;
  /** Secret API key. Never logged or printed. */
  readonly apiKey?: string;
  /** Request timeout in milliseconds. */
  readonly timeoutMs?: number;
  /** Maximum retries for retryable failures. */
  readonly maxRetries?: number;
  /** Custom response for the `fake` provider (testing/dev only). */
  readonly fakeResponse?: FakeResponseConfig;
}

/** Custom canned response for the `fake` provider. */
export interface FakeResponseConfig {
  readonly content?: string;
  readonly model?: string;
}

/** Partial model config accepted while resolving layered configuration. */
export type PartialModelConfig = Readonly<Partial<ModelConfig>>;

/** Role → model configuration map (explicit role configuration). */
export type RoleModelConfigMap = Readonly<
  Partial<Record<ModelSelectionRole, PartialModelConfig>>
>;

/** Result of parsing the DEVFORGE_* model environment. */
export interface ModelEnvConfig {
  /** Default model configuration (DEVFORGE_MODEL_PROVIDER / DEVFORGE_MODEL / …). */
  readonly default: PartialModelConfig;
  /** Role-specific model overrides (DEVFORGE_REASONING_MODEL / …). */
  readonly roles: RoleModelConfigMap;
}

/** A single model-config validation problem. */
export interface ModelConfigIssue {
  readonly path: string;
  readonly message: string;
}

export type ModelConfigValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly ModelConfigIssue[] };

/**
 * Env variable names understood by the parser. `DEVFORGE_MODEL` is the model
 * id; provider/baseUrl/apiKey/timeout/maxRetries use `DEVFORGE_MODEL_*`.
 * Role-specific ids use `DEVFORGE_{ROLE}_MODEL` (uppercase role).
 */
const DEFAULT_ENV_KEYS = {
  provider: 'DEVFORGE_MODEL_PROVIDER',
  model: 'DEVFORGE_MODEL',
  baseUrl: 'DEVFORGE_MODEL_BASE_URL',
  apiKey: 'DEVFORGE_MODEL_API_KEY',
  timeoutMs: 'DEVFORGE_MODEL_TIMEOUT_MS',
  maxRetries: 'DEVFORGE_MODEL_MAX_RETRIES',
} as const;

const ROLE_ENV_KEYS: Readonly<Record<ModelSelectionRole, string>> = {
  reasoning: 'DEVFORGE_REASONING_MODEL',
  coding: 'DEVFORGE_CODING_MODEL',
  fast: 'DEVFORGE_FAST_MODEL',
};

/** Numeric config keys parsed from env strings. */
const NUMERIC_KEYS: ReadonlySet<keyof ModelConfig> = new Set([
  'timeoutMs',
  'maxRetries',
]);

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const num = Number(value);
  return Number.isNaN(num) ? undefined : num;
}

/**
 * Parse the DEVFORGE_* model environment into a normalized structure.
 * Never throws: malformed values are skipped, missing values are absent.
 */
export function parseModelConfigEnv(
  env: Record<string, string | undefined> = process.env,
): ModelEnvConfig {
  const def: Record<string, unknown> = {};

  const provider = env[DEFAULT_ENV_KEYS.provider];
  if (provider !== undefined && isModelProviderKind(provider)) {
    def.provider = provider;
  }

  for (const [key, envName] of Object.entries(DEFAULT_ENV_KEYS) as Array<
    [keyof ModelConfig, string]
  >) {
    if (key === 'provider') continue;
    const raw = env[envName];
    if (raw === undefined) continue;
    if (NUMERIC_KEYS.has(key)) {
      const num = parseNumber(raw);
      if (num !== undefined) def[key] = num;
    } else {
      def[key] = raw;
    }
  }

  const roles: Record<string, unknown> = {};
  for (const role of MODEL_ROLES) {
    const model = env[ROLE_ENV_KEYS[role]];
    if (model !== undefined && model.trim().length > 0) {
      roles[role] = { model };
    }
  }

  return {
    default: def as PartialModelConfig,
    roles: roles as RoleModelConfigMap,
  };
}

/**
 * Merge a role-specific config over the default config. Deterministic.
 * Role wins for overlapping keys; the default is the base.
 */
export function mergeModelConfig(
  base: PartialModelConfig,
  override?: PartialModelConfig,
): PartialModelConfig {
  return override ? { ...base, ...override } : base;
}

/** True when a non-fake provider config is missing a model id. */
export function isMissingModel(config: PartialModelConfig): boolean {
  if (config.provider === 'fake') return false;
  return !config.model || config.model.trim().length === 0;
}

/** Validate a (possibly partial) normalized model config. Deterministic. */
export function validateModelConfig(
  config: PartialModelConfig,
): ModelConfigValidationResult {
  const issues: ModelConfigIssue[] = [];

  if (config.provider === undefined) {
    issues.push({ path: 'provider', message: 'is required' });
  } else if (!isModelProviderKind(config.provider)) {
    issues.push({
      path: 'provider',
      message: `must be one of: ${MODEL_PROVIDER_KINDS.join(', ')}`,
    });
  }

  if (isMissingModel(config)) {
    issues.push({
      path: 'model',
      message: 'is required for non-fake providers',
    });
  } else if (
    config.model !== undefined &&
    typeof config.model !== 'string'
  ) {
    issues.push({ path: 'model', message: 'must be a string' });
  }

  if (config.baseUrl !== undefined) {
    if (typeof config.baseUrl !== 'string' || !isHttpUrlText(config.baseUrl)) {
      issues.push({ path: 'baseUrl', message: 'must be a valid http(s) URL' });
    }
  } else if (config.provider === 'openai-compatible') {
    issues.push({ path: 'baseUrl', message: 'is required for openai-compatible' });
  }

  if (config.apiKey !== undefined && typeof config.apiKey !== 'string') {
    issues.push({ path: 'apiKey', message: 'must be a string' });
  }

  if (
    config.timeoutMs !== undefined &&
    (typeof config.timeoutMs !== 'number' ||
      !Number.isFinite(config.timeoutMs) ||
      config.timeoutMs < 0)
  ) {
    issues.push({ path: 'timeoutMs', message: 'must be a non-negative number' });
  }

  if (
    config.maxRetries !== undefined &&
    (typeof config.maxRetries !== 'number' ||
      !Number.isInteger(config.maxRetries) ||
      config.maxRetries < 0)
  ) {
    issues.push({
      path: 'maxRetries',
      message: 'must be a non-negative integer',
    });
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

function isHttpUrlText(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Keys that must never be printed or logged. */
export const MODEL_SECRET_KEYS: readonly (keyof ModelConfig)[] = ['apiKey'];

/**
 * Return a config copy with secret values masked. `apiKey` becomes
 * `"***"` when present; every other field is passed through untouched.
 */
export function redactModelConfig(config: ModelConfig | PartialModelConfig): PartialModelConfig {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const secret = MODEL_SECRET_KEYS as readonly string[];
    out[key] =
      secret.includes(key) && value !== undefined && value !== ''
        ? '***'
        : value;
  }
  return out as PartialModelConfig;
}

/** Human-readable label for a model role. */
export function roleLabel(role: ModelSelectionRole): string {
  switch (role) {
    case 'reasoning':
      return 'Reasoning model';
    case 'coding':
      return 'Coding model';
    case 'fast':
      return 'Fast model';
  }
}
