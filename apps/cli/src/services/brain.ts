/**
 * @devforge/cli — Brain Service (M1).
 *
 * Creates the model provider from configuration, initializes the DevForgeRuntime
 * and DevForgeBrain, and exposes a simple ask() method.
 */

import type { ModelProvider } from '@devforge/model-provider';
import { FakeModelProvider, OpenAICompatibleProvider } from '@devforge/model-provider';
import { DevForgeRuntime } from '@devforge/runtime';
import { DevForgeBrain } from '@devforge/brain';
import type { DevForgeConfig } from '../types.js';
import { logger } from '../utils/logger.js';

/** Provider factory options derived from CLI config. */
export interface ProviderFactoryOptions {
  readonly kind: 'fake' | 'openai-compatible';
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly temperature?: number;
}

/**
 * Create a ModelProvider from the given options.
 * Uses FakeModelProvider for testing/offline mode, or OpenAICompatibleProvider for real calls.
 * Wraps generate() to inject temperature from options when not explicitly provided.
 */
export function createProvider(opts: ProviderFactoryOptions): ModelProvider {
  const base: ModelProvider = opts.kind === 'openai-compatible'
    ? new OpenAICompatibleProvider({
        baseUrl: opts.baseUrl!,
        model: opts.model!,
        apiKey: opts.apiKey,
        timeoutMs: opts.timeoutMs,
      })
    : new FakeModelProvider();

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
 * Creates provider, runtime, and brain; initializes them.
 */
export async function createBrainService(
  config: DevForgeConfig,
  repoRoot: string,
  signal?: AbortSignal,
): Promise<BrainService> {
  const provider = createProvider({
    kind: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    temperature: config.temperature,
  });

  const runtime = new DevForgeRuntime({ workspaceRoot: repoRoot });
  const brain = new DevForgeBrain({ runtime, provider, maxContextChars: 200_000 });

  await runtime.initialize();
  await brain.initialize();

  logger.debug('Brain service initialized', { provider: provider.id, repoRoot });

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