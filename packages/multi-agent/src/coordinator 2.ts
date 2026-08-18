/**
 * @devforge/multi-agent — Coordinator (DF-022).
 *
 * Orchestrates the full multi-agent pipeline: decompose → route → validate →
 * schedule → run via the agent pool → merge → verify → repair → report. It
 * owns confirmation propagation, cancellation and the global policy, while
 * the execution mechanics (parallelism, retries, timeout) live in the
 * scheduler.
 */

import type {
  FinalReport,
  MergeSummary,
  RepairSummary,
  ReviewSummary,
  RunOutcome,
  RunResult,
  Schedule,
  Task,
  TaskResult,
  VerificationSummary,
} from './types.js';
import { Conversation } from './conversation.js';
import { createContext, type AgentContext } from './context.js';
import { AgentPool } from './agent-pool.js';
import { Scheduler } from './scheduler.js';
import { createPlannerAgent } from './roles/planner-agent.js';
import { createCoderAgent } from './roles/coder-agent.js';
import { createReviewerAgent } from './roles/reviewer-agent.js';
import { createTesterAgent } from './roles/tester-agent.js';
import { createRepairAgent } from './roles/repair-agent.js';
import { createDocumentationAgent } from './roles/documentation-agent.js';
import { decomposeRequest, toTask, type DecomposedTask } from './selection/task-decomposer.js';
import { roleForKind } from './selection/task-router.js';
import { validateGraph } from './selection/dependency-graph.js';
import { MergeManager, mergeResults, type MergeOutcome } from './execution/merge-manager.js';
import { ExecutorVerifier, fixedVerifier, type Verifier } from './execution/verification.js';
import { buildReport } from './execution/report.js';
import {
  runCancelled,
  runCompleted,
  runStarted,
  runTimedOut,
  merged,
  conflict,
  confirmationPending,
  confirmationApproved,
  confirmationRejected,
  repairRequested,
} from './message.js';

/**
 * Modes for handling tasks that require explicit confirmation. In
 * `REQUIRE_APPROVAL` the coordinator asks the injected `confirm` callback and
 * waits for its decision; rejected tasks are recorded as skipped.
 */
export type ConfirmationMode = 'AUTO_APPROVE' | 'REQUIRE_APPROVAL' | 'REJECT';

/** Coordinator configuration / policy. */
export interface CoordinatorConfig {
  readonly maxParallelism: number;
  readonly globalTimeoutMs: number;
  readonly defaultTaskTimeoutMs: number;
  readonly defaultMaxRetries: number;
  readonly retryDelayMs: number;
  readonly confirmationMode: ConfirmationMode;
  readonly maxRepairRounds: number;
  readonly requireConfirmation: boolean;
}

const DEFAULT_NOW: () => number = () => Date.now();
const DEFAULT_SLEEP: (ms: number) => Promise<void> = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Default policy values. */
export const COORDINATOR_DEFAULTS: CoordinatorConfig = {
  maxParallelism: 4,
  globalTimeoutMs: 300000,
  defaultTaskTimeoutMs: 60000,
  defaultMaxRetries: 1,
  retryDelayMs: 100,
  confirmationMode: 'AUTO_APPROVE',
  maxRepairRounds: 2,
  requireConfirmation: false,
};

/** Overridable dependencies — the seam for deterministic tests. */
export interface CoordinatorDeps {
  readonly pool?: AgentPool;
  readonly decompose?: typeof decomposeRequest;
  readonly scheduler?: Scheduler;
  readonly merge?: MergeManager;
  readonly verifier?: Verifier;
  readonly report?: typeof buildReport;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Per-run options. */
export interface RunOptions {
  readonly goal: string;
  /** Pre-decomposed routed tasks; defaults to decomposing the goal. */
  readonly tasks?: readonly Task[];
  readonly confirmationMode?: ConfirmationMode;
  /** Decision callback for tasks requiring confirmation. */
  readonly confirm?: (task: Task) => Promise<boolean> | boolean;
  readonly cancelSignal?: AbortSignal;
  readonly verifier?: Verifier;
}

/** Accumulated state of a run, carried through the pipeline. */
interface RunState {
  readonly runId: string;
  readonly goal: string;
  readonly startedAt: number;
  readonly conversation: Conversation;
  readonly context: AgentContext;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  tasks: readonly Task[];
  results: TaskResult[];
  schedule: Schedule;
  merge: MergeOutcome;
  verification: VerificationSummary;
  repair: RepairSummary;
  review: ReviewSummary;
  cancelled: boolean;
  timedOut: boolean;
}

/** Orchestrates a full multi-agent run. */
export class Coordinator {
  private readonly config: CoordinatorConfig;
  private readonly pool_: AgentPool;
  private readonly decompose_: (request: string) => readonly DecomposedTask[];
  private readonly scheduler_: Scheduler;
  private readonly merge_: MergeManager;
  private readonly verifier_: Verifier;
  private readonly report_: typeof buildReport;
  private readonly now_: () => number;
  private readonly sleep_: (ms: number) => Promise<void>;
  private runCounter = 0;

  constructor(config: Partial<CoordinatorConfig> = {}, deps: CoordinatorDeps = {}) {
    this.config = { ...COORDINATOR_DEFAULTS, ...config };
    this.pool_ = deps.pool ?? new AgentPool();
    this.decompose_ = deps.decompose ?? decomposeRequest;
    this.scheduler_ =
      deps.scheduler ??
      new Scheduler({
        maxParallelism: this.config.maxParallelism,
        retryDelayMs: this.config.retryDelayMs,
        defaultTaskTimeoutMs: this.config.defaultTaskTimeoutMs,
        defaultMaxRetries: this.config.defaultMaxRetries,
        globalTimeoutMs: this.config.globalTimeoutMs,
        now: deps.now ?? DEFAULT_NOW,
        sleep: deps.sleep ?? DEFAULT_SLEEP,
      });
    this.merge_ = deps.merge ?? new MergeManager();
    this.verifier_ = deps.verifier ?? fixedVerifier(true);
    this.report_ = deps.report ?? buildReport;
    this.now_ = deps.now ?? DEFAULT_NOW;
    this.sleep_ = deps.sleep ?? DEFAULT_SLEEP;
  }

  /** The agent pool backing this coordinator. */
  get pool(): AgentPool {
    return this.pool_;
  }

  /** Register all six default role agents in the pool. */
  withDefaultAgents(): this {
    const pool = this.pool_;
    pool.register(createPlannerAgent());
    pool.register(createCoderAgent());
    pool.register(createReviewerAgent());
    pool.register(createTesterAgent());
    pool.register(createRepairAgent());
    pool.register(createDocumentationAgent());
    return this;
  }

  /** Run the full pipeline for a request. */
  async run(goal: string, options: RunOptions = { goal }): Promise<RunResult> {
    this.runCounter += 1;
    const state = this.begin(goal, this.runCounter, options);
    const summary = await this.executePipeline(state, options);
    const report = this.finish(state, summary.outcome, summary.ok);
    return {
      runId: state.runId,
      ok: summary.ok,
      outcome: summary.outcome,
      tasks: state.results,
      report,
      cancelled: state.cancelled,
      timedOut: state.timedOut,
    };
  }

  /** Create the run conversation, context and initial decomposition. */
  private begin(goal: string, runNumber: number, options: RunOptions = { goal: '' }): RunState {
    const runId = `run-${runNumber}`;
    const conversation = new Conversation(runId);
    conversation.post(runStarted({ at: this.now_(), goal }));

    const context = createContext({
      runId,
      workspaceRoot: '.',
      conversation,
      now: this.now_,
      signal: options.cancelSignal,
    });

    let tasks: readonly Task[];
    if (options.tasks) {
      tasks = options.tasks;
    } else {
      const parts = this.decompose_(goal);
      tasks = parts.map((part) =>
        toTask(part, roleForKind(part.kind), {
          timeoutMs: this.config.defaultTaskTimeoutMs,
          maxRetries: this.config.defaultMaxRetries,
        }),
      );
    }

    // Structural validation throws typed errors for cycles/duplicates/missing deps.
    const result = validateGraph(tasks);
    const schedule = this.scheduler_.plan(validateOrder(tasks, result.order));

    return {
      runId,
      goal,
      startedAt: this.now_(),
      conversation,
      context,
      now: this.now_,
      sleep: this.sleep_,
      tasks,
      results: [],
      schedule,
      merge: emptyMergeOutcome(),
      verification: failedVerificationSummary(),
      repair: { repairRequests: 0, repairTaskIds: [], repaired: 0, unresolved: [] },
      review: { comments: 0, paths: [], blocking: 0 },
      cancelled: false,
      timedOut: false,
    };
  }

  /** Core pipeline: confirmations → execute → merge → verify (+repair). */
  private async executePipeline(
    state: RunState,
    options: RunOptions,
  ): Promise<{ outcome: RunOutcome; ok: boolean }> {
    const approved = await this.propagateConfirmations(state, options);
    const schedule = this.scheduler_.plan(approved);
    state.schedule = schedule;

    const rejectedResults: TaskResult[] = state.tasks
      .filter((task) => !approved.includes(task))
      .map((task) => ({
        taskId: task.id,
        role: task.role,
        kind: task.kind,
        ok: false,
        status: 'SKIPPED' as const,
        artifacts: [],
        messages: [],
        attempts: 0,
        durationMs: 0,
        error: {
          code: 'MA_CONFIRMATION_REJECTED',
          message: 'confirmation rejected',
          retryable: false,
        },
      }));

    const outcome = await this.scheduler_.execute(approved, this.runTask, state.context);
    state.timedOut = outcome.timedOut;
    state.cancelled = outcome.cancelled;

    state.results = orderResults([...outcome.results, ...rejectedResults], state.tasks);
    state.merge = this.merge_.merge(state.results);
    this.reportMerge(state);

    // Verification + bounded repair loop.
    const verifier = options.verifier ?? this.verifier_;
    state.verification = await this.verifyLoop(verifier, state);

    const { outcome: finalOutcome, ok } = this.decideOutcome(state);
    return { outcome: finalOutcome, ok };
  }

  /** Ask for confirmations; rejected tasks are dropped (dependents auto-skip). */
  private async propagateConfirmations(state: RunState, options: RunOptions): Promise<readonly Task[]> {
    const mode = options.confirmationMode ?? this.config.confirmationMode;
    const confirm = options.confirm ?? (() => mode === 'AUTO_APPROVE');
    const requiresConfirmation =
      this.config.requireConfirmation;

    const selected: Task[] = [];
    for (const task of state.tasks) {
      const needs = task.requiresConfirmation || requiresConfirmation;
      if (!needs) {
        selected.push(task);
        continue;
      }
      state.conversation.post(
        confirmationPending({
          at: state.now(),
          taskId: task.id,
          role: task.role,
          title: task.title,
        }),
      );
      const decision = await confirm(task);
      if (decision) {
        state.conversation.post(confirmationApproved({ at: state.now(), taskId: task.id }));
        selected.push(task);
      } else {
        state.conversation.post(confirmationRejected({ at: state.now(), taskId: task.id }));
      }
    }
    return selected;
  }

  /** Run one task through the pool's role agent. */
  private runTask = async (task: Task, ctx: AgentContext, _attempt: number): Promise<TaskResult> => {
    const agent = this.pool_.require(task.role);
    return agent.run(task, ctx);
  };

  /** Post merge + conflict messages for the current run. */
  private reportMerge(state: RunState): void {
    const conflicts = state.merge.conflicts;
    state.conversation.post(
      merged({
        at: state.now(),
        files: state.merge.filesMerged,
        conflicts: conflicts.length,
      }),
    );
    for (const c of conflicts) {
      state.conversation.post(
        conflict({ at: state.now(), path: c.path, taskIds: c.taskIds }),
      );
    }
  }

  /** Verify, and repair on failure up to `maxRepairRounds`. */
  private async verifyLoop(verifier: Verifier, state: RunState): Promise<VerificationSummary> {
    let summary = await verifier.verify(state.context);
    let repairAttempts = 0;

    while (!summary.ok && repairAttempts < this.config.maxRepairRounds) {
      if (state.merge.conflicts.some((c) => !c.resolved)) {
        break;
      }
      repairAttempts += 1;
      state.repair = {
        ...state.repair,
        repairRequests: state.repair.repairRequests + 1,
      };
      state.conversation.post(
        repairRequested({
          at: state.now(),
          target: summary.failedTargetId ?? 'build',
          failure: `verification failed at ${summary.failedTargetId ?? 'unknown'}`,
          attempt: repairAttempts,
        }),
      );

      // Run a fresh repair task through the REPAIR agent.
      const repairTask = repairFor(repairAttempts, summary.failedTargetId ?? 'build', this.config);
      const repairOutcome = await this.scheduler_.execute(
        [repairTask],
        this.runTask,
        state.context,
      );
      const repairResults = repairOutcome.results;
      state.results = [...state.results, ...repairResults];
      state.repair = {
        repairRequests: state.repair.repairRequests,
        repairTaskIds: [...state.repair.repairTaskIds, repairTask.id],
        repaired: repairResults.some((r) => r.status === 'SUCCEEDED')
          ? state.repair.repaired + 1
          : state.repair.repaired,
        unresolved: repairResults.some((r) => r.status !== 'SUCCEEDED')
          ? [...state.repair.unresolved, repairTask.id]
          : state.repair.unresolved,
      };
      state.merge = this.merge_.merge(state.results);
      this.reportMerge(state);

      summary = await verifier.verify(state.context, {
        attempts: repairAttempts + 1,
      });
    }
    return { ...summary, attempts: repairAttempts + 1 };
  }

  /** Decide the final outcome and post the terminal message. */
  private decideOutcome(state: RunState): { outcome: RunOutcome; ok: boolean } {
    if (state.timedOut) {
      state.conversation.post(runTimedOut({ at: state.now() }));
      return { outcome: 'TIMED_OUT', ok: false };
    }
    if (state.cancelled) {
      state.conversation.post(runCancelled({ at: state.now() }));
      return { outcome: 'CANCELLED', ok: false };
    }
    if (state.verification.ok) {
      state.conversation.post(runCompleted({ at: state.now(), outcome: 'SUCCESS', ok: true }));
      return { outcome: 'SUCCESS', ok: true };
    }
    state.conversation.post(runCompleted({ at: state.now(), outcome: 'FAILED', ok: false }));
    return { outcome: 'FAILED', ok: false };
  }

  /** Build the final report from the accumulated run state. */
  private finish(state: RunState, outcome: RunOutcome, ok: boolean): FinalReport {
    const finishedAt = state.now();
    const review = summarizeReviews(state.conversation);
    const mergeSummary: MergeSummary = {
      files: state.merge.filesMerged,
      deduped: state.merge.deduped,
      merged: Math.max(0, state.merge.filesMerged - state.merge.conflicts.length),
      conflicts: state.merge.conflicts.length,
      unresolved: state.merge.conflicts.filter((c) => !c.resolved).length,
    };
    return this.report_({
      runId: state.runId,
      goal: state.goal,
      outcome,
      ok,
      startedAt: state.startedAt,
      finishedAt,
      conversation: state.conversation,
      schedule: state.schedule,
      tasks: state.results,
      taskPlan: state.tasks,
      repair: state.repair,
      review,
      merge: mergeSummary,
      verification: state.verification,
    });
  }
}

/** Deterministically order results to match the original task order. */
function orderResults(results: readonly TaskResult[], tasks: readonly Task[]): TaskResult[] {
  const byId = new Map(results.map((r) => [r.taskId, r]));
  const ordered: TaskResult[] = [];
  for (const task of tasks) {
    const result = byId.get(task.id);
    if (result) ordered.push(result);
  }
  // Append any extra results (e.g. repairs) not in the original task list.
  for (const result of results) {
    if (!tasks.some((t) => t.id === result.taskId)) {
      ordered.push(result);
    }
  }
  return ordered;
}

/** Ensure the scheduler sees the same ordering the graph validated. */
function validateOrder(tasks: readonly Task[], graphOrder: readonly string[]): readonly Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return graphOrder.map((id) => byId.get(id)!);
}

/** Build a synthetic repair task. */
function repairFor(index: number, target: string, config: CoordinatorConfig): Task {
  return {
    id: `repair-${index}`,
    title: `Repair ${target}`,
    description: `Repair verification failure at ${target}`,
    kind: 'REPAIR',
    role: 'REPAIR',
    dependsOn: [],
    target,
    requiresConfirmation: false,
    timeoutMs: config.defaultTaskTimeoutMs,
    maxRetries: config.defaultMaxRetries,
  };
}

/** Empty merge outcome placeholder. */
function emptyMergeOutcome(): MergeOutcome {
  return {
    files: new Map(),
    conflicts: [],
    filesMerged: 0,
    deduped: 0,
    artifactCount: 0,
    taskIds: [],
  };
}

/** Failed verification summary placeholder. */
function failedVerificationSummary(): VerificationSummary {
  return {
    ok: false,
    targets: [],
    failedTargetId: 'build',
    durationMs: 0,
    attempts: 0,
    cancelled: false,
  };
}

/** Summarize review comments from the conversation. */
function summarizeReviews(conversation: Conversation): ReviewSummary {
  const comments = conversation.byType('REVIEW_COMMENT');
  const paths = new Set<string>();
  let blocking = 0;
  for (const message of comments) {
    const path = message.payload.path as string;
    if (typeof path === 'string') paths.add(path);
    if (message.payload.blocking === true) blocking += 1;
  }
  return {
    comments: comments.length,
    paths: [...paths].sort(),
    blocking,
  };
}

// Re-exported for convenience (typed re-export of ExecutorVerifier use).
export type { ExecutorVerifier, Verifier } from './execution/verification.js';
export type { AgentRole } from './types.js';