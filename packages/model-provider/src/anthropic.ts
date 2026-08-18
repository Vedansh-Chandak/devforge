/**
 * Anthropic provider adapter (DF-026B).
 *
 * Implements the normalized {@link ModelProvider} contract over Anthropic's
 * Messages API. All Anthropic-specific request/response translation stays
 * inside this file.
 *
 *  - REST call: `POST {baseUrl}/v1/messages`
 *  - auth: `x-api-key` header + required `anthropic-version` header
 *  - `max_tokens` is required by Anthropic; a configurable default is used
 *    when the normalized request omits it (never fabricated usage — only a
 *    generation parameter).
 *  - response tokens normalized onto {@link ModelUsage} (`totalTokens` is
 *    derived from input + output when both are returned by the provider).
 *  - structured output: the schema is injected as a JSON instruction in the
 *    system prompt and validated provider-independently by the DF-026A
 *    schema validator.
 */

import { BaseModelProvider } from './provider.js';
import type {
  FinishReason,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelUsage,
} from './types.js';
import { ModelProviderError } from './errors.js';
import { retry } from './retry.js';
import type { RetryOptions, RetryPolicy } from './retry.js';
import { withTimeout } from './timeout.js';
import { assertValidProviderConfig } from './validate.js';
import { assertStructuredOutput, parseJsonContent } from './structured.js';
import { HttpTransport } from './transport.js';
import type { FetchFn } from './transport.js';
import { isRecord } from './transport.js';

export interface AnthropicProviderConfig {
  /** Default model id (e.g. "claude-sonnet-4-20250514"). */
  model: string;
  /** API credential. Injected via `x-api-key`; never logged. */
  apiKey?: string;
  /** API root. Defaults to https://api.anthropic.com */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default 60000. */
  timeoutMs?: number;
  /** Maximum retries for retryable failures. Default 2. */
  maxRetries?: number;
  /** Backoff tuning for the shared retry policy. */
  retryPolicy?: RetryPolicy;
  /**
   * `max_tokens` value used when the normalized request omits it. Anthropic's
   * API requires the field. Default 4096.
   */
  defaultMaxTokens?: number;
  /** Additional HTTP headers. Cannot override the auth header. */
  headers?: Record<string, string>;
  /** Injectable fetch for deterministic tests. */
  fetch?: FetchFn;
  /** Observability hook invoked before each retry. Never receives secrets. */
  onRetry?: RetryOptions['onRetry'];
}

const PROVIDER_ID = 'anthropic';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const MESSAGES_PATH = '/v1/messages';

/** Map Anthropic `stop_reason` values onto normalized {@link FinishReason}. */
export function mapAnthropicStopReason(
  raw: string | null | undefined,
): FinishReason {
  switch (raw) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_call';
    case 'refusal':
    case 'content_filter':
      return 'content_filter';
    default:
      return 'unknown';
  }
}

/** Translate Anthropic usage into {@link ModelUsage}; `total` is derived. */
export function extractAnthropicUsage(raw: unknown): ModelUsage | undefined {
  if (!isRecord(raw)) return undefined;
  const usage: ModelUsage = {};
  if (typeof raw.input_tokens === 'number') usage.inputTokens = raw.input_tokens;
  if (typeof raw.output_tokens === 'number') usage.outputTokens = raw.output_tokens;
  if (typeof raw.input_tokens === 'number' && typeof raw.output_tokens === 'number') {
    usage.totalTokens = raw.input_tokens + raw.output_tokens;
  }
  return Object.keys(usage).length === 0 ? undefined : usage;
}

export interface AnthropicMessageTranslation {
  readonly system: string;
  readonly messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * Translate normalized messages into Anthropic `messages` + `system`.
 * Anthropic requires the conversation to start with a `user` turn, so an
 * empty `user` prefix is injected when the first non-system turn is
 * `assistant`.
 */
export function toAnthropicMessages(
  messages: readonly ModelMessage[],
  systemBraces = '',
): AnthropicMessageTranslation {
  const systemParts: string[] = [];
  const conversation: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }
    conversation.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    });
  }

  if (systemParts.length > 0 && systemBraces.length > 0) {
    systemParts.push(systemBraces);
  } else if (systemParts.length === 0 && systemBraces.length > 0) {
    systemParts.push(systemBraces);
  }

  const system = systemParts.join('\n\n');

  if (conversation.length > 0 && conversation[0]!.role === 'assistant') {
    conversation.unshift({ role: 'user', content: '' });
  }

  return { system, messages: conversation };
}

/**
 * Adapter over Anthropic's Messages API.
 * All Anthropic-specific conversion is confined to this class.
 */
export class AnthropicProvider extends BaseModelProvider {
  readonly id = PROVIDER_ID;

  private readonly transport: HttpTransport;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly defaultMaxTokens: number;
  private readonly retryPolicy?: RetryPolicy;
  private readonly onRetry?: RetryOptions['onRetry'];

  constructor(config: AnthropicProviderConfig, fetchFn?: FetchFn) {
    super();
    assertValidProviderConfig(config);

    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.defaultMaxTokens = config.defaultMaxTokens ?? 4096;
    this.retryPolicy = config.retryPolicy;
    this.onRetry = config.onRetry;

    this.transport = new HttpTransport({
      provider: PROVIDER_ID,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: config.apiKey,
      auth: { scheme: 'header', name: 'x-api-key' },
      extraHeaders: { 'anthropic-version': ANTHROPIC_VERSION, ...config.headers },
      fetchFn: fetchFn ?? config.fetch ?? globalThis.fetch.bind(globalThis),
      secrets: typeof config.apiKey === 'string' ? [config.apiKey] : [],
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
      path: MESSAGES_PATH,
      body: this.buildRequestBody(request),
      signal,
    })) as Record<string, unknown>;

    const response = this.parseResponse(json);
    this.validateStructuredResponse(request, response.content);
    return response;
  }

  /** Render the normalized structured-output request as a JSON instruction. */
  private structuredInstruction(request: ModelRequest): string {
    if (request.responseFormat?.type === 'json_schema') {
      return (
        'Respond with only a single valid JSON object conforming to this schema: ' +
        JSON.stringify(request.responseFormat.schema) +
        '. Do not include any other text.'
      );
    }
    if (request.responseFormat?.type === 'json_object') {
      return 'Respond with only a single valid JSON object. Do not include any other text.';
    }
    return '';
  }

  /** Translate the normalized request into the Anthropic Messages body. */
  private buildRequestBody(request: ModelRequest): Record<string, unknown> {
    const { system, messages } = toAnthropicMessages(
      request.messages,
      this.structuredInstruction(request),
    );

    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      messages,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
    };
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (system.length > 0) {
      body.system = system;
    }
    return body;
  }

  /** Normalize an Anthropic Messages body into a {@link ModelResponse}. */
  private parseResponse(json: Record<string, unknown>): ModelResponse {
    const content = json.content;
    if (!Array.isArray(content)) {
      throw new ModelProviderError('Provider returned no content blocks', {
        provider: this.id,
        code: 'PROVIDER_ERROR',
        retryable: false,
      });
    }

    const text = content
      .filter((block): block is Record<string, unknown> => isRecord(block))
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('');
    if (text.length === 0) {
      throw new ModelProviderError('Provider returned no text content', {
        provider: this.id,
        code: 'PROVIDER_ERROR',
        retryable: false,
      });
    }

    return {
      content: text,
      model: typeof json.model === 'string' ? json.model : undefined,
      finishReason: mapAnthropicStopReason(
        json.stop_reason as string | null | undefined,
      ),
      id: typeof json.id === 'string' ? json.id : undefined,
      provider: this.id,
      usage: extractAnthropicUsage(json.usage),
    };
  }

  /** Validate structured responses provider-independently (DF-026A). */
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