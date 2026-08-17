/**
 * Bounded reasoning loop (DF-011.5 Phase 2).
 *
 * Replaces the DF-011.4 single tool cycle with a reusable, fully bounded
 * multi-round loop. The loop owns every counter mutation through
 * ReasoningStateKit, every limit check through limits.ts, duplicate
 * detection through fingerprint.ts, evidence accumulation through
 * evidence.ts, and no-progress detection through progress.ts.
 *
 * Pipeline per round:
 *   Model generation
 *     → parse tool proposals
 *     → validate proposals
 *     → authorize proposals
 *     → execute tools
 *     → append evidence
 *     → evaluate progress
 *     → run limit checks
 *     → repeat (or return final answer)
 *
 * Security invariants preserved from DF-011.4:
 *   - Denied, unknown and malformed tool proposals are never executed.
 *   - Only AuthorizedToolCall instances reach the controlled executor.
 *   - Tool output is accumulated as tool *evidence* only; it is never
 *     injected into the system prompt as trusted instructions.
 */

import { logger } from '@devforge/logger';
import type {
  AuthorizationResult,
  AuthorizedToolCall,
  ModelExecutionResult,
  ModelToolCallResult,
  ProposalValidationResult,
  ToolCallProposal,
  ToolExecutionContext,
  ToolId,
  ToolRegistry,
  ValidatedToolCall,
} from '@devforge/tools';
import {
  authorizeModelToolCall,
  executeModelToolCalls,
  parseToolCallProposals,
  validateToolCallProposals,
} from '@devforge/tools';
import type { ModelMessage, ModelResponse, ModelUsage, FinishReason } from '@devforge/model-provider';
import { isModelProviderError } from '@devforge/model-provider';
import { appendEvidence, totalEvidenceBytes } from './evidence.js';
import type { EvidenceItem, EvidenceBudget } from './evidence.js';
import { createToolFingerprint } from './fingerprint.js';
import { checkOuterGuards, resolveReasoningLimits } from './limits.js';
import type { ReasoningLimits } from './limits.js';
import { evaluateProgress } from './progress.js';
import { createReasoningState, ReasoningStateKit } from './state.js';
import type { ReasoningState, TerminationReason } from './state.js';

/** Tool execution plumbing supplied by the caller (typically Brain). */
export interface ReasoningToolExecution {
  /** Registry that owns the tools the model may propose. */
  readonly registry: ToolRegistry;
  /** Supplies a fresh execution context (permissions, workspace, signal). */
  readonly executionContextProvider: () => ToolExecutionContext;
  /** Per-response execution cap forwarded to the controlled executor. */
  readonly maxExecutions?: number;
}

/**
 * Injectable tool pipeline. When provided it replaces the default
 * @devforge/tools pipeline entirely — used by tests to exercise the loop
 * without a live registry.
 */
export interface ReasoningPipeline {
  readonly parseToolCalls: (content: string) => readonly ToolCallProposal[];
  readonly validateToolCalls: (
    proposals: readonly ToolCallProposal[],
  ) => readonly ProposalValidationResult[];
  readonly authorizeToolCall: (validatedCall: ValidatedToolCall) => AuthorizationResult;
  readonly executeToolCalls: (
    authorizedCalls: readonly AuthorizedToolCall[],
    config: { readonly maxExecutions?: number },
  ) => Promise<ModelExecutionResult>;
}

/** Input to a single bounded reasoning session. */
export interface ReasoningLoopInput {
  /** Initial chat messages (typically the composed system + user prompt). */
  readonly messages: readonly ModelMessage[];
  /** Model generation function. Called once per round. */
  readonly generate: (messages: readonly ModelMessage[]) => Promise<ModelResponse>;
  /** Limit overrides merged over DEFAULT_REASONING_LIMITS. */
  readonly limits?: Partial<ReasoningLimits>;
  /** Optional cancellation signal shared with tool execution. */
  readonly signal?: AbortSignal;
  /** Injectable clock for deterministic deadline tests. Defaults to Date.now. */
  readonly nowMs?: () => number;
  /** Tool execution capability. Absent → text-only loop (single model call). */
  readonly toolExecution?: ReasoningToolExecution;
  /** Testable replacement for the whole tool pipeline. */
  readonly pipeline?: ReasoningPipeline;
}

/** Outcome of a bounded reasoning session. */
export interface ReasoningLoopResult {
  /**
   * High-level outcome:
   *   - 'answered'       → the model produced a final text answer.
   *   - 'tool_executed'  → tools ran and the loop stopped on a bound.
   *   - 'provider_error' → model generation failed.
   */
  readonly status: 'answered' | 'tool_executed' | 'provider_error';
  /** Why the loop stopped. Null for provider errors. */
  readonly terminationReason: TerminationReason | null;
  /** Final answer text (present when status === 'answered'). */
  readonly finalAnswer?: string;
  /** Every tool call outcome across all rounds, in execution order. */
  readonly toolCalls: readonly ModelToolCallResult[];
  /** Accumulated evidence across all rounds. */
  readonly evidence: readonly EvidenceItem[];
  /** Final reasoning state (counters, deadline, termination reason). */
  readonly state: ReasoningState;
  /** Model metadata captured from the final round. */
  readonly model?: {
    readonly model?: string;
    readonly finishReason?: FinishReason;
    readonly usage?: ModelUsage;
  };
  /** Error detail when status === 'provider_error'. */
  readonly providerError?: {
    readonly code?: string;
    readonly message: string;
    readonly retryable?: boolean;
  };
  /** Lightweight timing / accounting summary. */
  readonly metadata: {
    readonly duration: number;
    readonly providerCalls: number;
    readonly toolRoundsCompleted: number;
    readonly totalToolExecutions: number;
    readonly duplicateSuppressions: number;
    readonly totalEvidenceBytes: number;
  };
}

/**
 * The bounded reasoning loop. Stateless — each execute() call owns a
 * fresh ReasoningState and never mutates counters directly.
 */
export class ReasoningLoop {
  /** Execute one bounded reasoning session. */
  async execute(input: ReasoningLoopInput): Promise<ReasoningLoopResult> {
    const nowMs = input.nowMs ?? (() => Date.now());
    const limits = resolveReasoningLimits(input.limits);
    const startTimeMs = nowMs();
    const deadlineMs = startTimeMs + limits.maxDurationMs;
    const state = createReasoningState(startTimeMs, deadlineMs);
    const kit = new ReasoningStateKit(state);

    const pipeline = this.buildPipeline(input);
    const toolExecutionEnabled = pipeline !== null;

    let messages: ModelMessage[] = [...input.messages];
    let evidence: EvidenceItem[] = [];
    const allToolCalls: ModelToolCallResult[] = [];
    // fingerprint → number of times it has actually executed (across rounds).
    const fingerprintCounts = new Map<string, number>();

    let finalAnswer: string | undefined;
    let finalModel: { model?: string; finishReason?: FinishReason; usage?: ModelUsage } | undefined;

    logger.debug({ startTimeMs, deadlineMs, toolExecutionEnabled }, 'ReasoningLoop starting');

    for (;;) {
      // ── Outer guards: cancellation / deadline / model / round / execution ──
      const guard = checkOuterGuards({
        providerCalls: state.providerCalls,
        toolRoundsCompleted: state.toolRoundsCompleted,
        totalToolExecutions: state.totalToolExecutions,
        nowMs: nowMs(),
        deadlineMs,
        signal: input.signal,
        limits,
      });
      if (guard) {
        kit.setTerminationReason(guard);
        break;
      }

      // ── Model generation ──
      kit.addProviderCalls(1);
      let response: ModelResponse;
      try {
        response = await input.generate(messages);
      } catch (error) {
        return this.buildProviderErrorResult(state, startTimeMs, nowMs(), error);
      }

      if (!response.content) {
        return this.buildProviderErrorResult(
          state,
          startTimeMs,
          nowMs(),
          new Error('Provider returned empty response content'),
          'PROVIDER_ERROR',
        );
      }

      // ── Parse tool proposals ──
      const proposals = toolExecutionEnabled ? pipeline!.parseToolCalls(response.content) : [];

      // ── No tool proposals → final text answer ──
      if (proposals.length === 0) {
        kit.setTerminationReason('TEXT_FINAL_ANSWER');
        finalAnswer = response.content;
        finalModel = {
          model: response.model,
          finishReason: response.finishReason,
          usage: response.usage,
        };
        break;
      }

      // ── Validate + authorize proposals (never trust raw proposals) ──
      const validationResults = pipeline!.validateToolCalls(proposals);
      const rejected: ModelToolCallResult[] = [];
      const authorizedCalls: AuthorizedToolCall[] = [];

      for (let i = 0; i < proposals.length; i++) {
        const proposal = proposals[i]!;
        const vr = validationResults[i]!;
        if (!vr.valid || !vr.validatedCall) {
          rejected.push({
            callId: proposal.callId,
            toolId: proposal.toolIdRaw as ToolId,
            status: 'denied',
            error: vr.error ?? { code: 'VALIDATION_FAILED', message: 'Validation failed' },
          });
          continue;
        }
        const auth = pipeline!.authorizeToolCall(vr.validatedCall);
        if (!auth.authorized || !auth.authorizedCall) {
          rejected.push({
            callId: vr.validatedCall.callId,
            toolId: vr.validatedCall.toolId,
            status: 'denied',
            error: {
              code: auth.auditRecord.errorCode ?? 'UNAUTHORIZED',
              message: auth.denialReason ?? 'Authorization denied',
            },
          });
          continue;
        }
        authorizedCalls.push(auth.authorizedCall);
      }

      // ── Duplicate suppression (within round) + repeated-tool guard ──
      const executables: AuthorizedToolCall[] = [];
      const seenThisRound = new Set<string>();
      let suppressedCount = 0;
      let repeatedTripped = false;

      for (const call of authorizedCalls) {
        const fp = createToolFingerprint(call.toolId, call.validatedInput);
        if (seenThisRound.has(fp)) {
          suppressedCount++;
          continue;
        }
        seenThisRound.add(fp);
        if ((fingerprintCounts.get(fp) ?? 0) >= limits.maxRepeatedToolCalls) {
          repeatedTripped = true;
          break;
        }
        executables.push(call);
      }

      if (suppressedCount > 0) {
        kit.addDuplicateSuppressions(suppressedCount);
      }

      // ── Execute authorized, deduplicated calls ──
      const remainingExecutions = Math.max(0, limits.maxToolExecutions - state.totalToolExecutions);
      const executionResult = await pipeline!.executeToolCalls(executables, {
        maxExecutions: remainingExecutions,
      });

      // A tool counts as executed when the executor actually attempted it.
      const executedThisRound = executionResult.results.filter(
        (r) => r.status === 'completed' || r.status === 'failed',
      ).length;
      kit.addToolExecutions(executedThisRound);

      // Record executed fingerprints so the repeated-tool guard can trip later.
      const callIdToFingerprint = new Map<string, string>();
      for (const call of executables) {
        callIdToFingerprint.set(call.callId, createToolFingerprint(call.toolId, call.validatedInput));
      }
      for (const r of executionResult.results) {
        const fp = callIdToFingerprint.get(r.callId);
        if (fp && (r.status === 'completed' || r.status === 'failed')) {
          fingerprintCounts.set(fp, (fingerprintCounts.get(fp) ?? 0) + 1);
        }
      }

      // ── Append evidence (bounded by maxEvidenceBytes) ──
      const roundEvidence: EvidenceItem[] = [];
      for (const r of rejected) {
        roundEvidence.push({ callId: r.callId, toolId: r.toolId, error: r.error });
      }
      for (const r of executionResult.results) {
        roundEvidence.push({
          callId: r.callId,
          toolId: r.toolId,
          result: r.result,
          error: r.error,
        });
      }

      const budget: EvidenceBudget = { maxBytes: limits.maxEvidenceBytes };
      const bytesBefore = totalEvidenceBytes(evidence);
      let nextEvidence = evidence;
      for (const item of roundEvidence) {
        nextEvidence = appendEvidence(nextEvidence, item, budget);
      }
      const bytesAfter = totalEvidenceBytes(nextEvidence);
      kit.addEvidenceBytes(bytesAfter - bytesBefore);

      // ── Evaluate progress (no-progress detection) ──
      const progress = evaluateProgress({
        priorItems: evidence,
        newItems: roundEvidence,
        currentStreak: state.consecutiveNoProgressRounds,
        maxNoProgressRounds: limits.maxNoProgressRounds,
      });
      if (progress.progressed) {
        kit.resetNoProgress();
      } else {
        kit.incrementNoProgress();
      }

      evidence = nextEvidence;
      allToolCalls.push(...rejected, ...executionResult.results);

      // ── Round accounting ──
      kit.addToolRound(1);

      logger.debug(
        { round: state.toolRoundsCompleted, executed: executedThisRound, rejected: rejected.length, progress: progress.progressed },
        'ReasoningLoop round complete',
      );

      // ── Immediate termination checks (stop before another model call) ──
      if (repeatedTripped) {
        kit.setTerminationReason('REPEATED_TOOL_CALL_LIMIT');
        break;
      }
      if (authorizedCalls.length === 0) {
        kit.setTerminationReason('ALL_TOOLS_REJECTED');
        break;
      }
      if (progress.reached) {
        kit.setTerminationReason('NO_PROGRESS');
        break;
      }

      // Re-check the outer guards now that counters advanced.
      const postGuard = checkOuterGuards({
        providerCalls: state.providerCalls,
        toolRoundsCompleted: state.toolRoundsCompleted,
        totalToolExecutions: state.totalToolExecutions,
        nowMs: nowMs(),
        deadlineMs,
        signal: input.signal,
        limits,
      });
      if (postGuard) {
        kit.setTerminationReason(postGuard);
        break;
      }

      // ── Feed evidence back as a user message (tool evidence, never system) ──
      messages = appendEvidenceMessage(messages, roundEvidence, state.toolRoundsCompleted);
    }

    const duration = nowMs() - startTimeMs;
    const terminationReason = state.terminationReason;

    // A caller cancellation (aborted signal) is a distinct outcome: surface it
    // as a structured CANCELLED provider error instead of a misleading empty
    // tool_executed stop. Consumers (Brain, CLI) depend on this to exit cleanly.
    if (terminationReason === 'CANCELLED' && finalAnswer === undefined) {
      const cancelResult = this.buildProviderErrorResult(
        state,
        startTimeMs,
        nowMs(),
        new Error('Reasoning cancelled by the caller'),
        'CANCELLED',
      );
      return {
        ...cancelResult,
        terminationReason: 'CANCELLED',
        providerError: { ...cancelResult.providerError!, retryable: false },
      };
    }

    const status: ReasoningLoopResult['status'] =
      finalAnswer !== undefined ? 'answered' : 'tool_executed';

    return {
      status,
      terminationReason,
      finalAnswer,
      toolCalls: allToolCalls,
      evidence,
      state,
      model: finalModel,
      metadata: {
        duration,
        providerCalls: state.providerCalls,
        toolRoundsCompleted: state.toolRoundsCompleted,
        totalToolExecutions: state.totalToolExecutions,
        duplicateSuppressions: state.duplicateSuppressions,
        totalEvidenceBytes: state.totalEvidenceBytes,
      },
    };
  }

  /**
   * Resolve the tool pipeline: injected pipeline wins, then the real
   * @devforge/tools pipeline, then null (text-only loop).
   */
  private buildPipeline(input: ReasoningLoopInput): ReasoningPipeline | null {
    if (input.pipeline) {
      return input.pipeline;
    }
    const toolExecution = input.toolExecution;
    if (!toolExecution) {
      return null;
    }
    return {
      parseToolCalls: (content) => parseToolCallProposals(content),
      validateToolCalls: (proposals) => validateToolCallProposals([...proposals], toolExecution.registry),
      authorizeToolCall: (validatedCall) =>
        authorizeModelToolCall(validatedCall, this.freshContext(input), toolExecution.registry),
      executeToolCalls: (authorizedCalls, config) =>
        executeModelToolCalls(authorizedCalls, this.freshContext(input), toolExecution.registry, config),
    };
  }

  /** Fresh execution context for authorization / execution within a round. */
  private freshContext(input: ReasoningLoopInput): ToolExecutionContext {
    return input.toolExecution!.executionContextProvider();
  }

  /** Build a provider_error result without touching counters. */
  private buildProviderErrorResult(
    state: ReasoningState,
    startTimeMs: number,
    now: number,
    error: unknown,
    codeOverride?: string,
  ): ReasoningLoopResult {
    let code: string | undefined;
    let retryable: boolean | undefined;
    let message: string;

    if (isModelProviderError(error)) {
      code = error.code;
      retryable = error.retryable;
      message = error.message;
    } else if (codeOverride) {
      code = codeOverride;
      message = error instanceof Error ? error.message : String(error);
    } else {
      message = error instanceof Error ? error.message : String(error);
    }

    logger.error({ code, message }, 'ReasoningLoop provider error');

    return {
      status: 'provider_error',
      terminationReason: null,
      toolCalls: [],
      evidence: [],
      state,
      providerError: { code, message, retryable },
      metadata: {
        duration: Math.max(0, now - startTimeMs),
        providerCalls: state.providerCalls,
        toolRoundsCompleted: state.toolRoundsCompleted,
        totalToolExecutions: state.totalToolExecutions,
        duplicateSuppressions: state.duplicateSuppressions,
        totalEvidenceBytes: state.totalEvidenceBytes,
      },
    };
  }
}

/**
 * Serialise one round of tool evidence into a user-role message so the
 * model can reason about its results on the next round. Evidence is
 * deliberately a *user* message labelled as tool evidence — never a
 * system prompt, preserving the "tool output remains tool evidence" rule.
 */
function appendEvidenceMessage(
  messages: ModelMessage[],
  items: readonly EvidenceItem[],
  round: number,
): ModelMessage[] {
  const lines = items.map((item) => {
    const parts = [
      item.error ? `error=${JSON.stringify(item.error.message)}` : '',
      item.result !== undefined ? `result=${JSON.stringify(item.result)}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `${item.toolId}(${item.callId}) ${parts}`.trim();
  });

  return [
    ...messages,
    {
      role: 'user',
      content: `[Tool evidence round ${round}]\n${lines.join('\n')}`,
    },
  ];
}
