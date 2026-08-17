/**
 * @devforge/cli — Config loader service (M1).
 *
 * Loads configuration from, in order of precedence:
 *   1. environment variables (DEVFORGE_*)
 *   2. ./.devforge.json (project-local)
 *   3. ~/.devforge/config.json (user-global)
 *   4. defaults
 *
 * Returns a fully validated DevForgeConfig.
 */

import { homedir } from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type {
  DevForgeConfig,
  ProviderKind,
  RawDevForgeConfig,
  LogLevel,
} from '../types.js';
import { DEFAULT_CONFIG, DEFAULT_TEMPERATURE } from '../types.js';

/** Result of config validation. */
export interface ConfigValidationResult {
  readonly ok: boolean;
  readonly config?: DevForgeConfig;
  readonly errors: readonly string[];
}

const PROVIDER_KINDS: readonly ProviderKind[] = ['fake', 'openai-compatible'];
const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];

/** Environment variable names mapped onto the config shape. */
const ENV_MAP: Record<string, keyof RawDevForgeConfig> = {
  DEVFORGE_PROVIDER: 'provider',
  DEVFORGE_MODEL: 'model',
  DEVFORGE_BASE_URL: 'baseUrl',
  DEVFORGE_API_KEY: 'apiKey',
  DEVFORGE_TIMEOUT_MS: 'timeoutMs',
  DEVFORGE_TEMPERATURE: 'temperature',
  DEVFORGE_MAX_REPAIR_ATTEMPTS: 'maxRepairAttempts',
  DEVFORGE_WORKSPACE: 'workspace',
  DEVFORGE_LOG_LEVEL: 'logLevel',
} as const;

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

/** Validate an openai-compatible provider block (thin guard). */
export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === 'string' && PROVIDER_KINDS.includes(value as ProviderKind);
}

/** Load config from environment variables into a partial raw config. */
export function loadFromEnv(env: NodeJS.ProcessEnv = process.env): RawDevForgeConfig {
  const raw: RawDevForgeConfig = {};
  for (const [envName, key] of Object.entries(ENV_MAP)) {
    const value = env[envName];
    if (value === undefined) continue;
    if (key === 'provider' || key === 'model' || key === 'baseUrl' ||
        key === 'apiKey' || key === 'workspace' || key === 'logLevel') {
      (raw as Record<string, unknown>)[key] = value;
    } else if (key === 'timeoutMs' || key === 'temperature' || key === 'maxRepairAttempts') {
      const num = Number(value);
      if (!Number.isNaN(num)) (raw as Record<string, unknown>)[key] = num;
    }
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

/**
 * Load and validate configuration for a given project directory.
 * Precedence: env > ./.devforge.json > ~/.devforge/config.json > defaults.
 */
export async function loadConfig(
  workspaceSource: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ config: DevForgeConfig; sources: string[] }> {
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

  // Merge: user is base, project overrides, env overrides.
  const merged: RawDevForgeConfig = {
    ...userRaw,
    ...projectRaw,
    ...envRaw,
  };

  const result = validateConfig(merged);
  if (!result.ok || !result.config) {
    throw new Error(`Invalid configuration: ${result.errors.join('; ')}`);
  }

  return { config: result.config, sources };
}