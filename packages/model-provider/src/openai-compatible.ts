import { BaseModelProvider } from './provider.js';
import type { ModelRequest, ModelResponse, FinishReason, ModelUsage } from './types.js';
import { ModelProviderError } from './errors.js';
import { retry } from './retry.js';
import type { RetryOptions, RetryPolicy } from './retry.js';
import { withTimeout } from './timeout.js';
import { assertValidProviderConfig } from './validate.js';
import { assertStructuredOutput, parseJsonContent } from './structured.js';
import { HttpTransport } from './transport.js';
import type { FetchFn } from './transport.js';
import { isRecord } from './transport.js';

export type { FetchFn } from './transport.js';

/**
 * Configuration for the OpenAI-compatible provider.
 *
 * Works with any service implementing the OpenAI chat-completions request
 * shape (OpenAI, OpenRouter, Groq, Ollama, LM Studio, vLLM, …) — no
 * vendor-specific behavior is assumed. OpenRouter and similar compatible
 * endpoints are reached purely through a configurable `baseUrl`.
 */
export interface OpenAICompatibleProviderConfig {
  /**
   * API root URL (e.g. "https://api.openai.com/v1").
   * The provider appends "/chat/completions" to this.
   * Trailing slashes are stripped.
   */
  baseUrl: string;

  /**
   * API key for transport authentication.
   * Optional because local compatible servers (e.g. Ollama) may not require it.
   */
  apiKey?: string;

  /**
   * Model name sent by default in the request body (e.g. "gpt-4o").
   * A per-request `ModelRequest.model` overrides this.
   */
  model: string;

  /**
   * Request timeout in milliseconds. Default: 60000 (60 seconds).
   */
  timeoutMs?: number;

  /**
   * Maximum retries for retryable failures. Default 2.
   * A per-request `ModelRequest.maxRetries` overrides this.
   */
  maxRetries?: number;

  /** Backoff tuning for the shared DF-026A retry policy. */
  retryPolicy?: RetryPolicy;

  /**
   * Additional HTTP headers to include in every request.
   * Cannot override Authorization (set via apiKey).
   */
  headers?: Record<string, string>;

  /** Injectable fetch (e.g. for deterministic tests). */
  fetch?: FetchFn;

  /** Observability hook invoked before each retry. Never receives secrets. */
  onRetry?: RetryOptions['onRetry'];
}

const PROVIDER_ID = 'openai-compatible';
const ENDPOINT = '/chat/completions';

/**
 * Maps OpenAI finish_reason strings to DevForge FinishReason types.
 */
function mapFinishReason(raw: string | null | undefined): FinishReason {
  switch (raw) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
    case 'function_call':
      return 'tool_call';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'unknown';
  }
}

/** Include only usage fields the provider actually returned. */
function extractUsage(raw: unknown): ModelUsage | undefined {
  if (!isRecord(raw)) return undefined;
  const usage: ModelUsage = {};
  if (typeof raw.prompt_tokens === 'number') usage.inputTokens = raw.prompt_tokens;
  if (typeof raw.completion_tokens === 'number') usage.outputTokens = raw.completion_tokens;
  if (typeof raw.total_tokens === 'number') usage.totalTokens = raw.total_tokens;
  return Object.keys(usage).length === 0 ? undefined : usage;
}

/**
 * Provider for OpenAI-compatible chat-completion endpoints.
 *
 * Rewired in DF-026B onto the shared DF-026A primitives: request validation,
 * timeout (`withTimeout`), retry (centralized `retry` + classification),
 * redaction (`redactSecrets`), and structured-output validation
 * (`assertStructuredOutput`). Token translation to the provider-specific
 * request body happens here; model-focused packages stay provider-agnostic.
 *
 * @example
 * ```ts
 * const provider = new OpenAICompatibleProvider({
 *   baseUrl: 'https://api.openai.com/v1',
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'gpt-4o',
 * });
 * ```
 */
export class OpenAICompatibleProvider extends BaseModelProvider {
  readonly id = PROVIDER_ID;

  private readonly transport: HttpTransport;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly retryPolicy?: RetryPolicy;
  private readonly onRetry?: RetryOptions['onRetry'];

  constructor(config: OpenAICompatibleProviderConfig, fetchFn?: FetchFn) {
    super();

    // Preserve the historical constructor error messages exactly.
    if (!config.baseUrl) {
      throw new ModelProviderError('baseUrl is required', {
        provider: PROVIDER_ID,
        code: 'INVALID_REQUEST',
        retryable: false,
      });
    }
    if (!config.model) {
      throw new ModelProviderError('model is required', {
        provider: PROVIDER_ID,
        code: 'INVALID_REQUEST',
        retryable: false,
      });
    }
    // Validate the remaining common config via the shared DF-026A validator.
    assertValidProviderConfig(config);

    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.retryPolicy = config.retryPolicy;
    this.onRetry = config.onRetry;

    this.transport = new HttpTransport({
      provider: PROVIDER_ID,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      extraHeaders: config.headers,
      fetchFn: fetchFn ?? config.fetch ?? globalThis.fetch.bind(globalThis),
      secrets: [
        ...(typeof config.apiKey === 'string' ? [config.apiKey] : []),
        ...(config.headers ? Object.values(config.headers) : []),
      ],
    });
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.validateRequest(request);

    const policy: RetryPolicy = {
      maxRetries: this.retryPolicy?.maxRetries ?? 2,
      ...this.retryPolicy,
      ...(request.maxRetries !== undefined ? { maxRetries: request.maxRetries } : {}),
    };

    return retry(
      () =>
        withTimeout(
          (signal) => this.execute(request, signal),
          {
            timeoutMs: request.timeoutMs ?? this.timeoutMs,
            signal: request.signal,
            operation: 'generate',
            provider: this.id,
          },
        ),
      {
        operation: 'generate',
        provider: this.id,
        policy,
        signal: request.signal,
        onRetry: this.onRetry,
      },
    );
  }

  private async execute(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const json = (await this.transport.post({
      path: ENDPOINT,
      body: this.buildRequestBody(request),
      signal,
    })) as Record<string, unknown>;

    const response = this.parseResponse(json);
    this.validateStructuredResponse(request, response.content);
    return response;
  }

  /** Translate the normalized request into the provider-specific body. */
  private buildRequestBody(request: ModelRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      messages: request.messages,
    };
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }
    if (request.responseFormat) {
      body.response_format =
        request.responseFormat.type === 'json_schema'
          ? {
              type: 'json_schema',
              json_schema: {
                name: 'structured_output',
                schema: request.responseFormat.schema,
              },
            }
          : { type: 'json_object' };
    }
    return body;
  }

  /** Normalize the provider chat-completion body into a {@link ModelResponse}. */
  private parseResponse(json: Record<string, unknown>): ModelResponse {
    const choices = json.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new ModelProviderError('Provider returned no choices', {
        provider: this.id,
        code: 'PROVIDER_ERROR',
        retryable: false,
      });
    }

    const choice = choices[0] as Record<string, unknown> | undefined;
    const message = choice?.message as Record<string, unknown> | undefined;
    if (!message || typeof message.content !== 'string') {
      throw new ModelProviderError(
        'Provider returned a choice with no message content',
        {
          provider: this.id,
          code: 'PROVIDER_ERROR',
          retryable: false,
        },
      );
    }

    return {
      content: message.content,
      model: typeof json.model === 'string' ? json.model : undefined,
      finishReason: mapFinishReason(
        (choice as NonNullable<Record<string, unknown>>).finish_reason as
          | string
          | null
          | undefined,
      ),
      id: typeof json.id === 'string' ? json.id : undefined,
      provider: this.id,
      usage: extractUsage(json.usage),
    };
  }

  /**
   * Validate structured responses against the DF-026A schema validator.
   * Malformed structured responses never become successful responses.
   */
  private validateStructuredResponse(request: ModelRequest, content: string): void {
    if (request.responseFormat?.type === 'json_schema') {
      assertStructuredOutput(content, request.responseFormat.schema, {
        provider: this.id,
        operation: 'generate',
      });
      return;
    }
    if (request.responseFormat?.type === 'json_object') {
      try {
        parseJsonContent(content);
      } catch {
        throw new ModelProviderError(
          `Structured output validation failed for 'generate': response is not valid JSON`,
          { provider: this.id, code: 'PROVIDER_ERROR', retryable: false },
        );
      }
    }
  }
}