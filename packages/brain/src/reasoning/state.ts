/**
 * Reasoning state — plain data + safe update helpers (DF-011.5 Phase 1).
 *
 * ReasoningState is a plain serialisable object. The `ReasoningStateKit`
 * class wraps a state instance and provides mutation methods that enforce
 * invariants (no negatives, etc.) without exposing raw field writes.
 */

/** Why the bounded reasoning loop terminated. */
export type TerminationReason =
  | 'TEXT_FINAL_ANSWER'
  | 'MODEL_CALL_LIMIT'
  | 'TOOL_ROUND_LIMIT'
  | 'TOOL_EXECUTION_LIMIT'
  | 'REPEATED_TOOL_CALL_LIMIT'
  | 'NO_PROGRESS'
  | 'TIME_LIMIT'
  | 'CANCELLED'
  | 'ALL_TOOLS_REJECTED'
  | 'CONTINUE';

/** Canonical counters and marks tracked during a bounded reasoning session. */
export interface ReasoningState {
  /** Total model provider generations so far. */
  providerCalls: number;
  /** Total tool rounds completed. */
  toolRoundsCompleted: number;
  /** Total tool executions performed. */
  totalToolExecutions: number;
  /** Number of tool calls suppressed as repeated-work duplicates. */
  duplicateSuppressions: number;
  /** Cumulative evidence bytes accumulated. */
  totalEvidenceBytes: number;
  /** Consecutive rounds that produced no new usable evidence. */
  consecutiveNoProgressRounds: number;
  /** Absolute wall-clock deadline (ms epoch). */
  readonly startTimeMs: number;
  /** Absolute wall-clock deadline (ms epoch). */
  readonly deadlineMs: number;
  /** Set once the loop commits to a termination reason. */
  terminationReason: TerminationReason | null;
}

/** Factory for a fresh state at the given start time and deadline. */
export function createReasoningState(startTimeMs: number, deadlineMs: number): ReasoningState {
  return {
    providerCalls: 0,
    toolRoundsCompleted: 0,
    totalToolExecutions: 0,
    duplicateSuppressions: 0,
    totalEvidenceBytes: 0,
    consecutiveNoProgressRounds: 0,
    startTimeMs,
    deadlineMs,
    terminationReason: null,
  };
}

function clampNonNegativeInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/**
 * Safe state mutator. Methods clamp inputs so counters can never go
 * negative or non-integral, and the terminationReason can only be set
 * once (subsequent writes are ignored — first decision wins).
 */
export class ReasoningStateKit {
  constructor(readonly state: ReasoningState) {}

  /** Add `delta` model calls. Returns new total. */
  addProviderCalls(delta = 1): number {
    this.state.providerCalls = clampNonNegativeInt(this.state.providerCalls + delta);
    return this.state.providerCalls;
  }

  /** Add `delta` completed tool rounds. Returns new total. */
  addToolRound(delta = 1): number {
    this.state.toolRoundsCompleted = clampNonNegativeInt(this.state.toolRoundsCompleted + delta);
    return this.state.toolRoundsCompleted;
  }

  /** Add `delta` tool executions. Returns new total. */
  addToolExecutions(delta: number): number {
    this.state.totalToolExecutions = clampNonNegativeInt(this.state.totalToolExecutions + delta);
    return this.state.totalToolExecutions;
  }

  /** Add `delta` duplicate-suppression events. Returns new total. */
  addDuplicateSuppressions(delta: number): number {
    this.state.duplicateSuppressions = clampNonNegativeInt(this.state.duplicateSuppressions + delta);
    return this.state.duplicateSuppressions;
  }

  /** Add `delta` evidence bytes. Returns new total. */
  addEvidenceBytes(delta: number): number {
    this.state.totalEvidenceBytes = clampNonNegativeInt(this.state.totalEvidenceBytes + delta);
    return this.state.totalEvidenceBytes;
  }

  /** Record a no-progress round. Returns new consecutive count. */
  incrementNoProgress(): number {
    this.state.consecutiveNoProgressRounds = clampNonNegativeInt(
      this.state.consecutiveNoProgressRounds + 1,
    );
    return this.state.consecutiveNoProgressRounds;
  }

  /** Reset the no-progress streak (called when progress IS made). */
  resetNoProgress(): void {
    this.state.consecutiveNoProgressRounds = 0;
  }

  /**
   * Set the termination reason. Only the first call wins; subsequent
   * calls are ignored to protect deterministic termination.
   */
  setTerminationReason(reason: TerminationReason): void {
    if (this.state.terminationReason === null) {
      this.state.terminationReason = reason;
    }
  }
}
