/**
 * @devforge/memory — Task history (DF-023).
 *
 * Records an execution task with its outcome, affected files, tests, failures,
 * and successful repairs — enough structured detail for future retrieval
 * without storing full transcripts.
 */
import {
  buildMemoryRecord,
  TypedRepositoryMemory,
  type MemoryContext,
  type RecordBuildOptions,
} from "./record-builder.js";
import type { TypePatch } from "./type-common.js";
import { InvalidRecordError } from "./errors.js";
import type { MemoryRecord, MemoryRecordOf } from "./types.js";
import { TASK_OUTCOMES, type TaskOutcome } from "./types.js";
import { MemoryStore } from "./memory-store.js";

export interface TaskInput {
  readonly title: string;
  /** Concise statement of the task attempted. */
  readonly task: string;
  readonly outcome: TaskOutcome;
  readonly affectedFiles?: readonly string[];
  readonly tests?: readonly string[];
  readonly failures?: readonly string[];
  readonly repairs?: readonly string[];
  readonly confidence?: number;
  readonly importance?: number;
  readonly tags?: readonly string[];
  readonly source?: string;
  readonly id?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

export type TaskPatch = TypePatch<
  TaskInput,
  "title" | "task" | "outcome" | "affectedFiles" | "tests" | "failures" | "repairs"
>;

/** Pure deterministic builder for a task record. */
export function buildTaskRecord(
  ctx: MemoryContext,
  input: TaskInput,
): MemoryRecordOf<"task"> {
  if (!input.title || input.title.trim().length === 0) {
    throw new InvalidRecordError("Task memory requires a title.");
  }
  if (!input.task || input.task.trim().length === 0) {
    throw new InvalidRecordError("Task memory requires a task description.");
  }
  if (!(TASK_OUTCOMES as readonly string[]).includes(input.outcome)) {
    throw new InvalidRecordError(`Unknown task outcome: ${String(input.outcome)}`);
  }
  return buildMemoryRecord(
    ctx,
    "task",
    input.title,
    {
      task: input.task,
      outcome: input.outcome,
      affectedFiles: [...(input.affectedFiles ?? [])],
      tests: [...(input.tests ?? [])],
      failures: [...(input.failures ?? [])],
      repairs: [...(input.repairs ?? [])],
    },
    toBuildOptions(input),
  );
}

/** Repository-scoped facade for task memories. */
export class TaskMemory extends TypedRepositoryMemory<"task"> {
  constructor(
    repositoryId: string,
    store: MemoryStore<MemoryRecord>,
    ctx: MemoryContext,
  ) {
    super(repositoryId, store, ctx);
  }

  protected type(): "task" {
    return "task";
  }

  async add(input: TaskInput): Promise<MemoryRecordOf<"task">> {
    return this.put(buildTaskRecord(this.ctx, input));
  }

  /** Latest task reaching the given outcome, or null. */
  async latest(outcome: TaskOutcome): Promise<MemoryRecordOf<"task"> | null> {
    const all = await this.list();
    const matches = all.filter((record) => record.data.outcome === outcome);
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.updatedAt - a.updatedAt);
    return matches[0] ?? null;
  }
}

function toBuildOptions(input: TaskInput): RecordBuildOptions {
  return {
    id: input.id,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    confidence: input.confidence,
    importance: input.importance,
    tags: input.tags,
    source: input.source,
  };
}