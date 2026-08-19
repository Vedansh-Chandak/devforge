import { BaseModelProvider } from './provider.js';
import type { ModelRequest, ModelResponse, FinishReason, ModelUsage } from './types.js';
import { ModelProviderError, isModelProviderError } from './errors.js';
import { retry } from './retry.js';
import type { RetryOptions, RetryPolicy } from './retry.js';
import { withTimeout, withStreamTimeout } from './timeout.js';
import { assertValidProviderConfig } from './validate.js';
import { assertStructuredOutput, parseJsonContent } from './structured.js';
import { HttpTransport } from './transport.js';
import type { FetchFn } from './transport.js';
import { isRecord, readStreamBody } from './transport.js';
import { parseSse } from './sse.js';
import type { SseRecord } from './sse.js';
import type { ModelStream, ModelStreamEvent, StreamingModelProvider } from './streaming.js';
import { withStreamingRetry } from './retry.js';

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
/** Sentinel SSE payload marking the end of an OpenAI-compatible stream. */
const STREAM_DONE = '[DONE]';

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
 * Accumulated tool-call fragment for a single `delta.tool_calls[index]`.
 * OpenAI streams these across chunks (id/name in the first delta, arguments
 * appended incrementally); this adapter reassembles them and emits a single
 * normalized `tool_call` event once the stream ends.
 */
interface ToolCallAccumulator {
  id?: string;
  name?: string;
  arguments: string;
}

function accumulateToolCall(
  state: Map<number, ToolCallAccumulator>,
  raw: unknown,
): void {
  if (!isRecord(raw)) return;
  const index =
    typeof raw.index === 'number' ? raw.index : nextToolCallIndex(state);
  const current = state.get(index) ?? { arguments: '' };
  if (typeof raw.id === 'string' && current.id === undefined) {
    current.id = raw.id;
  }
  if (isRecord(raw.function)) {
    if (typeof raw.function.name === 'string' && current.name === undefined) {
      current.name = raw.function.name;
    }
    if (typeof raw.function.arguments === 'string') {
      current.arguments = current.arguments + raw.function.arguments;
    }
  }
  state.set(index, current);
}

function nextToolCallIndex(state: Map<number, ToolCallAccumulator>): number {
  let max = -1;
  for (const key of state.keys()) {
    if (key > max) max = key;
  }
  return max + 1;
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
export class OpenAICompatibleProvider extends BaseModelProvider implements StreamingModelProvider {
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

  /** {@inheritDoc StreamingModelProvider.stream} */
  stream(request: ModelRequest): ModelStream {
    this.validateRequest(request);

    const policy: RetryPolicy = {
      maxRetries: this.retryPolicy?.maxRetries ?? 2,
      ...this.retryPolicy,
      ...(request.maxRetries !== undefined ? { maxRetries: request.maxRetries } : {}),
    };

    return withStreamingRetry(
      (attempt) =>
        withStreamTimeout(
          (signal) => this.executeStream(request, signal),
          {
            timeoutMs: request.timeoutMs ?? this.timeoutMs,
            signal: request.signal,
            operation: 'stream',
            provider: this.id,
          },
        ),
      {
        operation: 'stream',
        provider: this.id,
        policy,
        signal: request.signal,
        onRetry: this.onRetry,
      },
    );
  }

  /**
   * Stream one attempt of a chat-completions HTTP/SSE response, yielding
   * normalized events. Tool-call fragments are reassembled per index and
   * flushed (as complete `tool_call` events) after the stream terminates;
   * text deltas are always forwarded incrementally — never buffered until the
   * response ends. Structured-output requests re-use the DF-026A validator on
   * the accumulated text before the `completed` event is allowed.
   */
  private async *executeStream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent> {
    const response = await this.transport.postStream({
      path: ENDPOINT,
      body: this.buildStreamRequestBody(request),
      signal,
    });
    if (!response.body) {
      throw this.providerStreamError('Provider returned no stream body');
    }

    const toolCalls = new Map<number, ToolCallAccumulator>();
    let finishReason: FinishReason | undefined;
    let responseId: string | undefined;
    let model: string | undefined;
    let usageEmitted = false;
    let finished = false;
    let sawDone = false;
    let textBuffer = '';

    try {
      for await (const record of parseSse(readStreamBody(response.body, signal))) {
        const chunk = this.parseChunk(record);
        if (chunk === undefined) continue;

        if (typeof chunk.id === 'string' && responseId === undefined) {
          responseId = chunk.id;
        }
        if (typeof chunk.model === 'string' && model === undefined) {
          model = chunk.model;
        }
        if (chunk.usageEvents !== undefined && !usageEmitted) {
          usageEmitted = true;
          for (const usage of chunk.usageEvents) {
            yield { type: 'usage', ...usage, provider: this.id };
          }
        }
        if (chunk.text.length > 0) {
          textBuffer += chunk.text;
          yield { type: 'text_delta', text: chunk.text };
        }
        if (chunk.toolCalls.length > 0) {
          for (const toolCall of chunk.toolCalls) {
            accumulateToolCall(toolCalls, toolCall);
          }
        }
        if (chunk.finishReason !== undefined && !finished) {
          finishReason = chunk.finishReason;
          finished = true;
        }
        if (chunk.doneMark) {
          sawDone = true;
          break;
        }
      }
    } catch (error) {
      if (isModelProviderError(error)) throw error;
      const message =
        error instanceof Error ? error.message : String(error);
      throw this.providerStreamError(
        `Failed reading provider stream: ${this.transport.sanitize(message)}`,
      );
    }

    if (!sawDone && !finished) {
      throw new ModelProviderError(
        'Provider stream ended before completion was detected',
        { provider: this.id, code: 'PROVIDER_ERROR', retryable: false },
      );
    }

    let index = 0;
    for (const tool of toolCalls.values()) {
      if (tool.id !== undefined || tool.name !== undefined) {
        yield {
          type: 'tool_call',
          id: tool.id ?? `tool_${index}`,
          name: tool.name ?? 'unknown',
          arguments: tool.arguments,
        };
      }
      index += 1;
    }

    if (request.responseFormat) {
      this.validateStructuredResponse(request, textBuffer);
    }

    yield {
      type: 'completed',
      finishReason,
      id: responseId,
      model,
      provider: this.id,
    };
  }

  /** Translate the normalized request into a streaming request body. */
  private buildStreamRequestBody(request: ModelRequest): Record<string, unknown> {
    const body = this.buildRequestBody(request);
    body.stream = true;
    return body;
  }

  /**
   * Vendor-local parsing of a single SSE record into the pieces an
   * OpenAI-compatible chunk can contribute. Returns `undefined` for empty /
   * ignorable frames (e.g. keep-alives).
   */
  private parseChunk(record: SseRecord):
    | {
        text: string;
        id?: string;
        model?: string;
        usageEvents?: ModelUsage[];
        toolCalls: unknown[];
        finishReason?: FinishReason;
        doneMark: boolean;
      }
    | undefined {
    const data = record.data.trim();
    if (data.length === 0) return undefined;
    if (data === STREAM_DONE) {
      return { text: '', toolCalls: [], doneMark: true };
    }

    let json: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(data);
      if (!isRecord(parsed)) {
        throw new Error('chunk is not a JSON object');
      }
      json = parsed;
    } catch {
      const snippet = this.transport.sanitize(data.slice(0, 300));
      throw this.providerStreamError(`Malformed SSE chunk: ${snippet}`);
    }

    const chunk: {
      text: string;
      id?: string;
      model?: string;
      usageEvents?: ModelUsage[];
      toolCalls: unknown[];
      finishReason?: FinishReason;
      doneMark: boolean;
    } = { text: '', toolCalls: [], doneMark: false };

    if (typeof json.id === 'string') chunk.id = json.id;
    if (typeof json.model === 'string') chunk.model = json.model;
    const usage = extractUsage(json.usage);
    if (usage !== undefined) chunk.usageEvents = [usage];

    const choices = Array.isArray(json.choices) ? json.choices : [];
    for (const rawChoice of choices) {
      if (!isRecord(rawChoice)) continue;
      const delta = rawChoice.delta;
      if (isRecord(delta)) {
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          chunk.text += delta.content;
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const toolCall of delta.tool_calls) {
            chunk.toolCalls.push(toolCall);
          }
        }
      }
      if (typeof rawChoice.finish_reason === 'string') {
        chunk.finishReason = mapFinishReason(rawChoice.finish_reason);
      }
    }
    return chunk;
  }

  private providerStreamError(message: string): ModelProviderError {
    return new ModelProviderError(message, {
      provider: this.id,
      code: 'PROVIDER_ERROR',
      retryable: false,
    });
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