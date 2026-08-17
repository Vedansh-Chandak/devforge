/**
 * @devforge/execution — Command Runner limits and constants.
 */

export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 300_000;

export const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
export const MAX_MAX_OUTPUT_BYTES = 10_485_760;

export const MIN_COMMAND_LENGTH = 1;
export const MAX_COMMAND_LENGTH = 256;
export const MAX_ARGS = 128;
export const MAX_ARG_LENGTH = 4096;
export const MAX_ENV_VARS = 64;
export const MAX_ENV_KEY_LENGTH = 256;
export const MAX_ENV_VALUE_LENGTH = 8192;

export const SHELL_METACHARACTERS = ['|', '&', ';', '<', '>', '`', '$', '\\', '\n', '\r', '\t'] as const;

export const SHELL_EXPANSION_PATTERNS = [
  /\$\{/,
  /\$\w/,
  /`/,
  /\$\(/,
] as const;

export const MULTIPLE_COMMAND_PATTERNS = [
  /&&/,
  /\|\|/,
  /;\s*[a-zA-Z]/,
] as const;