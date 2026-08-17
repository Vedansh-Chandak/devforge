/**
 * @devforge/multi-agent — Shared domain types (DF-022).
 *
 * Defines the vocabulary of the multi-agent platform: roles, tasks, results,
 * structured conversation messages, schedules and reports. This module holds
 * no orchestration logic — it only describes the shape of the system.
 */

/** The set of agent roles that participate in a run. */
export type AgentRole =
  | 'PLANNER'
  | 'CODER'
  | 'REVIEWER'
  | 'TESTER'
  | 'REPAIR'
  | 'DOCUMENTATION';

/** All valid roles, in canonical priority order (used for deterministic tie-breaking). */
export const AGENT_ROLES: readonly AgentRole[] = [
  'PLANNER',
  'CODER',
  'TESTER',
  'REVIEWER',
  'REPAIR',
  'DOCUMENTATION',
];

/** Canonical priority for a role: lower wins in deterministic merges. */
export function rolePriority(role: AgentRole): number {
  return AGENT_ROLES.indexOf(role);
}

/** Category of work a task represents. */
export type TaskKind =
  | 'PLAN'
  | 'IMPLEMENT'
  | 'REVIEW'
  | 'TEST'
  | 'REPAIR'
  | 'DOCUMENT';

/** All valid task kinds. */
export const TASK_KINDS: readonly TaskKind[] = [
  'PLAN',
  'IMPLEMENT',
  'REVIEW',
  'TEST',
  'REPAIR',
  'DOCUMENT',
];

/** Lifecycle status of a task. */
export type TaskStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED';

/** All valid task statuses. */
export const TASK_STATUSES: readonly TaskStatus[] = [
  'PENDING',
  'ASSIGNED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
];

/** Type of a produced artifact. */
export type ArtifactKind =
  | 'FILE'
  | 'PATCH'
  | 'NOTE'
  | 'DOC'
  | 'REPORT'
  | 'TEST'
  | 'PLAN';

/** All valid artifact kinds. */
export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'FILE',
  'PATCH',
  'NOTE',
  'DOC',
  'REPORT',
  'TEST',
  'PLAN',
];

/** A unit of work assigned to a single role agent. */
export interface Task {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly kind: TaskKind;
  readonly role: AgentRole;
  /** IDs of tasks that must complete successfully before this one may run. */
  readonly dependsOn: readonly string[];
  /** Optional target path the task operates on. */
  readonly target?: string;
  /** Whether running this task requires explicit user confirmation. */
  readonly requiresConfirmation: boolean;
  /** Per-attempt timeout for this task in milliseconds. */
  readonly timeoutMs: number;
  /** Number of retries allowed for retryable failures. */
  readonly maxRetries: number;
}

/** A structured error attached to a failed task. */
export interface TaskError {
  readonly code: string;
  readonly message: string;
  /** Whether a retry could reasonably succeed. */
  readonly retryable: boolean;
}

/** An artifact produced by an agent. */
export interface Artifact {
  /** Target file path or logical key the artifact belongs to. */
  readonly path: string;
  readonly kind: ArtifactKind;
  readonly content: string;
  /** Unique id; falls back to a deterministic hash when absent. */
  readonly id?: string;
  /** Patch hunks, present when {@link Artifact.kind} is `PATCH`. */
  readonly hunks?: readonly PatchRange[];
}

/** A line range within a file, used for patch overlap detection. */
export interface PatchRange {
  readonly startLine: number;
  readonly lineCount: number;
}

/** Outcome of a single task execution. */
export interface TaskResult {
  readonly taskId: string;
  readonly role: AgentRole;
  readonly kind: TaskKind;
  readonly ok: boolean;
  readonly status: TaskStatus;
  readonly artifacts: readonly Artifact[];
  /** Free-form messages the agent contributed to the conversation. */
  readonly messages: readonly string[];
  /** Number of attempts taken (1 + retries). */
  readonly attempts: number;
  readonly durationMs: number;
  readonly error: TaskError | null;
  /** Batch (topological level) the task executed in. */
  readonly batch?: number;
}

/** A batch of tasks that can run in parallel (level in the dependency DAG). */
export interface ScheduleBatch {
  readonly batchId: number;
  readonly tasks: readonly Task[];
}

/** A deterministic execution schedule derived from task dependencies. */
export interface Schedule {
  readonly batches: readonly ScheduleBatch[];
  /** Number of batches (critical path depth). */
  readonly depth: number;
  /** Deterministic execution order (task ids, topological with id tie-break). */
  readonly order: readonly string[];
}

/** Outcome of a whole run. */
export type RunOutcome = 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';

/** Result of a coordinated run. */
export interface RunResult {
  readonly runId: string;
  readonly ok: boolean;
  readonly outcome: RunOutcome;
  readonly tasks: readonly TaskResult[];
  readonly report: FinalReport;
  readonly cancelled: boolean;
  readonly timedOut: boolean;
}

/** Structured message type flowing through the conversation. */
export type MessageType =
  | 'RUN_STARTED'
  | 'TASK_ASSIGNED'
  | 'TASK_PROGRESS'
  | 'TASK_SUCCEEDED'
  | 'TASK_FAILED'
  | 'TASK_SKIPPED'
  | 'TASK_CANCELLED'
  | 'CONFIRMATION_PENDING'
  | 'CONFIRMATION_APPROVED'
  | 'CONFIRMATION_REJECTED'
  | 'VERIFICATION_STARTED'
  | 'VERIFICATION_PASSED'
  | 'VERIFICATION_FAILED'
  | 'REPAIR_REQUESTED'
  | 'REVIEW_COMMENT'
  | 'MERGED'
  | 'CONFLICT'
  | 'RUN_COMPLETED'
  | 'RUN_CANCELLED'
  | 'RUN_TIMED_OUT';

/** All valid message types. */
export const MESSAGE_TYPES: readonly MessageType[] = [
  'RUN_STARTED',
  'TASK_ASSIGNED',
  'TASK_PROGRESS',
  'TASK_SUCCEEDED',
  'TASK_FAILED',
  'TASK_SKIPPED',
  'TASK_CANCELLED',
  'CONFIRMATION_PENDING',
  'CONFIRMATION_APPROVED',
  'CONFIRMATION_REJECTED',
  'VERIFICATION_STARTED',
  'VERIFICATION_PASSED',
  'VERIFICATION_FAILED',
  'REPAIR_REQUESTED',
  'REVIEW_COMMENT',
  'MERGED',
  'CONFLICT',
  'RUN_COMPLETED',
  'RUN_CANCELLED',
  'RUN_TIMED_OUT',
];

/** A single structured message in a run conversation. */
export interface Message {
  /** Deterministic message id: `${runId}:${index}`. */
  readonly id: string;
  readonly runId: string;
  /** Monotonic sequence index, assigned in post order. */
  readonly index: number;
  readonly type: MessageType;
  /** Wall/run timestamp as reported by the run clock. */
  readonly at: number;
  readonly taskId?: string;
  readonly role?: AgentRole;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Short human-readable summary. */
  readonly summary: string;
}

/** A timeline entry derived from a message. */
export interface TimelineEntry {
  readonly index: number;
  readonly at: number;
  readonly type: MessageType;
  readonly taskId?: string;
  readonly role?: AgentRole;
  readonly summary: string;
}

/** Per-agent metrics aggregated for the final report. */
export interface AgentMetrics {
  readonly role: AgentRole;
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly skipped: number;
  readonly cancelled: number;
  readonly retried: number;
  readonly totalDurationMs: number;
  readonly artifactCount: number;
}

/** A node in the reported execution graph. */
export interface ExecutionGraphNode {
  readonly taskId: string;
  readonly title: string;
  readonly role: AgentRole;
  readonly kind: TaskKind;
  readonly status: TaskStatus;
  readonly dependsOn: readonly string[];
  readonly attempts: number;
  readonly durationMs: number;
  readonly batch: number;
}

/** Repair activity summary. */
export interface RepairSummary {
  readonly repairRequests: number;
  readonly repairTaskIds: readonly string[];
  readonly repaired: number;
  readonly unresolved: readonly string[];
}

/** Review activity summary. */
export interface ReviewSummary {
  readonly comments: number;
  readonly paths: readonly string[];
  readonly blocking: number;
}

/** Merge activity summary. */
export interface MergeSummary {
  readonly files: number;
  readonly deduped: number;
  readonly merged: number;
  readonly conflicts: number;
  readonly unresolved: number;
}

/** Verification summary (adapter over the existing Executor verification). */
export interface VerificationSummary {
  readonly ok: boolean;
  readonly targets: readonly string[];
  readonly failedTargetId: string | null;
  readonly durationMs: number;
  readonly attempts: number;
  readonly cancelled: boolean;
}

/** The final report produced at the end of a run. */
export interface FinalReport {
  readonly runId: string;
  readonly goal: string;
  readonly outcome: RunOutcome;
  readonly ok: boolean;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly durationMs: number;
  readonly timeline: readonly TimelineEntry[];
  readonly agents: readonly AgentMetrics[];
  readonly graph: readonly ExecutionGraphNode[];
  readonly repair: RepairSummary;
  readonly review: ReviewSummary;
  readonly merge: MergeSummary;
  readonly verification: VerificationSummary | null;
  readonly taskResults: readonly TaskResult[];
}
