/**
 * @devforge/cli — Configuration loading (M1).
 *
 * Loads configuration from, in order of precedence:
 *   1. environment variables (DEVFORGE_*)
 *   2. ./.devforge.json (project-local)
 *   3. ~/.devforge/config.json (user-global)
 *   4. defaults
 *
 * Returns a fully validated DevConfig.
 */

import { homedir } from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { DevForgeConfig, RawDevForgeConfig } from './config.js';
import { validateConfig } from './validator.js';

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