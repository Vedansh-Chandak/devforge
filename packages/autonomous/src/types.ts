/**
 * @devforge/autonomous — Core types for the autonomous coding agent (DF-019).
 *
 * The agent transforms DevForge from an execution engine into a
 * self-improving software engineering agent. It plans, generates patches,
 * applies them, verifies, and repairs until success or a terminal condition.
 */

import type { CodePatch } from '@devforge/execution';
import type { VerificationResult } from '@devforge/execution';
import type { ExecutionPlan } from '@devforge/planner';

/** Lifecycle status the agent exposes while a run is in flight. */
export type AgentStatus =
  | 'IDLE'
  | 'PLANNING'
  | 'GATHERING_CONTEXT'
  | 'GENERATING'
  | 'VERIFYING'
  | 'REPAIRING'
  | 'WAITING_CONFIRMATION'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/** Terminal reason a run stopped. Also used by the termination controller. */
export type TerminationReason =
  | 'VERIFICATION_PASSED'
  | 'MAX_ATTEMPTS_REACHED'
  | 'DUPLICATE_PATCH'
  | 'CONFIDENCE_BELOW_THRESHOLD'
  | 'USER_CANCELLED'
  | 'TIMEOUT'
  | 'PATCH_GENERATION_FAILED'
  | 'REPOSITORY_CHANGED_EXTERNALLY'
  | 'NO_REPAIR_PATH'
  | 'PLANNING_FAILED';

/** Coarse risk buckets used by the confidence engine. */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Coarse final outcome of an agent run. */
export type AgentOutcome =
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'TERMINATED';

/** Confidence metadata attached to every generated patch. */
export interface ConfidenceScore {
  /** Probability of success in [0,1]. */
  readonly confidence: number;
  /** Coarse risk derived deterministically from the patch shape. */
  readonly risk: RiskLevel;
  /** Expected probability the patch resolves the task in [0,1]. */
  readonly expectedSuccess: number;
  /** Expected blast radius / impact of the change in [0,1]. */
  readonly estimatedImpact: number;
  /** Human-readable reasons that contributed to the score. */
  readonly reasons: readonly string[];
}

/** Structured record of one patch-apply-verify attempt. */
export interface AttemptRecord {
  /** 1-based attempt number. */
  readonly attempt: number;
  /** Ids of the patches that were generated for this attempt. */
  readonly patchIds: readonly string[];
  /** Files targeted by the attempt (deduplicated, sorted). */
  readonly files: readonly string[];
  /** Human-readable summary of the patch set. */
  readonly summary: string;
  /** Deterministic fingerprint of the patch set. */
  readonly fingerprint: string;
  /** Whether verification passed for this attempt. */
  readonly verificationOk: boolean;
  /** Reason verification failed, when it did. */
  readonly failureReason?: string;
  /** Estimated token cost of the attempt. */
  readonly tokens?: number;
  /** Wall-clock duration of the attempt in ms. */
  readonly durationMs: number;
  /** Confidence awarded to the patch set (null when never scored). */
  readonly confidence: number | null;
  /** Timestamp (via the configured clock) when the attempt began. */
  readonly startedAt: number;
}

/** Snapshot of a single verification run inside the agent. */
export interface VerificationSnapshot {
  readonly attempt: number;
  /** Whether the verification passed. */
  readonly ok: boolean;
  /** Whether the run was cut off by the overall timeout. */
  readonly timedOut: boolean;
  /** Whether the run was cancelled (signal or timeout). */
  readonly cancelled: boolean;
  readonly result: VerificationResult;
  readonly startedAt: number;
  /** Wall-clock duration reported by the underlying runner. */
  readonly durationMs: number;
}

/** Input supplied to a context provider. */
export interface ContextRequest {
  readonly goal: string;
}

/** Injectable source of repository context used when generating patches. */
export interface ContextProvider {
  readonly name?: string;
  get(request: ContextRequest): Promise<readonly string[]>;
}

/** Result returned by the agent's {@link Agent.run} entrypoint. */
export interface AgentResult {
  readonly outcome: AgentOutcome;
  readonly goal: string;
  readonly status: AgentStatus;
  readonly terminationIndex: number;
  readonly terminationReason: TerminationReason | null;
  readonly terminationMessage: string;
  readonly attempts: readonly AttemptRecord[];
  readonly verifications: readonly VerificationSnapshot[];
  /** Total patches generated across initial + all repair generations. */
  readonly patchesGenerated: number;
  /** Number of repair generations performed. */
  readonly repairAttempts: number;
  /** Number of rollback operations performed. */
  readonly rollbacks: number;
  /** Estimated total tokens consumed. */
  readonly tokens: number;
  readonly durationMs: number;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly plan: ExecutionPlan | null;
  readonly confidenceGatePassed: boolean;
  readonly error: Error | null;
}

/** Observation emitted to the `onEvent` hook during a run. */
export interface AgentEvent {
  readonly sequence: number;
  readonly status: AgentStatus;
  readonly attempt: number;
  readonly goal: string;
  readonly message: string;
  readonly at: number;
}

/** Default budgets used when the caller does not supply explicit ones. */
export const AUTONOMOUS_DEFAULTS = {
  maxAttempts: 3,
  maxPatchGenerations: 5,
  timeoutMs: 120_000,
  confidenceThreshold: 0.7,
  maxStoredAttempts: 200,
  tokenGranularity: 4,
} as const;

/** Budgets type mirror of the defaults (all overridable). */
export interface AutonomousBudgets {
  readonly maxAttempts: number;
  readonly maxPatchGenerations: number;
  readonly timeoutMs: number;
  readonly confidenceThreshold: number;
  readonly maxStoredAttempts: number;
}