/**
 * @devforge/autonomous — Task manager (DF-019).
 *
 * Queues and runs a batch of agent tasks sequentially in deterministic
 * insertion order. A single cancellation aborts the whole pipeline; a task
 * failure does not abort the remaining tasks.
 */

import type { AgentResult } from './types.js';

/** A queued task for the agent. */
export interface TaskSpec {
  readonly id: string;
  readonly goal: string;
  readonly context?: readonly string[];
}

/** Executes a single task (typically by spawning a fresh agent). */
export type TaskRunner = (
  task: TaskSpec,
  signal?: AbortSignal,
) => Promise<AgentResult>;

/** Per-task outcome as recorded by the manager. */
export interface TaskOutcome {
  readonly task: TaskSpec;
  readonly status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly result: AgentResult | null;
  readonly error: Error | null;
}

/** Options for the task manager. */
export interface TaskManagerOptions {
  readonly queueLimit?: number;
  /** Mark run as complete when this many tasks have finished. */
  readonly stopAfter?: number;
}

/** Sequential, cancellation-aware task queue. */
export class TaskManager {
  private readonly runTask: TaskRunner;
  private readonly queue: TaskSpec[] = [];
  private readonly options: Required<Pick<TaskManagerOptions, 'queueLimit'>> &
    Pick<TaskManagerOptions, 'stopAfter'>;
  private readonly outcomes: TaskOutcome[] = [];
  private controller = new AbortController();
  private started = false;
  private cancelled = false;
  private finished = false;
  private completedCount = 0;

  constructor(runTask: TaskRunner, options: TaskManagerOptions = {}) {
    this.runTask = runTask;
    this.options = {
      queueLimit: options.queueLimit ?? 100,
      stopAfter: options.stopAfter,
    };
  }

  /** Number of tasks waiting to run. */
  get pending(): number {
    return this.queue.length;
  }

  /** Number of finished tasks. */
  get completed(): number {
    return this.outcomes.length;
  }

  /** Number of tasks that finished successfully. */
  get succeeded(): number {
    return this.outcomes.filter((outcome) => outcome.status === 'COMPLETED').length;
  }

  get cancelledFlag(): boolean {
    return this.cancelled;
  }

  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  get isRunning(): boolean {
    return this.started && !this.cancelled && !this.finished;
  }

  /** Results so far, in completion order. */
  get report(): readonly TaskOutcome[] {
    return [...this.outcomes];
  }

  /** Append a task. Returns the new queue length. */
  enqueue(task: TaskSpec): number {
    if (task.id.length === 0) throw new Error('Task id must not be empty');
    if (this.queue.length >= this.options.queueLimit) {
      throw new Error(`task queue full (limit ${this.options.queueLimit})`);
    }
    this.queue.push(task);
    return this.queue.length;
  }

  /** Can a task be cancelled while the queue is running. */
  cancel(reason = 'cancelled by caller'): void {
    if (this.controller.signal.aborted) return;
    this.cancelled = true;
    this.controller.abort(reason);
  }

  /** Reset the manager for another batch. */
  reset(): void {
    this.queue.length = 0;
    this.outcomes.length = 0;
    this.completedCount = 0;
    this.cancelled = false;
    this.started = false;
    this.finished = false;
    if (this.controller.signal.aborted) this.controller = new AbortController();
  }

  /** Run all queued tasks sequentially. Resolves with the outcome report. */
  async drain(): Promise<readonly TaskOutcome[]> {
    if (this.started) throw new Error('task manager already drained');
    this.started = true;
    const batch = this.queue.splice(0, this.queue.length);
    for (const task of batch) {
      if (this.controller.signal.aborted) {
        this.outcomes.push({
          task,
          status: 'CANCELLED',
          result: null,
          error: new Error(String(this.controller.signal.reason ?? 'cancelled')),
        });
        continue;
      }
      try {
        const result = await this.runTask(task, this.controller.signal);
        this.outcomes.push({ task, status: 'COMPLETED', result, error: null });
      } catch (error) {
        if (this.controller.signal.aborted) {
          this.outcomes.push({
            task,
            status: 'CANCELLED',
            result: null,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        } else {
          this.outcomes.push({
            task,
            status: 'FAILED',
            result: null,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
      this.completedCount += 1;
      if (this.options.stopAfter !== undefined && this.completedCount >= this.options.stopAfter) {
        break;
      }
    }
    this.finished = true;
    return this.report;
  }
}