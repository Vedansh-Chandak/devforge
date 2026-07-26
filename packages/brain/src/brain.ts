import { logger } from '@devforge/logger';
import { PromptComposer } from '@devforge/prompt-composer';
import type { ComposerContext } from '@devforge/prompt-composer';
import { isModelProviderError } from '@devforge/model-provider';
import type { ToolRegistry, ToolExecutionContext, ToolPermission } from '@devforge/tools';
import {
  parseToolCallProposals,
  validateToolCallProposals,
  authorizeModelToolCall,
  executeModelToolCalls,
} from '@devforge/tools';
import type { ToolCallProposal } from '@devforge/tools';
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
  IntentKind,
  BrainToolExecutionConfig,
} from './types.js';

/**
 * DevForge Brain — orchestrates the full AI pipeline.
 *
 * Pipeline: Question → Validation → Intent → Runtime → Context → Composer → Provider → Answer
 *
 * Extended Pipeline (DF-011.3): ... → Provider → Tool Proposals → Validation → Authorization → Execution → ToolResult → STOP
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
   * Full AI pipeline: classify intent → query runtime → compose prompt → call provider.
   *
   * Extended (DF-011.3): If tool execution is enabled and the model response contains
   * tool calls, Brain will parse, validate, authorize, and execute them before returning.
   * After tool execution, Brain STOPs — no second model call is made.
   *
   * - Returns 'invalid' for empty/whitespace-only input.
   * - Returns 'classified' for Unknown intent (provider NOT called).
   * - Returns 'classified' when no provider is configured.
   * - Returns 'answered' on successful provider response (no tool calls).
   * - Returns 'tool_executed' after controlled tool execution.
   * - Returns 'provider_error' on provider failure.
   */
  async ask(question: string): Promise<AskResult> {
    const startTime = Date.now();
    const trimmed = question.trim();
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
        status: 'classified',
        timestamp: new Date().toISOString(),
        runtimeReady: this.state.initialized,
      };
      return result;
    }

    // --- Provider call ---
    const providerStart = Date.now();
    let response;
    try {
      response = await this.provider.generate(composeResult.request);
    } catch (error: unknown) {
      if (isModelProviderError(error)) {
        const result: BrainProviderError = {
          question: trimmed,
          intent: intent.intent,
          status: 'provider_error',
          error: error.message,
          errorCode: error.code,
          retryable: error.retryable,
        };
        return result;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      const result: BrainProviderError = {
        question: trimmed,
        intent: intent.intent,
        status: 'provider_error',
        error: errorMessage,
      };
      return result;
    }
    const providerDuration = Date.now() - providerStart;

    if (!response.content) {
      const result: BrainProviderError = {
        question: trimmed,
        intent: intent.intent,
        status: 'provider_error',
        error: 'Provider returned empty response content',
      };
      return result;
    }

    // --- DF-011.3: Check for tool calls in provider response ---
    if (this.toolExecutionConfig?.enabled && this.toolRegistry && this.executionContextProvider) {
      const proposals = parseToolCallProposals(response.content);

      if (proposals.length > 0) {
        return await this.executeToolProposals(
          trimmed,
          intent.intent,
          proposals,
          composeResult.truncated,
          runtimeDuration,
          providerDuration,
          startTime,
        );
      }
    }

    // --- No tool calls: return normal answer ---
    const duration = Date.now() - startTime;
    const result: BrainAnswer = {
      question: trimmed,
      intent: intent.intent,
      status: 'answered',
      answer: response.content,
      model: {
        provider: this.provider.id,
        model: response.model,
        finishReason: response.finishReason,
        usage: response.usage,
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

  /**
   * Execute tool proposals through the controlled pipeline:
   *   proposals → validate → authorize → execute → STOP
   *
   * No second model call is made. ToolResult is NOT sent back to the model.
   */
  private async executeToolProposals(
    question: string,
    intent: IntentKind,
    proposals: ToolCallProposal[],
    contextTruncated: boolean,
    runtimeDuration: number,
    providerDuration: number,
    startTime: number,
  ): Promise<BrainToolExecuted> {
    const toolExecStart = Date.now();

    // 1. Validate all proposals
    const validationResults = validateToolCallProposals(proposals, this.toolRegistry!);

    // 2. Authorize validated calls (defense-in-depth)
    const executionContext = this.executionContextProvider!();
    const authorizedCalls: Array<import('@devforge/tools').AuthorizedToolCall> = [];
    const deniedResults: BrainToolCallResult[] = [];

    for (let i = 0; i < validationResults.length; i++) {
      const vr = validationResults[i]!;
      if (!vr.valid || !vr.validatedCall) {
        const proposal = proposals[i];
        if (proposal) {
          deniedResults.push({
            callId: proposal.callId,
            toolId: proposal.toolIdRaw,
            status: 'denied',
            error: vr.error ?? { code: 'VALIDATION_FAILED', message: 'Validation failed' },
          });
        }
        continue;
      }

      const authResult = authorizeModelToolCall(vr.validatedCall, executionContext, this.toolRegistry!);
      if (!authResult.authorized || !authResult.authorizedCall) {
        deniedResults.push({
          callId: vr.validatedCall.callId,
          toolId: vr.validatedCall.toolId,
          status: 'denied',
          error: {
            code: authResult.auditRecord.errorCode ?? 'UNAUTHORIZED',
            message: authResult.denialReason ?? 'Authorization denied',
          },
        });
        continue;
      }

      authorizedCalls.push(authResult.authorizedCall);
    }

    // 3. Execute authorized calls
    const executionResult = await executeModelToolCalls(
      authorizedCalls,
      executionContext,
      this.toolRegistry!,
      { maxExecutions: this.toolExecutionConfig!.maxExecutions },
    );

    // 4. Combine denied + executed results in proposal order
    const allResults: BrainToolCallResult[] = [];
    for (let i = 0; i < proposals.length; i++) {
      const proposal = proposals[i];
      if (!proposal) continue;

      // Check if this was denied during validation/authorization
      const denied = deniedResults.find(d => d.callId === proposal.callId);
      if (denied) {
        allResults.push(denied);
        continue;
      }

      // Check if this was in the execution results
      const executed = executionResult.results.find(
        (r: import('@devforge/tools').ModelToolCallResult) => r.callId === proposal.callId,
      );
      if (executed) {
        allResults.push(executed);
        continue;
      }
    }

    const toolExecDuration = Date.now() - toolExecStart;
    const totalDuration = Date.now() - startTime;
    const successfulCalls = allResults.filter((r: BrainToolCallResult) => r.status === 'completed').length;
    const failedCalls = allResults.filter((r: BrainToolCallResult) => r.status !== 'completed').length;

    logger.info(
      `Tool execution completed: ${successfulCalls}/${allResults.length} successful ` +
      `(${toolExecDuration}ms)`,
    );

    return {
      question,
      intent,
      status: 'tool_executed',
      toolCalls: allResults,
      metadata: {
        contextTruncated,
        duration: totalDuration,
        runtimeDuration,
        providerDuration,
        toolExecutionDuration: toolExecDuration,
        totalToolCalls: allResults.length,
        successfulCalls,
        failedCalls,
      },
    };
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