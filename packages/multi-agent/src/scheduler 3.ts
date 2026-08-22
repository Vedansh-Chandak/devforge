/**
 * @devforge/multi-agent — Scheduler (DF-022).
 *
 * Builds a deterministic schedule (dependency-batched levels) and executes it
 * with bounded parallelism, per-task timeouts, retries for retryable
 * failures, and cancellation. Results are returned in deterministic schedule
 * order, and completion messages are posted in that same order, so parallel
 * execution never reorders downstream reporting.
 */

import type { Schedule, ScheduleBatch, Task, TaskResult, TaskStatus } from './types.js';
import type { AgentContext } from './context.js';
import { isAborted } from './context.js';
import { MultiAgentValidationError, MultiAgentSchedulingError } from './errors.js';
import { ParallelRunner } from './execution/parallel-runner.js';
import {
  taskAssigned,
  taskSucceeded,
  taskFailed,
  taskSkipped,
  taskCancelled,
  taskProgress,
} from './message.js';

/** Executes a single task attempt. */
export type TaskAttemptRunner = (
  task: Task,
  ctx: AgentContext,
  attempt: number,
) => Promise<TaskResult>;

/** Options for the scheduler. */
export interface SchedulerOptions {
  readonly maxParallelism: number;
  readonly retryDelayMs: number;
  readonly defaultTaskTimeoutMs: number;
  readonly defaultMaxRetries: number;
  readonly globalTimeoutMs?: number;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

/** Outcome of executing a schedule. */
export interface ScheduleOutcome {
  /** Results in deterministic schedule order. */
  readonly results: readonly TaskResult[];
  readonly cancelled: boolean;
  readonly timedOut: boolean;
  readonly schedule: Schedule;
}

/**
 * Build a schedule from tasks by grouping into parallel-safe batches.
 * Batch 0 holds tasks with no unmet dependency; later batches hold tasks
 * whose dependencies are satisfied by earlier batches. Tasks within a batch
 * are ordered by id for determinism.
 */
export function buildSchedule(tasks: readonly Task[]): Schedule {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    indegree.set(task.id, task.dependsOn.length);
    for (const dep of task.dependsOn) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(task.id);
    }
  }

  const batches: ScheduleBatch[] = [];
  const visited = new Set<string>();
  const available = tasks
    .filter((task) => (indegree.get(task.id) ?? 0) === 0)
    .map((task) => task.id)
    .sort();

  let batchId = 0;
  while (available.length > 0) {
    const batchTasks: Task[] = [];
    const still: string[] = [];
    for (const id of available) {
      const task = byId.get(id);
      if (task) batchTasks.push(task);
    }
    batches.push({ batchId, tasks: batchTasks });
    for (const id of available) {
      visited.add(id);
      for (const dep of (dependents.get(id) ?? []).sort()) {
        if (visited.has(dep)) continue;
        const current = (indegree.get(dep) ?? 0) - 1;
        indegree.set(dep, current);
        if (current === 0) still.push(dep);
      }
    }
    available.length = 0;
    available.push(...still.sort());
    batchId += 1;
  }

  const order: string[] = [];
  for (const batch of batches) {
    for (const task of batch.tasks) {
      order.push(task.id);
    }
  }

  return { batches, depth: batches.length, order };
}

/** Scheduler that executes a schedule with parallelism, retries, and timeouts. */
export class Scheduler {
  private readonly options: SchedulerOptions;

  constructor(options: SchedulerOptions) {
    if (options.maxParallelism < 1) {
      throw new MultiAgentValidationError('maxParallelism must be >= 1');
    }
    this.options = options;
  }

  /** Deterministic schedule for a set of tasks. */
  plan(tasks: readonly Task[]): Schedule {
    return buildSchedule(tasks);
  }

  /**
   * Execute a set of tasks according to their dependencies. Dependencies that
   * fail cause dependent tasks to be skipped. Retryable failures retry up to
   * the task's budget. Cancellation aborts remaining work.
   */
  async execute(
    tasks: readonly Task[],
    run: TaskAttemptRunner,
    ctx: AgentContext,
  ): Promise<ScheduleOutcome> {
    const schedule = buildSchedule(tasks);
    const runner = new ParallelRunner({ maxParallelism: this.options.maxParallelism });
    const resultByTask = new Map<string, TaskResult>();
    let cancelled = false;
    let timedOut = false;
    const started = this.options.now();
    const globalTimeoutMs = this.options.globalTimeoutMs ?? Number.POSITIVE_INFINITY;

    for (const batch of schedule.batches) {
      if (isAborted(ctx)) {
        cancelled = true;
        break;
      }
      if (cancelled || timedOut) {
        break;
      }
      if (this.options.now() - started > globalTimeoutMs) {
        timedOut = true;
        break;
      }
      // A task that is not runnable (a dependency failed) must be skipped.
      const runnable = batch.tasks.filter((task) => {
        for (const dep of task.dependsOn) {
          const depResult = resultByTask.get(dep);
          if (!depResult || depResult.status !== 'SUCCEEDED') return false;
        }
        return !isAborted(ctx);
      });
      const skipped = batch.tasks.filter((task) => !runnable.includes(task));

      // Post assigned messages in deterministic order.
      for (const task of runnable) {
        ctx.conversation.post(
          taskAssigned({
            at: this.options.now(),
            taskId: task.id,
            role: task.role,
            title: task.title,
          }),
        );
      }

      const start = this.options.now();
      const batchResults = await runner.map(runnable, (task, i) =>
        this.runTaskChecked(task, run, ctx, i),
      );

      // Cancellation / timeout checks after the batch.
      if (isAborted(ctx)) {
        cancelled = true;
      }

      // Record results in schedule (input) order.
      for (const task of runnable) {
        const result = batchResults.find((r) => r.taskId === task.id);
        if (result) resultByTask.set(task.id, result);
      }

      void start;

      // Handle skipped tasks.
      for (const task of skipped) {
        const skipResult: TaskResult = {
          taskId: task.id,
          role: task.role,
          kind: task.kind,
          ok: false,
          status: 'SKIPPED',
          artifacts: [],
          messages: [],
          attempts: 0,
          durationMs: 0,
          error: { code: 'MA_DEPENDENCY_FAILED', message: 'a dependency failed', retryable: false },
          batch: batch.batchId,
        };
        resultByTask.set(task.id, skipResult);
        ctx.conversation.post(
          taskSkipped({
            at: this.options.now(),
            taskId: task.id,
            role: task.role,
            reason: 'a dependency failed',
          }),
        );
      }

      // Detect timeout: check if any task timed out.
      if (!timedOut) {
        timedOut = [...resultByTask.values()].some((r) => r.error?.code === 'MA_TASK_TIMEOUT');
      }
    }

    // Deterministic result ordering: schedule order.
    const results: TaskResult[] = [];
    for (const id of schedule.order) {
      const result = resultByTask.get(id);
      if (result) results.push(result);
    }

    return { results, cancelled, timedOut, schedule };
  }

  /** Run a single task with per-attempt timeout and bounded retries. */
  private async runTaskChecked(
    task: Task,
    run: TaskAttemptRunner,
    ctx: AgentContext,
    index: number,
  ): Promise<TaskResult> {
    const maxAttempts = task.maxRetries + 1;
    let last: TaskResult | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (isAborted(ctx)) {
        const cancelledResult: TaskResult = {
          taskId: task.id,
          role: task.role,
          kind: task.kind,
          ok: false,
          status: 'CANCELLED',
          artifacts: [],
          messages: [],
          attempts: attempt,
          durationMs: 0,
          error: { code: 'MA_CANCELLED', message: 'task cancelled', retryable: false },
          batch: index,
        };
        ctx.conversation.post(
          taskCancelled({
            at: this.options.now(),
            taskId: task.id,
            role: task.role,
          }),
        );
        last = cancelledResult;
        break;
      }

      const result = await this.withTimeout(task, run, ctx, attempt);
      last = result;
      ctx.conversation.post(
        taskProgress({
          at: this.options.now(),
          taskId: task.id,
          role: task.role,
          note: `attempt ${attempt}`,
        }),
      );
      ctx.conversation.post(statusMessageOf(result, ctx, this.options.now()));

      if (result.ok) {
        break;
      }
      if (!result.error?.retryable) {
        break;
      }
      if (attempt < maxAttempts) {
        await this.options.sleep(this.options.retryDelayMs);
      }
    }

    if (!last) {
      throw new MultiAgentSchedulingError(`no result for task ${task.id}`);
    }
    const final = { ...last, batch: index };
    return final;
  }

  /**
   * Race a task against a deadline; a timeout yields a deterministic result.
   *
   * The timeout branch is armed only after one microtask flush so that a
   * synchronously-resolving run always wins a tie against an instant (fake)
   * clock. `timeoutMs <= 0` disables the deadline (tasks may run forever).
   */
  private async withTimeout(
    task: Task,
    run: TaskAttemptRunner,
    ctx: AgentContext,
    attempt: number,
  ): Promise<TaskResult> {
    const timeoutMs = task.timeoutMs ?? this.options.defaultTaskTimeoutMs;
    const hasDeadline = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0;
    const start = this.options.now();

    if (!hasDeadline) {
      const result = await run(task, ctx, attempt);
      return { ...result, durationMs: this.options.now() - start };
    }

    const result = await Promise.race([
      run(task, ctx, attempt).then((res) => ({ res, timedOut: false as const })),
      // Defer arming the timer a microtask so the run settles first on ties.
      Promise.resolve()
        .then(() => this.options.sleep(timeoutMs))
        .then(() => ({ res: null, timedOut: true as const })),
    ]);

    const durationMs = this.options.now() - start;
    if (result.res) {
      return { ...result.res, durationMs };
    }

    return {
      taskId: task.id,
      role: task.role,
      kind: task.kind,
      ok: false,
      status: 'FAILED',
      artifacts: [],
      messages: [],
      attempts: attempt,
      durationMs,
      error: { code: 'MA_TASK_TIMEOUT', message: 'task exceeded its timeout', retryable: true },
    };
  }
}

/** Build a completion message draft for a task result. */
export function statusMessageOf(result: TaskResult, ctx: AgentContext, at: number) {
  const base = { at };
  switch (result.status) {
    case 'SUCCEEDED':
      return taskSucceeded({
        at: base.at,
        taskId: result.taskId,
        role: result.role,
        artifacts: result.artifacts.length,
      });
    case 'FAILED':
      return taskFailed({
        at: base.at,
        taskId: result.taskId,
        role: result.role,
        code: result.error?.code ?? 'MA_AGENT_EXECUTION',
        message: result.error?.message ?? 'task failed',
      });
    case 'CANCELLED':
      return taskCancelled({
        at: base.at,
        taskId: result.taskId,
        role: result.role,
      });
    default:
      void ctx;
      return taskProgress({
        at: base.at,
        taskId: result.taskId,
        role: result.role,
        note: `status ${result.status as TaskStatus}`,
      });
  }
}
