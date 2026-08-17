/**
 * Reasoning limits — pure configuration and check helpers (DF-011.5 Phase 1).
 *
 * This module is intentionally free of side effects. It defines the
 * ReasoningLimits contract and pure functions used by the bounded
 * reasoning loop to decide whether a given limit has been reached.
 */

import type { TerminationReason } from './state.js';

/** Canonical limits governing a single bounded reasoning session. */
export interface ReasoningLimits {
  /** Maximum model provider generations across the entire ask(). Default: 5. */
  readonly maxModelCalls: number;
  /** Maximum tool rounds per ask(). Default: 4. */
  readonly maxToolRounds: number;
  /** Maximum total tool executions per ask(). Default: 10. */
  readonly maxToolExecutions: number;
  /** Maximum times the same tool+args fingerprint may execute. Default: 2. */
  readonly maxRepeatedToolCalls: number;
  /** Maximum wall-clock duration of ask() in milliseconds. Default: 30_000. */
  readonly maxDurationMs: number;
  /** Maximum cumulative evidence bytes before truncation. Default: 500_000. */
  readonly maxEvidenceBytes: number;
  /** Consecutive no-progress rounds before termination. Default: 2. */
  readonly maxNoProgressRounds: number;
}

/** Built-in defaults used when no overrides are provided. */
export const DEFAULT_REASONING_LIMITS: Readonly<ReasoningLimits> = Object.freeze({
  maxModelCalls: 5,
  maxToolRounds: 4,
  maxToolExecutions: 10,
  maxRepeatedToolCalls: 2,
  maxDurationMs: 30_000,
  maxEvidenceBytes: 500_000,
  maxNoProgressRounds: 2,
});

/**
 * Merge user overrides with defaults. Validates the resulting limits
 * are positive finite numbers. Returns a fresh object each call.
 */
export function resolveReasoningLimits(
  overrides?: Partial<ReasoningLimits>,
): ReasoningLimits {
  const d = DEFAULT_REASONING_LIMITS;
  const merged: ReasoningLimits = {
    maxModelCalls: overrides?.maxModelCalls ?? d.maxModelCalls,
    maxToolRounds: overrides?.maxToolRounds ?? d.maxToolRounds,
    maxToolExecutions: overrides?.maxToolExecutions ?? d.maxToolExecutions,
    maxRepeatedToolCalls: overrides?.maxRepeatedToolCalls ?? d.maxRepeatedToolCalls,
    maxDurationMs: overrides?.maxDurationMs ?? d.maxDurationMs,
    maxEvidenceBytes: overrides?.maxEvidenceBytes ?? d.maxEvidenceBytes,
    maxNoProgressRounds: overrides?.maxNoProgressRounds ?? d.maxNoProgressRounds,
  };
  validateReasoningLimits(merged);
  return merged;
}

/** Throw when any limit is not a positive finite number. */
export function validateReasoningLimits(limits: ReasoningLimits): void {
  for (const [key, value] of Object.entries(limits) as [keyof ReasoningLimits, number][]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(
        `Invalid reasoning limit ${String(key)}: must be a positive finite number, got ${String(value)}`,
      );
    }
  }
}

/** True when the model-call budget has been exhausted. */
export function isModelCallLimit(providerCalls: number, limits: ReasoningLimits): boolean {
  return providerCalls >= limits.maxModelCalls;
}

/** True when the tool-round budget has been exhausted. */
export function isToolRoundLimit(toolRoundsCompleted: number, limits: ReasoningLimits): boolean {
  return toolRoundsCompleted >= limits.maxToolRounds;
}

/** True when the tool-execution budget has been exhausted. */
export function isToolExecutionLimit(totalToolExecutions: number, limits: ReasoningLimits): boolean {
  return totalToolExecutions >= limits.maxToolExecutions;
}

/** True when the session deadline has passed. */
export function isDeadlineExceeded(nowMs: number, deadlineMs: number): boolean {
  return nowMs > deadlineMs;
}

/** True when the session has been cancelled. */
export function isCancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/**
 * Guard checked at the top of every outer-loop iteration.
 * Returns the termination reason when a limit trips, or null to continue.
 * Pure function — same inputs always give the same output.
 */
export function checkOuterGuards(input: {
  readonly providerCalls: number;
  readonly toolRoundsCompleted: number;
  readonly totalToolExecutions: number;
  readonly nowMs: number;
  readonly deadlineMs: number;
  readonly signal?: AbortSignal;
  readonly limits: ReasoningLimits;
}): TerminationReason | null {
  const { limits } = input;
  if (isCancelled(input.signal)) return 'CANCELLED';
  if (isDeadlineExceeded(input.nowMs, input.deadlineMs)) return 'TIME_LIMIT';
  if (isModelCallLimit(input.providerCalls, limits)) return 'MODEL_CALL_LIMIT';
  if (isToolRoundLimit(input.toolRoundsCompleted, limits)) return 'TOOL_ROUND_LIMIT';
  if (isToolExecutionLimit(input.totalToolExecutions, limits)) return 'TOOL_EXECUTION_LIMIT';
  return null;
}
