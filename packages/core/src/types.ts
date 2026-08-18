/**
 * DevForge Application Configuration
 *
 * Strongly-typed configuration for the application composition layer.
 * Maps directly to the concrete provider and runtime implementations.
 */

/** Supported provider identifiers — only providers that are implemented */
export type ProviderKind = 'fake' | 'openai-compatible' | 'gemini' | 'anthropic';

/** Configuration for the fake provider (development/testing) */
export interface FakeProviderConfig {
  readonly provider: 'fake';
  /** Custom response content. Defaults to a standard fake response. */
  readonly response?: {
    readonly content?: string;
    readonly model?: string;
  };
}

/** Configuration for OpenAI-compatible providers */
export interface OpenAICompatibleProviderConfig {
  readonly provider: 'openai-compatible';
  /** Model identifier (e.g. 'gpt-4o', 'openai/gpt-oss-20b:free') */
  readonly model: string;
  /** Base URL for the OpenAI-compatible API (e.g. 'https://openrouter.ai/api/v1') */
  readonly baseUrl: string;
  /** API key. Optional because local compatible servers may not require it. */
  readonly apiKey?: string;
  /** Request timeout in milliseconds */
  readonly timeoutMs?: number;
  /** Maximum retries for retryable failures */
  readonly maxRetries?: number;
}

/** Configuration for Google Gemini providers */
export interface GeminiProviderConfig {
  readonly provider: 'gemini';
  /** Model identifier (e.g. 'gemini-2.5-flash') */
  readonly model: string;
  /** API key */
  readonly apiKey?: string;
  /** Optional API root (defaults to the Gemini API) */
  readonly baseUrl?: string;
  /** Request timeout in milliseconds */
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

/** Configuration for Anthropic providers */
export interface AnthropicProviderConfig {
  readonly provider: 'anthropic';
  /** Model identifier (e.g. 'claude-sonnet-4-20250514') */
  readonly model: string;
  /** API key */
  readonly apiKey?: string;
  /** Optional API root (defaults to the Anthropic API) */
  readonly baseUrl?: string;
  /** Request timeout in milliseconds */
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

/** Union of all provider configurations */
export type ModelProviderConfig =
  | FakeProviderConfig
  | OpenAICompatibleProviderConfig
  | GeminiProviderConfig
  | AnthropicProviderConfig;

/** Role-specific model identifiers resolved through the ModelRouter. */
export interface RoleModelsConfig {
  readonly reasoning?: string;
  readonly coding?: string;
  readonly fast?: string;
}

/** Root configuration for createDevForge() */
export interface DevForgeConfig {
  /** Repository configuration */
  readonly repository: {
    /** Absolute path to the repository root */
    readonly root: string;
  };
  /** Model provider configuration */
  readonly model: ModelProviderConfig;
  /** Role-specific model ids for model routing (optional). */
  readonly roleModels?: RoleModelsConfig;
  /** Optional: max characters for combined prompt context (default: 100000) */
  readonly maxContextChars?: number;
}

/**
 * Environment variable mapping for DevForge configuration.
 * These are the supported env vars that can replace config values.
 */
export interface DevForgeEnvConfig {
  DEVFORGE_MODEL_PROVIDER?: string;
  DEVFORGE_MODEL_NAME?: string;
  DEVFORGE_MODEL?: string;
  DEVFORGE_MODEL_BASE_URL?: string;
  DEVFORGE_MODEL_API_KEY?: string;
  DEVFORGE_MODEL_TIMEOUT_MS?: string;
  DEVFORGE_MODEL_MAX_RETRIES?: string;
  DEVFORGE_REASONING_MODEL?: string;
  DEVFORGE_CODING_MODEL?: string;
  DEVFORGE_FAST_MODEL?: string;
  DEVFORGE_REPOSITORY_ROOT?: string;
}

/**
 * Application object returned by createDevForge().
 * Clean high-level API — consumers don't need to import internal packages.
 */
export interface DevForgeApplication {
  /** Initialize the application (Runtime + Brain). Idempotent. */
  initialize(): Promise<void>;
  /** Ask a question through the full pipeline */
  ask(question: string): Promise<import('@devforge/brain').AskResult>;
  /** Ask with diagnostics for validation/debug mode */
  askWithDiagnostics(question: string): Promise<DevForgeDiagnosticsResult>;
  /** Dispose all resources. Idempotent. */
  dispose(): Promise<void>;
  /** Whether the application is initialized */
  readonly ready: boolean;
}

/**
 * Diagnostic result for validation/debug mode.
 * Exposes pipeline stages without exposing secrets.
 */
export interface DevForgeDiagnosticsResult {
  /** The actual AskResult from the pipeline */
  result: import('@devforge/brain').AskResult;
  /** Diagnostic information about the pipeline execution */
  diagnostics: {
    /** Classified intent */
    intent: string;
    /** Extracted query (if applicable) */
    extractedQuery?: string;
    /** Runtime execution metadata */
    runtime: {
      executed: boolean;
      duration: number;
      success: boolean;
      errorCount: number;
    };
    /** Context that was sent to the prompt composer */
    context: {
      symbolCount: number;
      dependencyCount: number;
      hasArchitecture: boolean;
      contextChars: number;
      truncated: boolean;
    };
    /** Model request that was sent to the provider */
    modelRequest?: {
      messageCount: number;
      systemMessageLength: number;
      userMessageLength: number;
    };
    /** Provider metadata (no secrets) */
    provider?: {
      id: string;
      model?: string;
      finishReason?: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
    };
    /** Timing information */
    timing: {
      totalDuration: number;
      runtimeDuration: number;
      providerDuration: number;
    };
  };
}

/**
 * Validation error thrown for configuration problems.
 */
export class DevForgeConfigError extends Error {
  readonly field: string;
  readonly code: string;

  constructor(message: string, field: string, code: string) {
    super(message);
    this.name = 'DevForgeConfigError';
    this.field = field;
    this.code = code;
  }
}