/**
 * Deterministic application-level model routing (DF-026C).
 *
 * A {@link ModelRouter} resolves a model role (`reasoning`, `coding`, `fast`)
 * to a concrete {@link ModelProvider} behind the normalized
 * {@link ModelConfig} contract. Resolution is deterministic and follows the
 * documented fallback order:
 *
 *   1. explicit role configuration
 *   2. default model configuration
 *   3. FakeModelProvider — only when `allowFakeFallback` is enabled
 *      (test/development configuration)
 *
 * A runtime API failure is never silently downgraded to a FakeModelProvider;
 * routing returns the configured (or default) provider and leaves failures
 * as real failures. Routed providers are cached per role so identical roles
 * yield identical instances.
 */

import type { ModelProvider, ModelSelectionRole } from './types.js';
import { ModelProviderError } from './errors.js';
import { createModelProviderFromConfig } from './factory.js';
import type { FetchFn } from './transport.js';
import type {
  ModelConfig,
  PartialModelConfig,
  RoleModelConfigMap,
} from './model-config.js';
import {
  MODEL_ROLES,
  isModelProviderKind,
  mergeModelConfig,
  redactModelConfig,
  validateModelConfig,
} from './model-config.js';

export type ModelRouteSource = 'explicit' | 'default' | 'fake';

/** Router options (all optional). */
export interface ModelRouterOptions {
  /** Default model configuration (fallback #2). */
  readonly defaultConfig?: PartialModelConfig;
  /** Explicit per-role configuration, merged over the default (fallback #1). */
  readonly roleConfigs?: RoleModelConfigMap;
  /** Allow FakeModelProvider when no configuration resolves (test/dev only). */
  readonly allowFakeFallback?: boolean;
  /** Injectable fetch, forwarded to provider construction (tests). */
  readonly fetchFn?: FetchFn;
}

/** A fully resolved model route for one role. */
export interface ResolvedModelRoute {
  readonly role: ModelSelectionRole;
  /** Which fallback step produced the route. */
  readonly source: ModelRouteSource;
  /** The merged normalized configuration. */
  readonly config: ModelConfig;
  /** The provider constructed for this route. */
  readonly provider: ModelProvider;
}

/** Raised when a role cannot be resolved to a provider. */
export class ModelRouterError extends Error {
  readonly code: 'MODEL_NOT_CONFIGURED' | 'INVALID_PROVIDER_CONFIG';

  constructor(
    message: string,
    code: ModelRouterError['code'] = 'MODEL_NOT_CONFIGURED',
  ) {
    super(message);
    this.name = 'ModelRouterError';
    this.code = code;
  }
}

export function isModelRouterError(error: unknown): error is ModelRouterError {
  return error instanceof ModelRouterError;
}

const FAKE_FALLBACK_CONFIG: ModelConfig = { provider: 'fake' };

/**
 * Resolve the merged configuration for a role. Pure and deterministic:
 * `roleConfigs[role]` merged over `defaultConfig`, or `undefined` when
 * nothing is configured.
 */
export function resolveRoleConfig(
  options: ModelRouterOptions,
  role: ModelSelectionRole,
): PartialModelConfig | undefined {
  const { defaultConfig, roleConfigs } = options;
  const roleConfig = roleConfigs?.[role];
  if (!defaultConfig && !roleConfig) return undefined;
  return mergeModelConfig(defaultConfig ?? {}, roleConfig);
}

/** Classify a route source (only used inside the router). */
function routeSource(
  role: ModelSelectionRole,
  roleConfigs: ModelRouterOptions['roleConfigs'],
  defaultConfig: ModelRouterOptions['defaultConfig'],
  allowFakeFallback: boolean,
): { config: PartialModelConfig; source: ModelRouteSource } | undefined {
  const resolved = resolveRoleConfig({ defaultConfig, roleConfigs }, role);
  if (resolved) {
    return { config: resolved, source: roleConfigs?.[role] ? 'explicit' : 'default' };
  }
  if (allowFakeFallback) {
    return { config: FAKE_FALLBACK_CONFIG, source: 'fake' };
  }
  return undefined;
}

/**
 * Application-facing model router. Resolves roles deterministically and
 * wraps the normalized provider factory so callers never touch adapters.
 */
export class ModelRouter {
  private readonly options: ModelRouterOptions;
  private readonly cache = new Map<ModelSelectionRole, ModelProvider>();

  constructor(options: ModelRouterOptions = {}) {
    this.options = options;
  }

  /** True when a role can be resolved (configured or fake fallback allowed). */
  has(role: ModelSelectionRole): boolean {
    return routeSource(role, this.options.roleConfigs, this.options.defaultConfig, this.options.allowFakeFallback === true)
      ? true
      : false;
  }

  /** The roles that currently resolve to a provider, in stable order. */
  list(): readonly ModelSelectionRole[] {
    return MODEL_ROLES.filter((role) => this.has(role)).map((role) => role);
  }

  /** Resolved merged configuration for a role, or undefined. */
  configFor(role: ModelSelectionRole): ModelConfig | undefined {
    const route = routeSource(role, this.options.roleConfigs, this.options.defaultConfig, this.options.allowFakeFallback === true);
    if (!route) return undefined;
    if (route.source === 'fake') return FAKE_FALLBACK_CONFIG;
    return this.normalizeComplete(route.config, role);
  }

  /**
   * Select the provider for a role. Deterministic; subsequent calls for the
   * same role return the same provider instance. Throws {@link ModelRouterError}
   * when the role has no configuration.
   */
  select(role: ModelSelectionRole): ModelProvider {
    const cached = this.cache.get(role);
    if (cached) return cached;

    const route = routeSource(role, this.options.roleConfigs, this.options.defaultConfig, this.options.allowFakeFallback === true);
    if (!route) {
      throw new ModelRouterError(
        `No model configured for role "${role}". Set DEVFORGE_MODEL_* or a role-specific DEVFORGE_${role.toUpperCase()}_MODEL.`,
      );
    }

    if (route.source === 'fake') {
      const fake = createModelProviderFromConfig(FAKE_FALLBACK_CONFIG, this.options.fetchFn);
      this.cache.set(role, fake);
      return fake;
    }

    const config = this.normalizeComplete(route.config, role);
    const validation = validateModelConfig(config);
    if (!validation.ok) {
      throw new ModelRouterError(
        `Invalid model config for role "${role}": ${validation.issues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('; ')}`,
        'INVALID_PROVIDER_CONFIG',
      );
    }

    const provider = createModelProviderFromConfig(config, this.options.fetchFn);
    this.cache.set(role, provider);
    return provider;
  }

  /** Full resolved route (source, config, provider) for one role. */
  resolve(role: ModelSelectionRole): ResolvedModelRoute {
    const route = routeSource(role, this.options.roleConfigs, this.options.defaultConfig, this.options.allowFakeFallback === true);
    if (!route) {
      throw new ModelRouterError(
        `No model configured for role "${role}". Set DEVFORGE_MODEL_* or a role-specific DEVFORGE_${role.toUpperCase()}_MODEL.`,
      );
    }
    if (route.source === 'fake') {
      return {
        role,
        source: 'fake',
        config: FAKE_FALLBACK_CONFIG,
        provider: this.select(role),
      };
    }
    const config = this.normalizeComplete(route.config, role);
    return {
      role,
      source: route.source,
      config,
      provider: this.select(role),
    };
  }

  /** Redacted config for display purposes (never leaks apiKey). */
  redactedConfigFor(role: ModelSelectionRole): PartialModelConfig | undefined {
    const config = this.configFor(role);
    return config ? redactModelConfig(config) : undefined;
  }

  private normalizeComplete(
    config: PartialModelConfig,
    role: ModelSelectionRole,
  ): ModelConfig {
    if (!config.provider) {
      throw new ModelRouterError(
        `No provider configured for role "${role}". Set DEVFORGE_MODEL_PROVIDER.`,
      );
    }
    if (!isModelProviderKind(config.provider)) {
      throw new ModelRouterError(
        `Unknown provider "${String(config.provider)}" for role "${role}".`,
        'INVALID_PROVIDER_CONFIG',
      );
    }
    const complete: ModelConfig = {
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
    };
    return complete;
  }
}

/** Convenience factory for a {@link ModelRouter}. */
export function createModelRouter(
  options?: ModelRouterOptions,
): ModelRouter {
  return new ModelRouter(options);
}