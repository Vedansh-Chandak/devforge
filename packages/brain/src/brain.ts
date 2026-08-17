import { logger } from '@devforge/logger';
import { PromptComposer } from '@devforge/prompt-composer';
import type { ComposerContext } from '@devforge/prompt-composer';
import type { ToolRegistry, ToolExecutionContext } from '@devforge/tools';
import { ReasoningLoop } from './reasoning/index.js';
import { classifyIntent } from './intent.js';
import { buildContextFromMetadata } from './context-builder.js';
import type {
  BrainConfig,
  BrainState,
  AskResult,
  AskClassifiedResult,
  BrainAnswer,
  BrainInvalidInput,
  BrainProviderError,
  BrainToolExecuted,
  BrainToolCallResult,
  RuntimeInterface,
  ModelProviderInterface,
  BrainToolExecutionConfig,
} from './types.js';

/** Options for a single ask() call. */
export interface AskOptions {
  /** External cancellation signal. Aborting cancels the in-flight request. */
  readonly signal?: AbortSignal;
}

/**
 * DevForge Brain — orchestrates the full AI pipeline.
 *
 * Pipeline: Question → Validation → Intent → Runtime → Context → Composer → Provider → Answer
 *
 * Extended Pipeline (DF-011.5 Phase 2): ... → Composer → ReasoningLoop (bounded
 * multi-round: generate → parse → validate → authorize → execute → evidence →
 * progress → limits) → AskResult.
 *
 * Dependencies injected via constructor:
 *   Brain → Runtime, PromptComposer, ModelProvider, ToolRegistry (optional)
 *
 * Brain does NOT directly depend on:
 *   repository-indexer, parser-typescript, symbol-graph, knowledge-graph
 */
export class DevForgeBrain {
  private runtime: RuntimeInterface;
  private provider: ModelProviderInterface | undefined;
  private state: BrainState;
  private composer: PromptComposer;
  private toolExecutionConfig: BrainToolExecutionConfig | undefined;
  private toolRegistry: ToolRegistry | undefined;
  private executionContextProvider: (() => ToolExecutionContext) | undefined;

  constructor(config: BrainConfig) {
    if (!config?.runtime) {
      throw new Error('Brain requires a runtime instance');
    }
    this.runtime = config.runtime;
    this.provider = config.provider;
    this.state = { initialized: false };
    this.composer = new PromptComposer({
      maxContextChars: config.maxContextChars,
    });
    this.toolExecutionConfig = config.toolExecution;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.toolRegistry = config.toolRegistry as ToolRegistry | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.executionContextProvider = config.executionContextProvider as (() => ToolExecutionContext) | undefined;
  }

  async initialize(): Promise<void> {
    if (this.state.initialized) {
      logger.warn('Brain already initialized');
      return;
    }

    logger.info('Initializing DevForge Brain...');
    await this.runtime.initialize();
    this.state.initialized = true;
    logger.info('Brain initialized successfully');
  }

  get runtimeReady(): boolean {
    return this.state.initialized;
  }

  /**
   * Full AI pipeline: classify intent → query runtime → compose prompt →
   * run the bounded reasoning loop (DF-011.5 Phase 2).
   *
   * The ReasoningLoop owns all multi-round orchestration: model generation,
   * tool proposal parsing, validation, authorization, execution, evidence
   * accumulation, no-progress detection, and every limit check. Brain only
   * composes the initial prompt and maps the loop result to an AskResult.
   *
   * - Returns 'invalid' for empty/whitespace-only input.
   * - Returns 'classified' for Unknown intent (provider NOT called).
   * - Returns 'classified' when no provider is configured.
   * - Returns 'answered' when the model produced a final text answer.
   * - Returns 'tool_executed' after bounded tool execution.
   * - Returns 'provider_error' on provider failure.
   */
  async ask(question: string, options?: AskOptions): Promise<AskResult> {
    const startTime = Date.now();
    const trimmed = question.trim();
    const signal = options?.signal;
    const intent = classifyIntent(trimmed);

    // --- Invalid input: empty after trim ---
    if (!trimmed) {
      const result: BrainInvalidInput = {
        question: trimmed,
        intent: intent.intent,
        status: 'invalid',
        error: 'Empty question',
      };
      return result;
    }

    // --- Unknown intent: do NOT call provider ---
    if (intent.intent === 'Unknown') {
      const result: AskClassifiedResult = {
        question: trimmed,
        intent: intent.intent,
        confidence: intent.confidence,
        status: 'classified',
        timestamp: new Date().toISOString(),
        runtimeReady: this.state.initialized,
      };
      return result;
    }

    // --- No provider configured: classify only ---
    if (!this.provider) {
      logger.warn('No provider configured, returning classified result');
      const result: AskClassifiedResult = {
        question: trimmed,
        intent: intent.intent,
        confidence: intent.confidence,
        status: 'classified',
        timestamp: new Date().toISOString(),
        runtimeReady: this.state.initialized,
      };
      return result;
    }

    // --- Runtime query ---
    let runtimeResult;
    const runtimeStart = Date.now();
    try {
      runtimeResult = await this.runtime.execute();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Runtime execution failed: ${errorMessage}`);
      const result: BrainProviderError = {
        question: trimmed,
        intent: intent.intent,
        status: 'provider_error',
        error: `Runtime failed: ${errorMessage}`,
      };
      return result;
    }
    const runtimeDuration = Date.now() - runtimeStart;

    // --- Context builder: PipelineContext metadata → ComposerContext ---
    const pipelineContext = runtimeResult.context as {
      metadata?: Record<string, unknown>;
    };
    const metadata = pipelineContext?.metadata ?? {};
    const composerContext: ComposerContext = buildContextFromMetadata(metadata);

    // --- Prompt composition ---
    const composeResult = this.composer.compose({
      question: trimmed,
      intent: intent.intent,
      context: composerContext,
    });

    if (!composeResult) {
      // Should not happen since Unknown is already filtered, but safety check
      const result: AskClassifiedResult = {
        question: trimmed,
        intent: intent.intent,
        confidence: intent.confidence,
        status: 'classified',
        timestamp: new Date().toISOString(),
        runtimeReady: this.state.initialized,
      };
      return result;
    }

    // --- Provider call + bounded reasoning loop (DF-011.5 Phase 2) ---
    const provider = this.provider;
    const providerStart = Date.now();
    const toolEnabled =
      this.toolExecutionConfig?.enabled === true &&
      this.toolRegistry !== undefined &&
      this.executionContextProvider !== undefined;

    const loopResult = await new ReasoningLoop().execute({
      messages: composeResult.request.messages,
      signal,
      generate: (messages) =>
        provider.generate({
          ...composeResult.request,
          messages: [...messages],
          signal,
        }),
      toolExecution: toolEnabled
        ? {
            registry: this.toolRegistry as ToolRegistry,
            executionContextProvider: this.executionContextProvider as () => ToolExecutionContext,
            maxExecutions: this.toolExecutionConfig?.maxExecutions,
          }
        : undefined,
    });
    const providerDuration = Date.now() - providerStart;

    if (loopResult.status === 'provider_error') {
      const result: BrainProviderError = {
        question: trimmed,
        intent: intent.intent,
        status: 'provider_error',
        error: loopResult.providerError?.message ?? 'Provider failed',
        errorCode: loopResult.providerError?.code,
        retryable: loopResult.providerError?.retryable,
      };
      return result;
    }

    if (loopResult.status === 'answered') {
      const duration = Date.now() - startTime;
      const result: BrainAnswer = {
        question: trimmed,
        intent: intent.intent,
        status: 'answered',
        answer: loopResult.finalAnswer ?? '',
        model: {
          provider: provider.id,
          model: loopResult.model?.model,
          finishReason: loopResult.model?.finishReason,
          usage: loopResult.model?.usage,
        },
        metadata: {
          contextTruncated: composeResult.truncated,
          duration,
          runtimeDuration,
          providerDuration,
        },
      };
      return result;
    }

    // --- tool_executed: the bounded loop ran tools then stopped on a bound ---
    const duration = Date.now() - startTime;
    const toolCalls = [...loopResult.toolCalls] as BrainToolCallResult[];
    const successfulCalls = toolCalls.filter((r) => r.status === 'completed').length;
    const result: BrainToolExecuted = {
      question: trimmed,
      intent: intent.intent,
      status: 'tool_executed',
      toolCalls,
      metadata: {
        contextTruncated: composeResult.truncated,
        duration,
        runtimeDuration,
        providerDuration,
        toolExecutionDuration: providerDuration,
        totalToolCalls: toolCalls.length,
        successfulCalls,
        failedCalls: toolCalls.length - successfulCalls,
      },
    };
    return result;
  }

  /**
   * Compose a prompt from question + structured context.
   * Deterministic — no timestamp, no model call.
   * Returns null for Unknown intent.
   */
  askWithContext(
    question: string,
    context: ComposerContext,
  ) {
    const trimmed = question.trim();
    const result = classifyIntent(trimmed);

    return this.composer.compose({
      question: trimmed,
      intent: result.intent,
      context,
    });
  }

  async dispose(): Promise<void> {
    logger.info('Disposing Brain...');
    await this.runtime.dispose();
    this.state.initialized = false;
    logger.info('Brain disposed');
  }
}