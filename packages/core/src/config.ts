/**
 * Configuration validation and environment variable parsing.
 *
 * Environment variables are parsed by config.ts and merged with explicit config.
 * Core packages never read process.env directly.
 */

import { z } from 'zod';
import type { DevForgeConfig, DevForgeEnvConfig, ModelProviderConfig } from './types.js';
import { DevForgeConfigError } from './types.js';

// ──────────────────────────────────────────────
// Zod schemas for validation
// ──────────────────────────────────────────────

const FakeProviderSchema = z.object({
  provider: z.literal('fake'),
  response: z
    .object({
      content: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
});

const OpenAICompatibleProviderSchema = z.object({
  provider: z.literal('openai-compatible'),
  model: z.string().min(1, 'model is required for openai-compatible provider'),
  baseUrl: z
    .string()
    .url('baseUrl must be a valid URL')
    .refine(
      (url) => url.startsWith('http://') || url.startsWith('https://'),
      'baseUrl must use http:// or https:// protocol',
    ),
  apiKey: z.string().optional(),
  timeoutMs: z
    .number()
    .int()
    .positive('timeoutMs must be a positive integer')
    .optional(),
});

const ModelProviderConfigSchema = z.discriminatedUnion('provider', [
  FakeProviderSchema,
  OpenAICompatibleProviderSchema,
]);

const DevForgeConfigSchema = z.object({
  repository: z.object({
    root: z
      .string()
      .min(1, 'repository.root is required')
      .refine(
        (p) => !p.includes('\0'),
        'repository.root must be a valid path',
      ),
  }),
  model: ModelProviderConfigSchema,
  maxContextChars: z
    .number()
    .int()
    .positive('maxContextChars must be a positive integer')
    .optional(),
});

// ──────────────────────────────────────────────
// Validation function
// ──────────────────────────────────────────────

/**
 * Validate a DevForgeConfig. Throws DevForgeConfigError on failure.
 */
export function validateConfig(config: unknown): DevForgeConfig {
  const result = DevForgeConfigSchema.safeParse(config);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const path = issue.path.join('.');
    throw new DevForgeConfigError(
      `Config validation failed: ${issue.message}`,
      path || 'config',
      'VALIDATION_ERROR',
    );
  }
  return result.data as DevForgeConfig;
}

/**
 * Validate a provider configuration. Throws DevForgeConfigError on failure.
 */
export function validateProviderConfig(config: unknown): ModelProviderConfig {
  const result = ModelProviderConfigSchema.safeParse(config);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const path = issue.path.join('.');
    throw new DevForgeConfigError(
      `Provider config validation failed: ${issue.message}`,
      `model.${path}`,
      'PROVIDER_VALIDATION_ERROR',
    );
  }
  return result.data as ModelProviderConfig;
}

// ──────────────────────────────────────────────
// Environment variable parsing
// ──────────────────────────────────────────────

/**
 * Parse environment variables into a partial config overlay.
 * Returns only the variables that are present — does not set defaults.
 */
export function parseEnvConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): DevForgeEnvConfig {
  return {
    DEVFORGE_MODEL_PROVIDER: env.DEVFORGE_MODEL_PROVIDER,
    DEVFORGE_MODEL_NAME: env.DEVFORGE_MODEL_NAME,
    DEVFORGE_MODEL_BASE_URL: env.DEVFORGE_MODEL_BASE_URL,
    DEVFORGE_MODEL_API_KEY: env.DEVFORGE_MODEL_API_KEY,
    DEVFORGE_MODEL_TIMEOUT_MS: env.DEVFORGE_MODEL_TIMEOUT_MS,
    DEVFORGE_REPOSITORY_ROOT: env.DEVFORGE_REPOSITORY_ROOT,
  };
}

/**
 * Merge environment config with explicit config.
 * Explicit config takes precedence over environment variables.
 */
export function mergeConfig(
  explicit: Partial<DevForgeConfig>,
  envConfig: DevForgeEnvConfig = parseEnvConfig(),
): DevForgeConfig {
  // Repository root: explicit wins, then env, then error
  const repoRoot =
    explicit.repository?.root ??
    envConfig.DEVFORGE_REPOSITORY_ROOT;

  if (!repoRoot) {
    throw new DevForgeConfigError(
      'repository.root is required (provide in config or via DEVFORGE_REPOSITORY_ROOT)',
      'repository.root',
      'MISSING_CONFIG',
    );
  }

  // Model provider: explicit wins, then env
  let model: ModelProviderConfig;
  if (explicit.model) {
    model = explicit.model;
  } else if (envConfig.DEVFORGE_MODEL_PROVIDER) {
    model = buildProviderConfigFromEnv(envConfig);
  } else {
    throw new DevForgeConfigError(
      'model provider configuration is required (provide in config or via DEVFORGE_MODEL_PROVIDER)',
      'model.provider',
      'MISSING_CONFIG',
    );
  }

  const merged: DevForgeConfig = {
    repository: { root: repoRoot },
    model,
  };

  // Forward maxContextChars if provided
  if (explicit.maxContextChars !== undefined) {
    (merged as { maxContextChars?: number }).maxContextChars = explicit.maxContextChars;
  }

  return merged;
}

/**
 * Build provider config from environment variables.
 */
function buildProviderConfigFromEnv(env: DevForgeEnvConfig): ModelProviderConfig {
  const providerKind = env.DEVFORGE_MODEL_PROVIDER!;

  if (providerKind === 'fake') {
    return { provider: 'fake' };
  }

  if (providerKind === 'openai-compatible') {
    const model = env.DEVFORGE_MODEL_NAME;
    const baseUrl = env.DEVFORGE_MODEL_BASE_URL;

    if (!model) {
      throw new DevForgeConfigError(
        'DEVFORGE_MODEL_NAME is required for openai-compatible provider',
        'model.model',
        'MISSING_CONFIG',
      );
    }
    if (!baseUrl) {
      throw new DevForgeConfigError(
        'DEVFORGE_MODEL_BASE_URL is required for openai-compatible provider',
        'model.baseUrl',
        'MISSING_CONFIG',
      );
    }

    const config: ModelProviderConfig = {
      provider: 'openai-compatible',
      model,
      baseUrl,
    };

    if (env.DEVFORGE_MODEL_API_KEY) {
      (config as { apiKey?: string }).apiKey = env.DEVFORGE_MODEL_API_KEY;
    }
    if (env.DEVFORGE_MODEL_TIMEOUT_MS) {
      const timeout = parseInt(env.DEVFORGE_MODEL_TIMEOUT_MS, 10);
      if (!Number.isNaN(timeout) && timeout > 0) {
        (config as { timeoutMs?: number }).timeoutMs = timeout;
      }
    }

    return config;
  }

  throw new DevForgeConfigError(
    `Unknown provider: "${providerKind}". Supported: fake, openai-compatible`,
    'model.provider',
    'UNKNOWN_PROVIDER',
  );
}