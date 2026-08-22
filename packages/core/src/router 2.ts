/**
 * App-level ModelRouter facade (DF-026C).
 *
 * Builds a deterministic {@link ModelRouter} from application config:
 * the default provider config becomes the default route, and role-specific
 * model ids (roleModels) become per-role routes that inherit the provider
 * config. This module is the only place at the app level that assembles the
 * router; components consume `HasModelRouter`.
 */

import { ModelRouter } from '@devforge/model-provider';
import type { ModelConfig, ModelRouterOptions } from '@devforge/model-provider';
import type { ModelProviderConfig, RoleModelsConfig } from './types.js';

/** Router constructed from application configuration. */
export interface DevForgeModelRouter {
  readonly router: ModelRouter;
}

/**
 * Build a {@link ModelRouter} from app-level config.
 *
 * @param model - default provider configuration.
 * @param roleModels - role-specific model ids (optional). Each role inherits
 *   the default provider config and overrides only the model identifier.
 * @param manual - extra catchall token (future-proofing; unused today).
 */
export function createModelRouterFromConfig(
  model: ModelProviderConfig,
  roleModels?: RoleModelsConfig,
): ModelRouter {
  const defaultConfig = normalizeForRouter(model);

  // roleConfigs is typed Readonly upstream; we build it locally then hand it
  // over (the object itself is never mutated after construction).
  const roleConfigs: Partial<Record<'reasoning' | 'coding' | 'fast', ModelConfig>> = {};
  if (roleModels) {
    for (const role of ['reasoning', 'coding', 'fast'] as const) {
      const roleModel = roleModels[role];
      if (roleModel && roleModel.trim().length > 0) {
        roleConfigs[role] = { ...defaultConfig, model: roleModel };
      }
    }
  }

  return new ModelRouter({
    defaultConfig,
    roleConfigs: roleConfigs as NonNullable<ModelRouterOptions['roleConfigs']>,
    // Fake fallback is a test/dev convenience; application config that
    // selects a real provider must surface a routing error instead.
    allowFakeFallback: model.provider === 'fake',
  });
}

function normalizeForRouter(config: ModelProviderConfig): ModelConfig {
  switch (config.provider) {
    case 'fake':
      return { provider: 'fake' };
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
    case 'anthropic':
      return {
        provider: config.provider,
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
      };
  }
}