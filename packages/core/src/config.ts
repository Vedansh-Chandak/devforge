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
  maxRetries: z
    .number()
    .int()
    .nonnegative('maxRetries must be a non-negative integer')
    .optional(),
});

const GeminiProviderSchema = z.object({
  provider: z.literal('gemini'),
  model: z.string().min(1, 'model is required for gemini provider'),
  apiKey: z.string().optional(),
  baseUrl: z
    .string()
    .url('baseUrl must be a valid URL')
    .optional(),
  timeoutMs: z
    .number()
    .int()
    .positive('timeoutMs must be a positive integer')
    .optional(),
  maxRetries: z
    .number()
    .int()
    .nonnegative('maxRetries must be a non-negative integer')
    .optional(),
});

const AnthropicProviderSchema = z.object({
  provider: z.literal('anthropic'),
  model: z.string().min(1, 'model is required for anthropic provider'),
  apiKey: z.string().optional(),
  baseUrl: z
    .string()
    .url('baseUrl must be a valid URL')
    .optional(),
  timeoutMs: z
    .number()
    .int()
    .positive('timeoutMs must be a positive integer')
    .optional(),
  maxRetries: z
    .number()
    .int()
    .nonnegative('maxRetries must be a non-negative integer')
    .optional(),
});

const RoleModelsSchema = z
  .object({
    reasoning: z.string().min(1).optional(),
    coding: z.string().min(1).optional(),
    fast: z.string().min(1).optional(),
  })
  .refine(
    (roles) => Object.keys(roles).length > 0,
    'roleModels must have at least one role',
  );

const ModelProviderConfigSchema = z.discriminatedUnion('provider', [
  FakeProviderSchema,
  OpenAICompatibleProviderSchema,
  GeminiProviderSchema,
  AnthropicProviderSchema,
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
  roleModels: RoleModelsSchema.optional(),
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
    DEVFORGE_MODEL: env.DEVFORGE_MODEL,
    DEVFORGE_MODEL_BASE_URL: env.DEVFORGE_MODEL_BASE_URL,
    DEVFORGE_MODEL_API_KEY: env.DEVFORGE_MODEL_API_KEY,
    TOKENROUTER_API_KEY: env.TOKENROUTER_API_KEY,
    DEVFORGE_MODEL_TIMEOUT_MS: env.DEVFORGE_MODEL_TIMEOUT_MS,
    DEVFORGE_MODEL_MAX_RETRIES: env.DEVFORGE_MODEL_MAX_RETRIES,
    DEVFORGE_REASONING_MODEL: env.DEVFORGE_REASONING_MODEL,
    DEVFORGE_CODING_MODEL: env.DEVFORGE_CODING_MODEL,
    DEVFORGE_FAST_MODEL: env.DEVFORGE_FAST_MODEL,
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

  // Normalized role models: explicit wins, then env
  const roleModels: { reasoning?: string; coding?: string; fast?: string } = {};
  if (explicit.roleModels) {
    Object.assign(roleModels, explicit.roleModels);
  }
  if (envConfig.DEVFORGE_REASONING_MODEL) {
    roleModels.reasoning = envConfig.DEVFORGE_REASONING_MODEL;
  }
  if (envConfig.DEVFORGE_CODING_MODEL) {
    roleModels.coding = envConfig.DEVFORGE_CODING_MODEL;
  }
  if (envConfig.DEVFORGE_FAST_MODEL) {
    roleModels.fast = envConfig.DEVFORGE_FAST_MODEL;
  }
  if (Object.keys(roleModels).length > 0) {
    (merged as { roleModels?: RoleModels }).roleModels = roleModels;
  }

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

  // Canonical model env is DEVFORGE_MODEL; DEVFORGE_MODEL_NAME is the legacy alias
  const modelName = env.DEVFORGE_MODEL ?? env.DEVFORGE_MODEL_NAME;

  const withExtras = (
    config: ModelProviderConfig,
  ): ModelProviderConfig => {
    if (env.DEVFORGE_MODEL_API_KEY) {
      (config as { apiKey?: string }).apiKey = env.DEVFORGE_MODEL_API_KEY;
    } else if (env.TOKENROUTER_API_KEY) {
      // Generic OpenAI-compatible gateway key fallback; no dedicated provider.
      (config as { apiKey?: string }).apiKey = env.TOKENROUTER_API_KEY;
    }
    if (env.DEVFORGE_MODEL_TIMEOUT_MS) {
      const timeout = parseInt(env.DEVFORGE_MODEL_TIMEOUT_MS, 10);
      if (!Number.isNaN(timeout) && timeout > 0) {
        (config as { timeoutMs?: number }).timeoutMs = timeout;
      }
    }
    if (env.DEVFORGE_MODEL_MAX_RETRIES) {
      const retries = parseInt(env.DEVFORGE_MODEL_MAX_RETRIES, 10);
      if (!Number.isNaN(retries) && retries >= 0) {
        (config as { maxRetries?: number }).maxRetries = retries;
      }
    }
    return config;
  };

  if (providerKind === 'openai-compatible') {
    const baseUrl = env.DEVFORGE_MODEL_BASE_URL;

    if (!modelName) {
      throw new DevForgeConfigError(
        'DEVFORGE_MODEL is required for openai-compatible provider',
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

    return withExtras({
      provider: 'openai-compatible',
      model: modelName,
      baseUrl,
    });
  }

  if (providerKind === 'gemini' || providerKind === 'anthropic') {
    if (!modelName) {
      throw new DevForgeConfigError(
        `DEVFORGE_MODEL is required for ${providerKind} provider`,
        'model.model',
        'MISSING_CONFIG',
      );
    }

    const config: ModelProviderConfig = {
      provider: providerKind,
      model: modelName,
    };

    if (env.DEVFORGE_MODEL_BASE_URL) {
      (config as { baseUrl?: string }).baseUrl = env.DEVFORGE_MODEL_BASE_URL;
    }

    return withExtras(config);
  }

  throw new DevForgeConfigError(
    `Unknown provider: "${providerKind}". Supported: fake, openai-compatible, gemini, anthropic`,
    'model.provider',
    'UNKNOWN_PROVIDER',
  );
}

/** Normalized model config (a NonNullable-safe subset for the ModelRouter). */
interface RoleModels {
  reasoning?: string;
  coding?: string;
  fast?: string;
}