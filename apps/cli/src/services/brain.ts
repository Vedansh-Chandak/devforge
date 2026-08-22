/**
 * @vedansh78/cli — Brain Service (M1).
 *
 * Creates the model provider from configuration, initializes the DevForgeRuntime
 * and DevForgeBrain, and exposes a simple ask() method. Provider construction
 * is delegated to the unified `@devforge/model-provider` factory (DF-026C);
 * role-based routing flows through a ModelRouter built from config.
 */

import type { ModelProvider, ModelSelectionRole } from '@devforge/model-provider';
import { createModelProviderFromConfig, ModelRouter } from '@devforge/model-provider';
import type { PartialModelConfig } from '@devforge/model-provider';
import { DevForgeRuntime } from '@devforge/runtime';
import { DevForgeBrain } from '@devforge/brain';
import type { DevForgeConfig } from '../types.js';
import { logger } from '../utils/logger.js';

/** Provider factory options derived from CLI config. */
export interface ProviderFactoryOptions {
  readonly kind: 'fake' | 'openai-compatible' | 'gemini' | 'anthropic';
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly temperature?: number;
}

/**
 * Create a ModelProvider from the given options.
 * Delegates construction to the unified normalized factory
 * (`@devforge/model-provider`). Wraps generate() to inject temperature from
 * options when not explicitly provided.
 */
export function createProvider(opts: ProviderFactoryOptions): ModelProvider {
  const base: ModelProvider = createModelProviderFromConfig({
    provider: opts.kind,
    model: opts.model,
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    timeoutMs: opts.timeoutMs,
    maxRetries: opts.maxRetries,
  });

  // Wrap to inject temperature if not present in request
  const temp = opts.temperature ?? 0.2;
  return {
    ...base,
    generate: async (request) => {
      if (request.temperature === undefined) {
        return base.generate({ ...request, temperature: temp });
      }
      return base.generate(request);
    },
  };
}

/**
 * Build a ModelRouter from CLI config: default route from the provider block,
 * plus per-role overrides from `roleModels`. Fake configs allow the fake
 * fallback; real provider configs surface routing errors instead.
 */
export function createRouterFromConfig(config: DevForgeConfig): ModelRouter {
  const defaultConfig = {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  };

  const roleConfigs: Partial<Record<ModelSelectionRole, PartialModelConfig>> = {};
  for (const role of ['reasoning', 'coding', 'fast'] as const) {
    const roleModel = config.roleModels?.[role];
    if (roleModel && roleModel.trim().length > 0) {
      roleConfigs[role] = { ...defaultConfig, model: roleModel };
    }
  }

  return new ModelRouter({
    defaultConfig,
    roleConfigs,
    // Fake fallback is a test/dev convenience; real provider configs surface
    // routing errors instead of silently degrading.
    allowFakeFallback: config.provider === 'fake',
  });
}

/** Service interface for brain operations. */
export interface BrainService {
  readonly brain: DevForgeBrain;
  readonly runtime: DevForgeRuntime;
  /** Ask the brain a question, returning the full AskResult. */
  ask(question: string, options?: { signal?: AbortSignal }): Promise<import('@devforge/brain').AskResult>;
  /** Dispose of the brain and runtime. */
  dispose(): Promise<void>;
}

/**
 * Build a BrainService from CLI config and repository root.
 * Creates the router, runtime, and brain (router-injected); initializes them.
 * A pre-built `router` can be supplied so callers share one instance across
 * services.
 */
export async function createBrainService(
  config: DevForgeConfig,
  repoRoot: string,
  signal?: AbortSignal,
  options?: { router?: ModelRouter },
): Promise<BrainService> {
  const router = options?.router ?? createRouterFromConfig(config);

  const runtime = new DevForgeRuntime({ workspaceRoot: repoRoot });
  const brain = new DevForgeBrain({ runtime, router, maxContextChars: 200_000 });

  await runtime.initialize();
  await brain.initialize();

  logger.debug('Brain service initialized', {
    provider: config.provider,
    roles: router.list(),
    repoRoot,
  });

  return {
    brain,
    runtime,
    async ask(question: string, options?: { signal?: AbortSignal }) {
      return brain.ask(question, options);
    },
    async dispose() {
      await brain.dispose();
      await runtime.dispose();
    },
  };
}