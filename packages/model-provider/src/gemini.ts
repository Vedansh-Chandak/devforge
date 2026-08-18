/**
 * Gemini provider adapter (DF-026B).
 *
 * Implements the normalized {@link ModelProvider} contract over Google's
 * `generateContent` REST API. All Gemini-specific request/response
 * translation stays inside this file — Brain, Planner, and the rest of the
 * application only see normalized requests and responses.
 *
 *  - REST call: `POST {baseUrl}/v1beta/models/{model}:generateContent`
 *  - auth: `x-goog-api-key` header (keeps the credential out of URLs)
 *  - response tokens normalized onto {@link ModelUsage}
 *  - structured output via `responseMimeType` + `responseSchema`, validated
 *    provider-independently by the DF-026A schema validator
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
import type { JsonPropertySchema, StructuredOutputSchema } from './structured.js';
import {
  classifyHttpStatus,
  extractErrorMessage,
  extractErrorStatus,
  HttpTransport,
} from './transport.js';
import type { FetchFn, HttpStatusClassification } from './transport.js';

export interface GeminiProviderConfig {
  /** Default model id (e.g. "gemini-2.5-flash"). */
  model: string;
  /** API credential. Injected via `x-goog-api-key`; never logged. */
  apiKey?: string;
  /** API root. Defaults to https://generativelanguage.googleapis.com */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default 60000. */
  timeoutMs?: number;
  /** Maximum retries for retryable failures. Default 2. */
  maxRetries?: number;
  /** Backoff tuning for the shared retry policy. */
  retryPolicy?: RetryPolicy;
  /** Additional HTTP headers. Cannot override the auth header. */
  headers?: Record<string, string>;
  /** Injectable fetch for deterministic tests. */
  fetch?: FetchFn;
  /** Observability hook invoked before each retry. Never receives secrets. */
  onRetry?: RetryOptions['onRetry'];
}

const PROVIDER_ID = 'gemini';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const GENERATE_CONTENT_PATH = '/v1beta/models/:model:generateContent';

/**
 * Gemini REST returns 400 for several auth-shaped defects (bad key, SDK
 * miswiring). Detect those cases so they normalize to `AUTHENTICATION_ERROR`
 * rather than an invalid request.
 */
export function geminiClassifyHttpStatus(
  status: number,
  body?: Record<string, unknown>,
): HttpStatusClassification {
  const base = classifyHttpStatus(status);
  if (status !== 400 && status !== 403) return base;

  const statusText = extractErrorStatus(body)?.toLowerCase() ?? '';
  const message = (extractErrorMessage(body) ?? '').toLowerCase();
  const authShaped =
    statusText.includes('permission_denied') ||
    statusText.includes('unauthenticated') ||
    /api ?key|x-goog-api-key|permission ?denied|unauth/.test(message);
  if (authShaped) {
    return { code: 'AUTHENTICATION_ERROR', retryable: false };
  }
  return base;
}

/** Map Gemini finish reasons onto normalized {@link FinishReason} values. */
export function mapGeminiFinishReason(
  raw: string | null | undefined,
): FinishReason {
  switch (raw) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
      return 'content_filter';
    default:
      return 'unknown';
  }
}

/** Map Gemini token counts onto {@link ModelUsage}. Undefined counts stay null. */
export function extractGeminiUsage(raw: unknown): ModelUsage | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const usage = raw as Record<string, number>;
  const out: ModelUsage = {};
  if (typeof usage.promptTokenCount === 'number') out.inputTokens = usage.promptTokenCount;
  if (typeof usage.candidatesTokenCount === 'number') out.outputTokens = usage.candidatesTokenCount;
  if (typeof usage.totalTokenCount === 'number') out.totalTokens = usage.totalTokenCount;
  return Object.keys(out).length === 0 ? undefined : out;
}

/** Translate the normalized request messages into Gemini `contents`. */
export function toGeminiContents(messages: readonly ModelMessage[]): {
  contents: ReadonlyArray<Record<string, unknown>>;
  systemInstruction?: string;
  systemParts: Array<Record<string, unknown>>;
} {
  const contents: Array<Record<string, unknown>> = [];
  const systemParts: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push({ text: message.content });
      continue;
    }
    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    });
  }

  return {
    contents,
    systemInstruction:
      systemParts.length > 0
        ? systemParts
            .map((part) => part.text as string)
            .join('\n')
        : undefined,
    systemParts,
  };
}

/** Translate the DF-026A schema subset into Gemini's `responseSchema`. */
export function toGeminiResponseSchema(schema: StructuredOutputSchema): Record<string, unknown> {
  return toGeminiPropertySchema(schema) as Record<string, unknown>;
}

function toGeminiPropertySchema(property: JsonPropertySchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: toGeminiType(property.type) };
  if (property.properties !== undefined) {
    const properties: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(property.properties)) {
      properties[key] = toGeminiPropertySchema(child);
    }
    out.properties = properties;
  }
  if (property.required !== undefined && property.required.length > 0) {
    out.required = [...property.required];
  }
  if (property.items !== undefined) {
    out.items = toGeminiPropertySchema(property.items);
  }
  return out;
}

function toGeminiType(type: JsonPropertySchema['type']): string {
  const name = Array.isArray(type) ? type[0] : type;
  switch (name) {
    case 'string':
    case 'null':
      return 'STRING';
    case 'number':
    case 'integer':
      return 'NUMBER';
    case 'boolean':
      return 'BOOLEAN';
    case 'object':
      return 'OBJECT';
    case 'array':
      return 'ARRAY';
    default:
      return 'STRING';
  }
}

/**
 * Adapter over Google's Gemini `generateContent` REST API.
 * All Gemini-specific conversion is confined to this class.
 */
export class GeminiProvider extends BaseModelProvider {
  readonly id = PROVIDER_ID;

  private readonly transport: HttpTransport;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly retryPolicy?: RetryPolicy;
  private readonly onRetry?: RetryOptions['onRetry'];

  constructor(config: GeminiProviderConfig, fetchFn?: FetchFn) {
    super();
    assertValidProviderConfig(config);

    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.retryPolicy = config.retryPolicy;
    this.onRetry = config.onRetry;

    this.transport = new HttpTransport({
      provider: PROVIDER_ID,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: config.apiKey,
      auth: { scheme: 'header', name: 'x-goog-api-key' },
      extraHeaders: config.headers,
      fetchFn: fetchFn ?? config.fetch ?? globalThis.fetch.bind(globalThis),
      secrets: typeof config.apiKey === 'string' ? [config.apiKey] : [],
      classify: geminiClassifyHttpStatus,
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
    const path = GENERATE_CONTENT_PATH.replace(':model', encodeURIComponent(request.model ?? this.model));
    const json = (await this.transport.post({
      path,
      body: this.buildRequestBody(request),
      signal,
    })) as Record<string, unknown>;

    const response = this.parseResponse(json);
    this.validateStructuredResponse(request, response.content);
    return response;
  }

  /** Translate the normalized request into the Gemini `generateContent` body. */
  private buildRequestBody(request: ModelRequest): Record<string, unknown> {
    const { contents, systemInstruction } = toGeminiContents(request.messages);

    const body: Record<string, unknown> = { contents };
    if (systemInstruction !== undefined) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) {
      generationConfig.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = request.maxTokens;
    }
    if (request.responseFormat) {
      generationConfig.responseMimeType = 'application/json';
      if (request.responseFormat.type === 'json_schema') {
        generationConfig.responseSchema = toGeminiResponseSchema(
          request.responseFormat.schema,
        );
      }
    }
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }
    return body;
  }

  /** Normalize a Gemini `generateContent` body into a {@link ModelResponse}. */
  private parseResponse(json: Record<string, unknown>): ModelResponse {
    const candidates = json.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new ModelProviderError('Provider returned no candidates', {
        provider: this.id,
        code: 'PROVIDER_ERROR',
        retryable: false,
      });
    }

    const candidate = candidates[0] as Record<string, unknown> | undefined;
    const content = candidate?.content as Record<string, unknown> | undefined;
    const parts = content?.parts;
    if (!Array.isArray(parts)) {
      throw new ModelProviderError('Provider returned no content', {
        provider: this.id,
        code: 'PROVIDER_ERROR',
        retryable: false,
      });
    }

    const text = parts
      .filter((part): part is Record<string, unknown> => typeof part === 'object' && part !== null)
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
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
      model: typeof json.modelVersion === 'string' ? json.modelVersion : undefined,
      finishReason: mapGeminiFinishReason(
        candidate?.finishReason as string | null | undefined,
      ),
      id: typeof json.id === 'string' ? json.id : undefined,
      provider: this.id,
      usage: extractGeminiUsage(json.usageMetadata),
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