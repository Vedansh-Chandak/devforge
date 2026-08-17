/**
 * @devforge/execution — Environment filter for command execution.
 *
 * Builds a filtered environment for child processes. The parent process
 * environment is never passed through verbatim: only allowlisted variables
 * are copied, then explicit request values are merged on top (overriding
 * allowlisted keys).
 *
 * Pure and deterministic: identical inputs always produce identical output.
 * The base environment is supplied by the caller (typically process.env)
 * so this module never touches ambient global state.
 */

import { ALLOWLIST_ENV_VARS } from './types.js';

/** A plain string-keyed environment map. */
export type EnvironmentMap = Readonly<Record<string, string>>;

export interface BuildEnvironmentInput {
  /** Source environment to filter (usually process.env). */
  readonly baseEnv: EnvironmentMap;
  /** Explicit variables supplied by the caller, merged verbatim. */
  readonly explicitEnv?: EnvironmentMap;
}

/**
 * Create a filtered environment for a child process.
 *
 * 1. Copy allowlisted variables present in `baseEnv`.
 * 2. Merge every `explicitEnv` entry, overriding allowlisted values.
 */
export function buildEnvironment(
  baseEnv: EnvironmentMap,
  explicitEnv?: EnvironmentMap,
): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const key of ALLOWLIST_ENV_VARS) {
    const value = baseEnv[key];
    if (value !== undefined) {
      filtered[key] = value;
    }
  }

  if (explicitEnv) {
    for (const [key, value] of Object.entries(explicitEnv)) {
      filtered[key] = value;
    }
  }

  return filtered;
}

/** Convenience wrapper that filters the real process environment. */
export function buildEnvironmentFromProcess(
  explicitEnv?: EnvironmentMap,
): Record<string, string> {
  return buildEnvironment(process.env as Record<string, string>, explicitEnv);
}
