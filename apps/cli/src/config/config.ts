/**
 * @devforge/cli — Configuration types and defaults (M1).
 *
 * Defines the DevForge CLI configuration schema and the default values used
 * when no config file or environment overrides are present.
 */

/** Supported model provider kinds. */
export type ProviderKind = 'fake' | 'openai-compatible';

/** Log verbosity levels. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/** The complete, resolved DevForge CLI configuration. */
export interface DevForgeConfig {
  /** Model provider kind. Defaults to 'fake'. */
  readonly provider: ProviderKind;
  /** Model identifier for openai-compatible providers. */
  readonly model?: string;
  /** Base URL for openai-compatible providers (e.g. https://api.openai.com/v1). */
  readonly baseUrl?: string;
  /** API key for openai-compatible providers. */
  readonly apiKey?: string;
  /** Request timeout for openai-compatible providers (ms). */
  readonly timeoutMs?: number;
  /** Sampling temperature (0.0 - 2.0). */
  readonly temperature?: number;
  /** Maximum repair attempts in the autonomous coding loop. */
  readonly maxRepairAttempts?: number;
  /** Explicit workspace root; overrides repository discovery when set. */
  readonly workspace?: string;
  /** Log level. */
  readonly logLevel: LogLevel;
}

/** A raw, possibly-partial config loaded from disk or env. */
export interface RawDevForgeConfig {
  readonly provider?: ProviderKind;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly temperature?: number;
  readonly maxRepairAttempts?: number;
  readonly workspace?: string;
  readonly logLevel?: LogLevel;
}

/** Default configuration values. */
export const DEFAULT_CONFIG = {
  provider: 'fake' as ProviderKind,
  logLevel: 'info' as LogLevel,
} as const;

/** Default temperature applied to all model requests. */
export const DEFAULT_TEMPERATURE = 0.2;

/** Default max tokens applied to model requests. */
export const DEFAULT_MAX_TOKENS = 2048;