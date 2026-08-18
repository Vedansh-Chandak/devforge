/**
 * DevForge Model Provider Abstraction
 * Provider-neutral interface for language models
 */

import type { StructuredOutputSchema } from './structured.js';

export type MessageRole = 'system' | 'user' | 'assistant';

export type FinishReason = 
  | 'stop' 
  | 'length' 
  | 'tool_call' 
  | 'content_filter' 
  | 'error' 
  | 'unknown';

export interface ModelMessage {
  role: MessageRole;
  content: string;
}

/**
 * The role a request plays in the system. Providers use this to select an
 * appropriate model when the caller does not pin an explicit `model` id.
 */
export type ModelSelectionRole = 'reasoning' | 'coding' | 'fast';

/**
 * Static capabilities of a model / provider. Optional — unknown values are
 * treated as "not advertised" rather than "unsupported".
 */
export interface ModelCapabilities {
  /** Maximum output tokens the model supports in a single response. */
  maxOutputTokens?: number;
  /** Maximum context window (input + output) in tokens. */
  maxContextTokens?: number;
  /** Whether structured / JSON output can be requested and validated. */
  supportsStructuredOutput?: boolean;
  /** Whether streaming is supported. */
  supportsStreaming?: boolean;
  /** Message roles the model accepts. */
  supportedRoles?: readonly MessageRole[];
}

/** Provider-neutral identity + capability metadata. */
export interface ModelProviderInfo {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly capabilities?: ModelCapabilities;
}

export interface ModelRequest {
  messages: ModelMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Optional external cancellation signal. When aborted, the provider must
   * stop the in-flight request and reject with a `CANCELLED` error. */
  signal?: AbortSignal;
  /** Per-request timeout in milliseconds. Overrides the provider default.
   * Values <= 0 disable the timeout. */
  timeoutMs?: number;
  /** Maximum number of retries for retryable failures. Overrides the
   * provider default. Values < 0 are clamped to 0. */
  maxRetries?: number;
  /** Structured-output request. Hints the provider to emit JSON that can be
   * validated against the supplied schema. */
  responseFormat?: {
    type: 'json_schema';
    schema: StructuredOutputSchema;
  } | {
    type: 'json_object';
  };
  /** Safe, non-secret metadata attached to the request. */
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ModelResponse {
  content: string;
  model?: string;
  finishReason?: FinishReason;
  usage?: ModelUsage;
  /** Optional provider request/response identifier. */
  id?: string;
  /** Provider adapter id that produced this response. */
  provider?: string;
}

export interface ModelProvider {
  readonly id: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}