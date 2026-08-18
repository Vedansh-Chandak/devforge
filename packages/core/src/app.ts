/**
 * Application Factory — createDevForge()
 *
 * Constructs and wires all components:
 *   Configuration → Provider Factory + Runtime + PromptComposer + Brain → Application
 *
 * This is the composition root. It is the only place that knows about
 * all concrete implementations.
 */

import { DevForgeBrain, classifyIntent, buildContextFromMetadata } from '@devforge/brain';
import type { AskResult } from '@devforge/brain';
import { DevForgeRuntime } from '@devforge/runtime';
import { PromptComposer } from '@devforge/prompt-composer';
import { createModelRouterFromConfig } from './router.js';
import { validateConfig, mergeConfig } from './config.js';
import type {
  DevForgeConfig,
  DevForgeApplication,
  DevForgeDiagnosticsResult,
} from './types.js';
import { DevForgeConfigError } from './types.js';

/**
 * Create a DevForge application instance.
 *
 * Usage:
 *   const devforge = await createDevForge({ repository: { root: '/path' }, model: { provider: 'fake' } });
 *   await devforge.initialize();
 *   const result = await devforge.ask('Explain authentication');
 *   await devforge.dispose();
 *
 * @param config - Partial config. Can be merged with env vars if model/repository not fully specified.
 * @throws {DevForgeConfigError} if configuration is invalid
 */
export async function createDevForge(
  config: Partial<DevForgeConfig> & { repository?: { root?: string }; model?: import('./types.js').ModelProviderConfig },
): Promise<DevForgeApplication> {
  // Merge with env and validate
  const merged = validateConfig(mergeConfig(config));

  // Create runtime
  const runtime = new DevForgeRuntime({ workspaceRoot: merged.repository.root });

  // Role-based router (DF-026C) — brain resolves its generation provider
  // through the reasoning role; the app also exposes the raw provider factory
  // for callers that read the provider directly.
  const router = createModelRouterFromConfig(merged.model, merged.roleModels);

  // Create brain with router and runtime
  const brain = new DevForgeBrain({
    runtime,
    router,
    maxContextChars: merged.maxContextChars,
  });

  let initialized = false;

  return {
    get ready(): boolean {
      return initialized;
    },

    async initialize(): Promise<void> {
      if (initialized) return;
      await brain.initialize();
      initialized = true;
    },

    async ask(question: string): Promise<AskResult> {
      if (!initialized) {
        throw new DevForgeConfigError(
          'Application not initialized. Call initialize() first.',
          'app',
          'NOT_INITIALIZED',
        );
      }
      return brain.ask(question);
    },

    async askWithDiagnostics(question: string): Promise<DevForgeDiagnosticsResult> {
      if (!initialized) {
        throw new DevForgeConfigError(
          'Application not initialized. Call initialize() first.',
          'app',
          'NOT_INITIALIZED',
        );
      }

      const totalStart = Date.now();
      const trimmed = question.trim();

      // Classify intent (same as Brain)
      const intentResult = classifyIntent(trimmed);

      // Execute runtime
      let runtimeExecuted = false;
      let runtimeDuration = 0;
      let runtimeSuccess = false;
      let runtimeErrorCount = 0;
      let runtimeMetadata: Record<string, unknown> = {};

      const runtimeStart = Date.now();
      try {
        const runtimeResult = await runtime.execute();
        runtimeExecuted = true;
        runtimeDuration = Date.now() - runtimeStart;
        runtimeSuccess = runtimeResult.success;
        const ctx = runtimeResult.context as { metadata?: Record<string, unknown>; errors?: unknown[] };
        runtimeMetadata = ctx.metadata ?? {};
        runtimeErrorCount = ctx.errors?.length ?? 0;
      } catch {
        runtimeDuration = Date.now() - runtimeStart;
        runtimeExecuted = true;
      }

      // Build context from runtime metadata
      const composerContext = buildContextFromMetadata(runtimeMetadata);

      // Compose prompt
      const composer = new PromptComposer({
        maxContextChars: merged.maxContextChars,
      });
      const composeResult = composer.compose({
        question: trimmed,
        intent: intentResult.intent,
        context: composerContext,
      });

      // Get the actual result from Brain
      const result = await brain.ask(question);
      const totalDuration = Date.now() - totalStart;

      // Build diagnostics
      const diagnostics: DevForgeDiagnosticsResult['diagnostics'] = {
        intent: intentResult.intent,
        runtime: {
          executed: runtimeExecuted,
          duration: runtimeDuration,
          success: runtimeSuccess,
          errorCount: runtimeErrorCount,
        },
        context: {
          symbolCount: composerContext.symbols?.length ?? 0,
          dependencyCount: composerContext.dependencies?.length ?? 0,
          hasArchitecture: !!composerContext.architecture,
          contextChars: composeResult
            ? composeResult.request.messages.reduce(
                (sum: number, m: { role: string; content: string }) => sum + m.content.length,
                0,
              )
            : 0,
          truncated: composeResult?.truncated ?? false,
        },
        timing: {
          totalDuration,
          runtimeDuration,
          providerDuration:
            result.status === 'answered' ? result.metadata.providerDuration : 0,
        },
      };

      // Add model request info if available
      if (composeResult) {
        const systemMsg = composeResult.request.messages.find(
          (m: { role: string; content: string }) => m.role === 'system',
        );
        const userMsg = composeResult.request.messages.find(
          (m: { role: string; content: string }) => m.role === 'user',
        );
        diagnostics.modelRequest = {
          messageCount: composeResult.request.messages.length,
          systemMessageLength: systemMsg?.content.length ?? 0,
          userMessageLength: userMsg?.content.length ?? 0,
        };
        // Expose prompt text for validation (no secrets — just the composed messages)
        (diagnostics as Record<string, unknown>).promptMessages = composeResult.request.messages.map(
          (m: { role: string; content: string }) => ({ role: m.role, content: m.content }),
        );
      }

      // Add provider metadata if answered
      if (result.status === 'answered') {
        diagnostics.provider = {
          id: result.model.provider,
          model: result.model.model,
          finishReason: result.model.finishReason,
          usage: result.model.usage,
        };
      }

      return { result, diagnostics };
    },

    async dispose(): Promise<void> {
      if (!initialized) return;
      await brain.dispose();
      initialized = false;
    },
  };
}