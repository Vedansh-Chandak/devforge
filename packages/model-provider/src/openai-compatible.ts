import { BaseModelProvider } from './provider.js';
import type {
  ModelRequest,
  ModelResponse,
  FinishReason,
} from './types.js';
import { ModelProviderError } from './errors.js';

/**
 * Configuration for the OpenAI-compatible provider.
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
   * Model name to send in the request body (e.g. "gpt-4o", "gpt-3.5-turbo").
   */
  model: string;

  /**
   * Request timeout in milliseconds. Default: 60000 (60 seconds).
   */
  timeoutMs?: number;

  /**
   * Additional HTTP headers to include in every request.
   * Cannot override Authorization (set via apiKey).
   */
  headers?: Record<string, string>;
}

/** Fetch function signature for dependency injection and testing. */
export type FetchFn = typeof fetch;

const PROVIDER_ID = 'openai-compatible';

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

/**
 * Maps HTTP status codes and response bodies to ModelProviderError codes.
 */
function mapHttpStatusToErrorCode(
  status: number,
  responseBody?: Record<string, unknown>,
): { code: import('./errors.js').ModelErrorCode; retryable: boolean } {
  switch (status) {
    case 401:
    case 403:
      return { code: 'AUTHENTICATION_ERROR', retryable: false };
    case 404:
      return { code: 'MODEL_NOT_FOUND', retryable: false };
    case 429:
      return { code: 'RATE_LIMITED', retryable: true };
    case 400:
      return { code: 'INVALID_REQUEST', retryable: false };
    default:
      if (status >= 500) {
        return { code: 'PROVIDER_ERROR', retryable: true };
      }
      return { code: 'UNKNOWN', retryable: false };
  }
}

/**
 * Sanitize a URL for safe error messages — strips query params and auth info.
 */
function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return '[invalid URL]';
  }
}

/**
 * Extract a safe error message from an HTTP error response.
 * Strips any potential credential information.
 */
async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as Record<string, unknown>;
    const errorObj = body.error as Record<string, unknown> | undefined;
    const message = errorObj?.message;
    if (typeof message === 'string') {
      return message.slice(0, 500);
    }
    return `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/**
 * Provider for OpenAI-compatible chat-completion endpoints.
 *
 * Works with OpenAI, OpenRouter, Groq, Ollama, LM Studio, vLLM,
 * and any other service implementing the OpenAI chat-completions API.
 *
 * Does NOT require vendor SDKs — uses native `fetch`.
 *
 * ## Endpoint contract
 *
 * `baseUrl` is the API root (e.g. "https://api.openai.com/v1").
 * The provider appends "/chat/completions" to produce the full endpoint.
 *
 * ## Configuration
 *
 * ```ts
 * const provider = new OpenAICompatibleProvider({
 *   baseUrl: 'https://api.openai.com/v1',
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'gpt-4o',
 *   timeoutMs: 30_000,
 * });
 * ```
 */
export class OpenAICompatibleProvider extends BaseModelProvider {
  readonly id = PROVIDER_ID;

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly extraHeaders: Record<string, string>;
  private readonly fetchFn: FetchFn;

  constructor(
    config: OpenAICompatibleProviderConfig,
    fetchFn?: FetchFn,
  ) {
    super();

    if (!config.baseUrl) {
      throw new ModelProviderError('baseUrl is required', {
        provider: PROVIDER_ID,
        code: 'INVALID_REQUEST',
      });
    }
    if (!config.model) {
      throw new ModelProviderError('model is required', {
        provider: PROVIDER_ID,
        code: 'INVALID_REQUEST',
      });
    }

    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.extraHeaders = { ...config.headers };
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.validateRequest(request);

    const endpoint = `${this.baseUrl}/chat/completions`;

    // Build request body — only include optional fields when provided
    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages,
    };
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    // Timeout via internal AbortController, combined with any external signal.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    const externalSignal = request.signal;
    const onExternalAbort = (): void => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timeoutId);
        throw new ModelProviderError('Request cancelled before it started', {
          provider: this.id,
          code: 'CANCELLED',
          retryable: false,
        });
      }
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    let response: Response;
    try {
      response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }

      if (externalSignal?.aborted) {
        throw new ModelProviderError('Model request cancelled', {
          provider: this.id,
          code: 'CANCELLED',
          retryable: false,
          cause: error instanceof Error ? error : undefined,
        });
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new ModelProviderError(
          `Request to ${sanitizeUrl(endpoint)} timed out after ${this.timeoutMs}ms`,
          {
            provider: this.id,
            code: 'TIMEOUT',
            retryable: true,
            cause: error instanceof Error ? error : undefined,
          },
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new ModelProviderError(
        `Network error calling ${sanitizeUrl(endpoint)}: ${message}`,
        {
          provider: this.id,
          code: 'NETWORK_ERROR',
          retryable: true,
          cause: error instanceof Error ? error : undefined,
        },
      );
    } finally {
      clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }

    // Handle non-2xx responses
    if (!response.ok) {
      const errorMessage = await extractErrorMessage(response);
      const { code, retryable } = mapHttpStatusToErrorCode(response.status);

      throw new ModelProviderError(
        `Provider error (${response.status}): ${errorMessage}`,
        {
          provider: this.id,
          code,
          retryable,
        },
      );
    }

    // Parse response
    let json: Record<string, unknown>;
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new ModelProviderError(
        'Failed to parse provider response as JSON',
        {
          provider: this.id,
          code: 'PROVIDER_ERROR',
          retryable: false,
        },
      );
    }

    // Extract content from choices
    const choices = json.choices as Array<Record<string, unknown>> | undefined;
    if (!choices || choices.length === 0) {
      throw new ModelProviderError('Provider returned no choices', {
        provider: this.id,
        code: 'PROVIDER_ERROR',
        retryable: false,
      });
    }

    const choice = choices[0]!;
    const message = choice.message as Record<string, unknown> | undefined;
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

    // Map finish reason
    const finishReason = mapFinishReason(
      choice.finish_reason as string | null | undefined,
    );

    // Map usage
    const rawUsage = json.usage as Record<string, number> | undefined;
    const usage = rawUsage
      ? {
          inputTokens: rawUsage.prompt_tokens,
          outputTokens: rawUsage.completion_tokens,
          totalTokens: rawUsage.total_tokens,
        }
      : undefined;

    return {
      content: message.content,
      model: typeof json.model === 'string' ? json.model : undefined,
      finishReason,
      usage,
    };
  }
}