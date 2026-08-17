/**
 * @devforge/execution — ReasoningModel interface and reference implementation (DF-016B).
 *
 * The ReasoningModel analyzes failures and decides on repair strategies.
 * This module defines the interface and provides a deterministic fake implementation.
 */

import { Diagnostics } from './diagnostics.js';
import { ReasoningError } from './coding-errors.js';

/** Result of analyzing a failure. */
export interface FailureAnalysis {
  /** Human-readable diagnosis of what went wrong. */
  readonly diagnosis: string;
  /** Category of the failure. */
  readonly category: 'TYPE_ERROR' | 'TEST_FAILURE' | 'LINT_ERROR' | 'COMMAND_ERROR' | 'OTHER';
  /** Confidence in the diagnosis (0-1). */
  readonly confidence: number;
  /** Files likely needing changes. */
  readonly suggestedPaths: readonly string[];
  /** Estimated complexity of repair (1-10). */
  readonly estimatedComplexity: number;
}

/** Decision on how to repair. */
export interface RepairDecision {
  /** High-level repair strategy. */
  readonly strategy: 'REWRITE' | 'PATCH' | 'CREATE' | 'DELETE' | 'RESTORE' | 'ABORT';
  /** Human-readable reason for the decision. */
  readonly reason: string;
  /** Specific files to target. */
  readonly targetFiles: readonly string[];
  /** Whether the repair should be minimal (single file) or broad. */
  readonly scope: 'MINIMAL' | 'BROAD';
}

/** Input to analyzeFailure. */
export interface FailureAnalysisInput {
  /** The original goal/task. */
  readonly goal: string;
  /** Structured diagnostics from the failed verification. */
  readonly diagnostics: Diagnostics;
  /** Current repair attempt number (1-indexed). */
  readonly attempt: number;
}

/** Input to decideRepair. */
export interface RepairDecisionInput {
  /** The original goal/task. */
  readonly goal: string;
  /** Structured diagnostics from the failed verification. */
  readonly diagnostics: Diagnostics;
  /** The failure analysis from analyzeFailure. */
  readonly analysis: FailureAnalysis;
  /** Current repair attempt number (1-indexed). */
  readonly attempt: number;
}

/** ReasoningModel interface — injectable for different providers. */
export interface ReasoningModel {
  readonly name?: string;
  /**
   * Analyze a failure and produce a diagnosis.
   * @throws {ReasoningError} on provider error or cancellation.
   */
  analyzeFailure(input: FailureAnalysisInput): Promise<FailureAnalysis>;
  /**
   * Decide on a repair strategy based on analysis.
   * @throws {ReasoningError} on provider error or cancellation.
   */
  decideRepair(input: RepairDecisionInput): Promise<RepairDecision>;
}

/** Result of a scripted reasoning model for test introspection. */
export interface ScriptedReasoningModel {
  model: ReasoningModel;
  readonly getAnalyzeCalls: () => number;
  readonly getDecideCalls: () => number;
}

/**
 * Creates a deterministic fake ReasoningModel with pre-defined analysis and decisions.
 * Cycles through provided arrays; throws ReasoningError when exhausted.
 */
export function scriptedReasoningModel(
  analyses: readonly FailureAnalysis[] = [],
  decisions: readonly RepairDecision[] = [],
): ScriptedReasoningModel {
  let analyzeIndex = 0;
  let decideIndex = 0;
  let analyzeCalls = 0;
  let decideCalls = 0;

  const model: ReasoningModel = {
    name: 'scripted',
    async analyzeFailure(input: FailureAnalysisInput): Promise<FailureAnalysis> {
      analyzeCalls += 1;
      const analysis = analyses[analyzeIndex];
      if (!analysis) {
        throw new ReasoningError(
          `Scripted reasoning model exhausted: no analysis at index ${analyzeIndex}`,
        );
      }
      analyzeIndex += 1;
      return { ...analysis };
    },
    async decideRepair(input: RepairDecisionInput): Promise<RepairDecision> {
      decideCalls += 1;
      const decision = decisions[decideIndex];
      if (!decision) {
        throw new ReasoningError(
          `Scripted reasoning model exhausted: no decision at index ${decideIndex}`,
        );
      }
      decideIndex += 1;
      return { ...decision };
    },
  };

  return {
    model,
    getAnalyzeCalls: () => analyzeCalls,
    getDecideCalls: () => decideCalls,
  };
}

/**
 * Creates a ReasoningModel that always returns fixed analysis and decision.
 */
export function fixedReasoningModel(
  analysis: FailureAnalysis,
  decision: RepairDecision,
): ReasoningModel {
  return {
    name: 'fixed',
    async analyzeFailure(): Promise<FailureAnalysis> {
      return { ...analysis };
    },
    async decideRepair(): Promise<RepairDecision> {
      return { ...decision };
    },
  };
}

/**
 * Creates a ReasoningModel that fails with a specific error.
 */
export function failingReasoningModel(error: Error): ReasoningModel {
  return {
    name: 'failing',
    async analyzeFailure(): Promise<FailureAnalysis> {
      throw error;
    },
    async decideRepair(): Promise<RepairDecision> {
      throw error;
    },
  };
}

/**
 * Creates a ReasoningModel that checks abort signal and throws on cancellation.
 */
export function cancellingReasoningModel(): ReasoningModel {
  return {
    name: 'cancelling',
    async analyzeFailure(input: FailureAnalysisInput): Promise<FailureAnalysis> {
      throw new ReasoningError('Operation cancelled by signal', { code: 'CODING_CANCELLED' });
    },
    async decideRepair(input: RepairDecisionInput): Promise<RepairDecision> {
      throw new ReasoningError('Operation cancelled by signal', { code: 'CODING_CANCELLED' });
    },
  };
}

/**
 * Creates a ReasoningModel that delegates to custom functions.
 */
export function customReasoningModel(
  analyze: (input: FailureAnalysisInput) => Promise<FailureAnalysis>,
  decide: (input: RepairDecisionInput) => Promise<RepairDecision>,
  name = 'custom',
): ReasoningModel {
  return {
    name,
    async analyzeFailure(input: FailureAnalysisInput): Promise<FailureAnalysis> {
      return analyze(input);
    },
    async decideRepair(input: RepairDecisionInput): Promise<RepairDecision> {
      return decide(input);
    },
  };
}

/** Default analysis for common failure categories (fallback). */
export function defaultAnalysis(input: FailureAnalysisInput): FailureAnalysis {
  const category = inferCategory(input.diagnostics);
  return {
    diagnosis: `Verification failed at attempt ${input.attempt}: ${category}`,
    category,
    confidence: 0.5,
    suggestedPaths: extractPaths(input.diagnostics),
    estimatedComplexity: 3,
  };
}

/** Default repair decision for common scenarios. */
export function defaultDecision(input: RepairDecisionInput): RepairDecision {
  const scope = input.analysis.estimatedComplexity > 5 ? 'BROAD' : 'MINIMAL';
  return {
    strategy: input.analysis.category === 'TYPE_ERROR' ? 'PATCH' : 'REWRITE',
    reason: `Default strategy for ${input.analysis.category}`,
    targetFiles: input.analysis.suggestedPaths,
    scope,
  };
}

function inferCategory(diagnostics: Diagnostics): FailureAnalysis['category'] {
  if (diagnostics.diagnostics.some((d) => d.category === 'COMPILER')) return 'TYPE_ERROR';
  if (diagnostics.diagnostics.some((d) => d.category === 'TEST')) return 'TEST_FAILURE';
  if (diagnostics.diagnostics.some((d) => d.category === 'LINT')) return 'LINT_ERROR';
  if (diagnostics.diagnostics.some((d) => d.category === 'COMMAND')) return 'COMMAND_ERROR';
  return 'OTHER';
}

function extractPaths(diagnostics: Diagnostics): string[] {
  const paths = new Set<string>();
  for (const d of diagnostics.diagnostics) {
    if (d.file) paths.add(d.file);
  }
  return Array.from(paths);
}