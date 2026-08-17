/**
 * @devforge/execution — Executor types (DF-016A).
 *
 * The Executor is a deterministic orchestration engine. It consumes a
 * validated ExecutionPlan, schedules its steps, and coordinates the
 * Workspace, CommandRunner, and GitService subsystems. It contains no
 * model calls, no code generation, and no repair loop.
 */

import type { ExecutionPlan, PlanStep, PlanStepType } from '@devforge/planner';
import type { Command, CommandRunner } from '../command/types.js';
import type { GitService } from '../git/types.js';
import type { Workspace } from '../workspace/workspace.js';
import type { ExecutionEvent } from './events.js';

/** Lifecycle status exposed by an executor. */
export type ExecutionStatus =
  | 'IDLE'
  | 'RUNNING'
  | 'WAITING_CONFIRMATION'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/** Identifier of the deterministic state the executor is in. */
export type ExecutorStateName =
  | 'INITIAL'
  | 'PLAN_VALIDATED'
  | 'READY'
  | 'STEP_STARTED'
  | 'STEP_EXECUTING'
  | 'WAIT_CONFIRMATION'
  | 'STEP_COMPLETED'
  | 'STEP_FAILED'
  | 'NEXT_STEP'
  | 'EXECUTION_FAILED'
  | 'DONE'
  | 'CANCELLED';

/** A command specification for a COMMAND step, keyed by step id. */
export interface CommandSpec {
  readonly command: Command;
  readonly args: readonly string[];
  /** Working directory. Defaults to the workspace root. */
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly allowFailure?: boolean;
}

/** A verification target run by a VERIFY step (CommandRunner only). */
export interface VerificationTarget {
  readonly id: string;
  readonly command: Command;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

/** Outcome of a single verification target. */
export interface VerificationOutcome {
  readonly targetId: string;
  readonly success: boolean;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly output: string;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
}

/** Result of running a sequence of verification targets. */
export interface VerificationResult {
  readonly ok: boolean;
  readonly targets: readonly VerificationOutcome[];
  /** Id of the first failing target, when any. */
  readonly failedTargetId?: string;
  readonly durationMs: number;
  readonly cancelled: boolean;
}

/** Category of a rollback-capable operation (metadata only, no execution). */
export type RollbackKind =
  | 'WORKSPACE_WRITE'
  | 'WORKSPACE_CREATE'
  | 'WORKSPACE_DELETE'
  | 'WORKSPACE_RENAME'
  | 'WORKSPACE_MOVE'
  | 'GIT_COMMIT'
  | 'GIT_RESTORE'
  | 'COMMAND';

/** A single rollback-capable operation recorded by the executor. */
export interface RollbackCapable {
  readonly stepId: string;
  readonly kind: RollbackKind;
  /** Opaque, deterministic token identifying the recorded operation. */
  readonly token: string;
  readonly description: string;
}

/** Rollback metadata collected for one step (metadata only; never executed). */
export interface RollbackRecord {
  readonly stepId: string;
  readonly token: string;
  readonly operations: readonly RollbackCapable[];
}

/** Result produced by a step handler. */
export interface StepResult {
  readonly ok: boolean;
  readonly summary?: string;
  readonly output?: string;
  readonly detail?: string;
  /** Rollback-capable operations performed by this step, if any. */
  readonly rollback?: readonly RollbackCapable[];
}

/** Context handed to a step handler. */
export interface StepContext {
  readonly step: PlanStep;
  readonly plan: ExecutionPlan;
  readonly workspace: Workspace;
  readonly runner: CommandRunner;
  readonly git: GitService;
  readonly signal: AbortSignal;
  readonly clock: () => number;
}

/** A handler that executes one step deterministically. */
export type StepHandler = (
  ctx: StepContext,
) => StepResult | Promise<StepResult>;

/** A structured step failure. */
export interface StepError {
  readonly code: string;
  readonly message: string;
}

/** Record of a single step execution, captured for the report. */
export interface StepExecutionRecord {
  readonly stepId: string;
  readonly title: string;
  readonly type: PlanStepType;
  readonly status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly durationMs: number;
  readonly summary?: string;
  readonly output?: string;
  readonly error?: StepError;
  readonly rollback?: readonly RollbackCapable[];
}

/** Structured terminal error carried by a report. */
export interface ReportError {
  readonly code: string;
  readonly message: string;
  readonly stepId?: string;
}

/** A deterministic execution report produced by the executor. */
export interface ExecutionReport {
  readonly planId: string;
  readonly goal: string;
  readonly summary: string;
  readonly status: ExecutionStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly durationMs: number;
  readonly steps: readonly StepExecutionRecord[];
  readonly rollback: readonly RollbackRecord[];
  readonly error?: ReportError;
  readonly eventCount: number;
  // DF-016B autonomous coding extensions (optional for backward compatibility)
  readonly patchesGenerated?: number;
  readonly repairAttempts?: number;
  readonly diagnostics?: readonly DiagnosticsSummary[];
  readonly transactions?: readonly TransactionSummary[];
  readonly modelCalls?: number;
  readonly verificationRuns?: number;
  readonly rollbackCount?: number;
}

/** Summary of diagnostics captured during autonomous coding. */
export interface DiagnosticsSummary {
  readonly source: string;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly verificationDurationMs: number;
}

/** Summary of a workspace transaction. */
export interface TransactionSummary {
  readonly order: number;
  readonly kind: 'initial' | 'repair';
  readonly patchesApplied: number;
  readonly status: 'COMMITTED' | 'ROLLED_BACK';
}

/** Options accepted by {@link Executor.execute}. */
export interface ExecuteOptions {
  /** Stable identifier of the plan run. Derived deterministically from the goal when omitted. */
  readonly planId?: string;
  /** Abort the run before, during, or between steps. */
  readonly signal?: AbortSignal;
}

/** Configuration accepted by {@link createExecutor}. */
export interface ExecutorConfig {
  /** Absolute path of the workspace root. */
  readonly workspaceRoot: string;
  /** Injected CommandRunner. Defaults to one scoped to `workspaceRoot`. */
  readonly runner?: CommandRunner;
  /** Injected GitService. Defaults to one bound to `workspaceRoot`. */
  readonly git?: GitService;
  /** Injected Workspace. Defaults to one bound to `workspaceRoot`. */
  readonly workspace?: Workspace;
  /** Override handlers per step type. Built-ins cover COMMAND and VERIFY. */
  readonly handlers?: Partial<Record<PlanStepType, StepHandler>>;
  /** Command specifications for COMMAND steps, keyed by step id. */
  readonly commandSteps?: Readonly<Record<string, CommandSpec>>;
  /** Verification targets for VERIFY steps. Defaults to a typecheck target. */
  readonly verificationTargets?: readonly VerificationTarget[];
  /** Steps whose operations are rollback-capable. Tokens are recorded, never executed. */
  readonly rollbackCapableSteps?: readonly string[];
  /** Time source. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** The public Executor surface. */
export interface Executor {
  readonly status: ExecutionStatus;
  readonly state: ExecutorStateName;
  readonly events: readonly ExecutionEvent[];
  /** Execute a validated plan to completion (or failure/cancellation). */
  execute(
    plan: ExecutionPlan,
    options?: ExecuteOptions,
  ): Promise<ExecutionReport>;
  /** Snapshot of the current or last execution report. Throws before any run. */
  report(): ExecutionReport;
  /** Resume a run paused for confirmation. */
  resume(): void;
  /** Cancel a running run. */
  cancel(reason?: string): void;
  /** Subscribe to events; returns an unsubscribe function. */
  onEvent(listener: (event: ExecutionEvent) => void): () => void;
}
