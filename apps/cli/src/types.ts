/**
 * @devforge/cli — Shared type definitions (M1).
 *
 * Configuration schema plus the CLI/session option types used across commands.
 */

/** Supported model provider kinds. */
export type ProviderKind = 'fake' | 'openai-compatible' | 'gemini' | 'anthropic';

/** Role → model identifier map (DF-026C). */
export interface RoleModelsConfig {
  readonly reasoning?: string;
  readonly coding?: string;
  readonly fast?: string;
}

/** Log verbosity levels. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/** The complete, resolved DevForge CLI configuration. */
export interface DevForgeConfig {
  /** Model provider kind. Defaults to 'fake'. */
  readonly provider: ProviderKind;
  /** Model identifier for real providers. */
  readonly model?: string;
  /** Base URL for openai-compatible providers (e.g. https://api.openai.com/v1). */
  readonly baseUrl?: string;
  /** API key for real providers. */
  readonly apiKey?: string;
  /** Request timeout for real providers (ms). */
  readonly timeoutMs?: number;
  /** Maximum retries for retryable provider failures. */
  readonly maxRetries?: number;
  /** Sampling temperature (0.0 - 2.0). */
  readonly temperature?: number;
  /** Role-specific model identifiers resolved through the ModelRouter (DF-026C). */
  readonly roleModels?: RoleModelsConfig;
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
  /**
   * Credential reference (DF-029B): name of an environment variable holding
   * the API key (e.g. "OPENROUTER_API_KEY"). Only the NAME may appear in
   * config files — never the secret itself. Resolved at load time; an
   * explicit `apiKey` takes precedence when both are present.
   */
  readonly apiKeyEnv?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly temperature?: number;
  readonly roleModels?: RoleModelsConfig;
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

/** CLI global options. */
export interface CliOptions {
  /** Output as JSON instead of human-readable text. */
  json: boolean;
  /** Enable debug logging and stack traces. */
  debug: boolean;
  /** Auto-approve confirmation steps for autonomous execution. */
  autoApprove: boolean;
  /** Model override for doctor checks / config display (--model). */
  model?: string;
}