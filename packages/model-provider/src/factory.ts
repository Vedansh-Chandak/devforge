/**
 * Provider factory + registry (DF-026B).
 *
 * Maps a normalized `provider` kind + config to a concrete adapter behind the
 * {@link ModelProvider} contract. Application-level wiring (Brain, Planner,
 * cli) never references concrete adapters; they consume whichever provider is
 * constructed here.
 *
 * OpenRouter and other OpenAI-compatible endpoints are NOT modeled as a
 * separate provider kind — they are reached through the
 * `openai-compatible` adapter with a configurable `baseUrl`.
 */

import type { ModelProvider } from './types.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { OpenAICompatibleProviderConfig } from './openai-compatible.js';
import { GeminiProvider } from './gemini.js';
import type { GeminiProviderConfig } from './gemini.js';
import { AnthropicProvider } from './anthropic.js';
import type { AnthropicProviderConfig } from './anthropic.js';
import { FakeModelProvider } from './testing/fake-provider.js';
import type { ModelConfig } from './model-config.js';
import { validateModelConfig } from './model-config.js';
import { ModelProviderError } from './errors.js';
import type { FetchFn } from './transport.js';

export type ProviderKind = 'openai-compatible' | 'gemini' | 'anthropic';

export interface ProviderConfigMap {
  'openai-compatible': OpenAICompatibleProviderConfig;
  gemini: GeminiProviderConfig;
  anthropic: AnthropicProviderConfig;
}

/** Static provider metadata (name + advertised capabilities). */
export interface ProviderInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly openAICompatible: boolean;
}

const PROVIDER_INFO: Readonly<Record<ProviderKind, ProviderInfo>> = {
  'openai-compatible': {
    id: 'openai-compatible',
    name: 'OpenAI-compatible',
    description:
      'Chat-completions transport for OpenAI and any compatible endpoint ' +
      '(OpenRouter, Groq, Ollama, LM Studio, vLLM, …) via configurable baseUrl.',
    openAICompatible: true,
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    description: 'Google Gemini generateContent REST adapter.',
    openAICompatible: false,
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Anthropic Messages REST adapter.',
    openAICompatible: false,
  },
};

/** List of supported provider kinds, in declaration order. */
export function listProviderKinds(): readonly ProviderKind[] {
  return Object.keys(PROVIDER_INFO) as readonly ProviderKind[];
}

/** Static metadata for a provider kind. */
export function getProviderInfo(kind: ProviderKind): ProviderInfo {
  return PROVIDER_INFO[kind];
}

/**
 * Construct a {@link ModelProvider} from a normalized provider kind and its
 * configuration. `fetchFn` is injectable for deterministic tests and may be
 * overridden per-adapter via `config.fetch`.
 */
export function createModelProvider<K extends ProviderKind>(
  kind: K,
  config: ProviderConfigMap[K],
  fetchFn?: FetchFn,
): ModelProvider;

/**
 * Application-facing factory overload: construct a {@link ModelProvider}
 * directly from a normalized {@link ModelConfig}. This is the single
 * application-facing entry point — callers never name concrete adapters.
 *
 * @example
 * ```ts
 * const provider = createModelProvider({
 *   provider: 'openai-compatible',
 *   model: 'openai/gpt-oss-120b:free',
 *   baseUrl: 'https://openrouter.ai/api/v1',
 *   apiKey: process.env.DEVFORGE_MODEL_API_KEY,
 * });
 * ```
 */
export function createModelProvider(
  config: ModelConfig,
  fetchFn?: FetchFn,
): ModelProvider;

export function createModelProvider(
  kindOrConfig: ProviderKind | ModelConfig,
  configOrFetch?: ProviderConfigMap[ProviderKind] | FetchFn,
  maybeFetch?: FetchFn,
): ModelProvider {
  if (typeof kindOrConfig === 'string') {
    const kind = kindOrConfig as ProviderKind;
    const config = configOrFetch as ProviderConfigMap[ProviderKind];
    const fetchFn = maybeFetch;
    switch (kind) {
      case 'openai-compatible':
        return new OpenAICompatibleProvider(
          config as OpenAICompatibleProviderConfig,
          fetchFn,
        );
      case 'gemini':
        return new GeminiProvider(config as GeminiProviderConfig, fetchFn);
      case 'anthropic':
        return new AnthropicProvider(config as AnthropicProviderConfig, fetchFn);
    }
  }

  const config = kindOrConfig as ModelConfig;
  const fetchFn = configOrFetch as FetchFn | undefined;
  return createModelProviderFromConfig(config, fetchFn);
}

/**
 * Build a provider from a normalized {@link ModelConfig}. Validates the
 * config first (throwing a non-retryable `INVALID_REQUEST` on failure) and
 * maps `fake` to a {@link FakeModelProvider}. Deterministic.
 */
export function createModelProviderFromConfig(
  config: ModelConfig,
  fetchFn?: FetchFn,
): ModelProvider {
  const validation = validateModelConfig(config);
  if (!validation.ok) {
    const detail = validation.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('; ');
    throw new ModelProviderError(
      `Invalid model config — ${detail}`,
      { provider: 'config', code: 'INVALID_REQUEST', retryable: false },
    );
  }

  const kind = config.provider;

  if (kind === 'fake') {
    return new FakeModelProvider(
      config.fakeResponse
        ? {
            response: {
              content: config.fakeResponse.content ?? 'Fake response',
              model: config.fakeResponse.model ?? 'fake-model',
              finishReason: 'stop',
              usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
            },
          }
        : undefined,
    );
  }

  if (kind === 'openai-compatible') {
    if (!config.baseUrl) {
      throw new ModelProviderError('baseUrl is required', {
        provider: kind,
        code: 'INVALID_REQUEST',
        retryable: false,
      });
    }
    return new OpenAICompatibleProvider(
      {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model!,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
      },
      fetchFn,
    );
  }

  if (kind === 'gemini') {
    return new GeminiProvider(
      {
        model: config.model!,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
      },
      fetchFn,
    );
  }

  if (kind === 'anthropic') {
    return new AnthropicProvider(
      {
        model: config.model!,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
      },
      fetchFn,
    );
  }

  throw new ModelProviderError(
    `Unknown provider: "${String(kind)}". Supported: openai-compatible, gemini, anthropic, fake`,
    { provider: 'config', code: 'INVALID_REQUEST', retryable: false },
  );
}