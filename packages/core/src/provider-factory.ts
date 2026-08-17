/**
 * Provider Factory — creates ModelProvider instances from configuration.
 *
 * This is the ONLY place in the application that knows about concrete
 * provider implementations. Brain, Runtime, and Prompt Composer
 * remain unaware of provider types.
 */

import type { ModelProviderInterface } from '@devforge/brain';
import { FakeModelProvider, OpenAICompatibleProvider } from '@devforge/model-provider';
import type { ModelProviderConfig, FakeProviderConfig, OpenAICompatibleProviderConfig } from './types.js';
import { DevForgeConfigError } from './types.js';

/**
 * Create a ModelProvider from configuration.
 * @throws {DevForgeConfigError} if configuration is invalid
 */
export function createModelProvider(config: ModelProviderConfig): ModelProviderInterface {
  switch (config.provider) {
    case 'fake':
      return createFakeProvider(config);
    case 'openai-compatible':
      return createOpenAICompatibleProvider(config);
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

function createFakeProvider(config: FakeProviderConfig): FakeModelProvider {
  return new FakeModelProvider({
    response: config.response
      ? {
          content: config.response.content ?? 'Fake response',
          model: config.response.model ?? 'fake-model',
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        }
      : undefined,
  });
}

function createOpenAICompatibleProvider(config: OpenAICompatibleProviderConfig): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: config.timeoutMs,
  });
}