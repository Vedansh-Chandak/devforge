/**
 * Provider Factory — creates ModelProvider instances from configuration.
 *
 * This is the ONLY place in the application that knows about concrete
 * provider implementations. Brain, Runtime, and Prompt Composer
 * remain unaware of provider types. Construction details (option mapping,
 * base URL defaults, retries) are delegated to the normalized factory in
 * `@devforge/model-provider`; this module only adapts the app-level config
 * shape and keeps the `ModelProviderInterface` contract.
 */

import type { ModelProviderInterface } from '@devforge/brain';
import { createModelProviderFromConfig } from '@devforge/model-provider';
import type { ModelProvider } from '@devforge/model-provider';
import type { ModelConfig, ModelProviderKind } from '@devforge/model-provider';
import type { ModelProviderConfig } from './types.js';
import { DevForgeConfigError } from './types.js';

/**
 * Create a ModelProvider from configuration.
 * @throws {DevForgeConfigError} if configuration is invalid
 */
export function createModelProvider(config: ModelProviderConfig): ModelProviderInterface {
  const normalized = normalizeProviderConfig(config);
  try {
    return createModelProviderFromConfig(normalized);
  } catch (error) {
    if (error instanceof DevForgeConfigError) {
      throw error;
    }
    throw new DevForgeConfigError(
      error instanceof Error ? error.message : String(error),
      'model.provider',
      'PROVIDER_VALIDATION_ERROR',
    );
  }
}

/**
 * Create a raw `@devforge/model-provider` ModelProvider from configuration.
 * Used by the app-level router; identical construction path to
 * {@link createModelProvider} but without the Brain interface mapping.
 */
export function createRawModelProvider(config: ModelProviderConfig): ModelProvider {
  const normalized = normalizeProviderConfig(config);
  return createModelProviderFromConfig(normalized);
}

function normalizeProviderConfig(config: ModelProviderConfig): ModelConfig {
  switch (config.provider) {
    case 'fake':
      return {
        provider: 'fake',
        fakeResponse: config.response
          ? {
              content: config.response.content,
              model: config.response.model,
            }
          : undefined,
      };
    case 'openai-compatible':
      return {
        provider: 'openai-compatible',
        model: config.model,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
      };
    case 'gemini':
    case 'anthropic': {
      const kind: ModelProviderKind = config.provider;
      return {
        provider: kind,
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
      };
    }
    default: {
      const _exhaustive: never = config;
      throw new DevForgeConfigError(
        `Unknown provider: "${String(_exhaustive)}"`,
        'model.provider',
        'UNKNOWN_PROVIDER',
      );
    }
  }
}