/**
 * @vedansh78/cli — Config loader service (M1, DF-029B).
 *
 * Loads configuration from, in order of precedence (highest wins):
 *
 *   0. CLI flags (e.g. --model; applied by the session service post-load)
 *   1. environment variables (DEVFORGE_*)
 *   2. ./.devforge.json (project-local)
 *   3. ~/.devforge/config.json (user-global)
 *   4. defaults
 *
 * Credential handling: the API key may come from DEVFORGE_MODEL_API_KEY /
 * DEVFORGE_API_KEY directly, or indirectly via `apiKeyEnv` in a config file,
 * which names an environment variable holding the secret (the secret itself
 * never appears on disk). An explicit `apiKey` beats `apiKeyEnv`. Secrets are
 * never logged, never included in validation errors, and always masked by
 * display commands.
 *
 * Returns a fully validated DevForgeConfig plus the list of sources that
 * contributed and where the credential came from.
 */

import { homedir } from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type {
  DevForgeConfig,
  ProviderKind,
  RawDevForgeConfig,
  LogLevel,
  RoleModelsConfig,
} from '../types.js';
import { DEFAULT_CONFIG, DEFAULT_TEMPERATURE } from '../types.js';

/** Result of config validation. */
export interface ConfigValidationResult {
  readonly ok: boolean;
  readonly config?: DevForgeConfig;
  readonly errors: readonly string[];
}

const PROVIDER_KINDS: readonly ProviderKind[] = ['fake', 'openai-compatible', 'gemini', 'anthropic'];
const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];
const ROLE_KEYS: readonly (keyof RoleModelsConfig)[] = ['reasoning', 'coding', 'fast'];

/** Environment variable names mapped onto the config shape. */
const ENV_MAP: Record<string, keyof RawDevForgeConfig> = {
  // Canonical DF-026C names take precedence over the legacy aliases.
  DEVFORGE_MODEL_PROVIDER: 'provider',
  DEVFORGE_MODEL: 'model',
  DEVFORGE_MODEL_BASE_URL: 'baseUrl',
  DEVFORGE_MODEL_API_KEY: 'apiKey',
  DEVFORGE_MODEL_TIMEOUT_MS: 'timeoutMs',
  DEVFORGE_MODEL_MAX_RETRIES: 'maxRetries',
  // Legacy aliases (kept for backward compatibility).
  DEVFORGE_PROVIDER: 'provider',
  DEVFORGE_BASE_URL: 'baseUrl',
  DEVFORGE_API_KEY: 'apiKey',
  DEVFORGE_TIMEOUT_MS: 'timeoutMs',
  DEVFORGE_TEMPERATURE: 'temperature',
  DEVFORGE_MAX_REPAIR_ATTEMPTS: 'maxRepairAttempts',
  DEVFORGE_WORKSPACE: 'workspace',
  DEVFORGE_LOG_LEVEL: 'logLevel',
} as const;

/** Role-specific model env vars mapped into `roleModels`. */
const ROLE_ENV_MAP: Record<string, keyof RoleModelsConfig> = {
  DEVFORGE_REASONING_MODEL: 'reasoning',
  DEVFORGE_CODING_MODEL: 'coding',
  DEVFORGE_FAST_MODEL: 'fast',
};

/** Numeric config keys parsed from env strings. */
const NUMERIC_KEYS: ReadonlySet<keyof RawDevForgeConfig> = new Set([
  'timeoutMs',
  'maxRetries',
  'temperature',
  'maxRepairAttempts',
]);

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

  if (provider === 'gemini' || provider === 'anthropic') {
    if (!input.model || input.model.trim().length === 0) {
      errors.push(`provider "${provider}" requires a "model"`);
    }
  }

  if (input.apiKey !== undefined && typeof input.apiKey !== 'string') {
    errors.push('apiKey must be a string');
  }

  if (input.apiKeyEnv !== undefined) {
    if (typeof input.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.apiKeyEnv)) {
      errors.push('apiKeyEnv must be a valid environment variable name');
    }
  }

  if (input.maxRetries !== undefined && (typeof input.maxRetries !== 'number' || !Number.isInteger(input.maxRetries) || input.maxRetries < 0)) {
    errors.push('maxRetries must be a non-negative integer');
  }

  if (input.roleModels !== undefined) {
    if (typeof input.roleModels !== 'object' || input.roleModels === null || Array.isArray(input.roleModels)) {
      errors.push('roleModels must be an object');
    } else {
      for (const [role, model] of Object.entries(input.roleModels)) {
        if (!ROLE_KEYS.includes(role as keyof RoleModelsConfig)) {
          errors.push(`unknown role "${role}" in roleModels`);
        } else if (typeof model !== 'string' || model.trim().length === 0) {
          errors.push(`roleModels.${role} must be a non-empty string`);
        }
      }
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
    maxRetries: input.maxRetries,
    temperature: input.temperature ?? DEFAULT_TEMPERATURE,
    roleModels: input.roleModels,
    maxRepairAttempts: input.maxRepairAttempts,
    workspace: input.workspace,
    logLevel,
  };

  return { ok: true, config, errors: [] };
}

/** Validate an openai-compatible provider block (thin guard). */
export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === 'string' && PROVIDER_KINDS.includes(value as ProviderKind);
}

/** Load config from environment variables into a partial raw config. */
export function loadFromEnv(env: NodeJS.ProcessEnv = process.env): RawDevForgeConfig {
  const raw: RawDevForgeConfig = {};
  const stringKeys: ReadonlySet<keyof RawDevForgeConfig> = new Set([
    'provider',
    'model',
    'baseUrl',
    'apiKey',
    'workspace',
    'logLevel',
  ]);

  for (const [envName, key] of Object.entries(ENV_MAP)) {
    const value = env[envName];
    if (value === undefined || value.trim().length === 0) continue;
    if ((raw as Record<string, unknown>)[key] !== undefined) {
      // Canonical names appear first in ENV_MAP, so a legacy alias must not
      // overwrite the canonical value.
      continue;
    }
    if (stringKeys.has(key)) {
      (raw as Record<string, unknown>)[key] = value;
    } else if (NUMERIC_KEYS.has(key)) {
      const num = Number(value);
      if (!Number.isNaN(num)) (raw as Record<string, unknown>)[key] = num;
    }
  }

  const roles: Record<string, unknown> = {};
  for (const [envName, role] of Object.entries(ROLE_ENV_MAP)) {
    const value = env[envName];
    if (value !== undefined && value.trim().length > 0) {
      roles[role] = value.trim();
    }
  }
  if (Object.keys(roles).length > 0) {
    (raw as { roleModels?: RoleModelsConfig }).roleModels = roles as RoleModelsConfig;
  }

  return raw;
}

/** Read and JSON-parse a config file, returning null on absence or bad JSON. */
export async function loadJsonFile(filePath: string): Promise<RawDevForgeConfig | null> {
  try {
    const text = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as RawDevForgeConfig;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Discover the user-level config location: ~/.devforge/config.json.
 * Returns null when HOME is unavailable.
 */
export function userConfigPath(): string | null {
  const home = homedir();
  if (!home) return null;
  return path.join(home, '.devforge', 'config.json');
}

/** Where the resolved API key credential came from (never the value). */
export type CredentialSource = 'environment' | 'project' | 'user' | 'none';

/**
 * Load and validate configuration for a given project directory.
 * Precedence: env > ./.devforge.json > ~/.devforge/config.json > defaults
 * (CLI flags such as --model are applied on top by the session service).
 */
export async function loadConfig(
  workspaceSource: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ config: DevForgeConfig; sources: string[]; credentialSource: CredentialSource }> {
  const sources: string[] = [];

  const envRaw = loadFromEnv(env);

  let projectRaw: RawDevForgeConfig | null = null;
  const projectPath = path.join(workspaceSource, '.devforge.json');
  const projectConfig = await loadJsonFile(projectPath);
  if (projectConfig) {
    projectRaw = projectConfig;
    sources.push(projectPath);
  }

  let userRaw: RawDevForgeConfig | null = null;
  const userPath = userConfigPath();
  if (userPath) {
    const userConfig = await loadJsonFile(userPath);
    if (userConfig) {
      userRaw = userConfig;
      sources.push(userPath);
    }
  }

  // Merge: user is base, project overrides, env overrides (mutable so the
  // apiKeyEnv credential reference can be resolved below).
  const merged: { -readonly [K in keyof RawDevForgeConfig]: RawDevForgeConfig[K] } = {
    ...userRaw,
    ...projectRaw,
    ...envRaw,
  };

  // Credential reference resolution (DF-029B): `apiKeyEnv` names an env var
  // holding the secret. An explicit `apiKey` always wins. The referenced
  // variable's VALUE is only read into the in-memory config — it is never
  // logged, never echoed in errors, and masked by every display command.
  if (!merged.apiKey && merged.apiKeyEnv) {
    const referenced = env[merged.apiKeyEnv];
    if (referenced !== undefined && referenced.trim().length > 0) {
      merged.apiKey = referenced;
    }
  }

  // Determine where the credential came from (for display only).
  let credentialSource: CredentialSource = 'none';
  if (merged.apiKey !== undefined) {
    if (envRaw.apiKey !== undefined) {
      credentialSource = 'environment';
    } else if (projectRaw?.apiKey !== undefined || projectRaw?.apiKeyEnv !== undefined) {
      credentialSource = 'project';
    } else {
      credentialSource = 'user';
    }
  }

  const result = validateConfig(merged);
  if (!result.ok || !result.config) {
    throw new Error(`Invalid configuration: ${result.errors.join('; ')}`);
  }

  return { config: result.config, sources, credentialSource };
}