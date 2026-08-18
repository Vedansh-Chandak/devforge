/**
 * @devforge/memory — Execution history (DF-023).
 *
 * A thin recorder that maps common execution events (successful repairs, failed
 * repairs, test/build failures, successful implementations, repository
 * discoveries) onto typed TaskMemory and FailureMemory records. Enough
 * structured detail is captured for future retrieval without storing full
 * transcripts. The recorder never executes anything itself.
 */
import {
  buildFailureRecord,
  type FailureInput,
} from "./failure.js";
import { buildTaskRecord, type TaskInput } from "./task.js";
import type { MemoryRecord } from "./types.js";
import type { MemoryContext } from "./record-builder.js";
import { MemoryStore } from "./memory-store.js";
import { InvalidRecordError } from "./errors.js";

/** Common fields shared by every history event. */
export interface HistoryBase {
  readonly title: string;
  readonly task: string;
  readonly affectedFiles?: readonly string[];
  readonly tests?: readonly string[];
  readonly confidence?: number;
  readonly importance?: number;
}

/** Event for a repair that succeeded. */
export interface SuccessfulRepairEvent extends HistoryBase {
  readonly repairs?: readonly string[];
}

/** Event for a repair attempt that failed. */
export interface FailedRepairEvent extends SuccessfulRepairEvent {
  readonly fingerprint: string;
  readonly errorCategory: string;
  readonly affectedSubsystem: string;
  readonly attemptedSolution: string;
  readonly failures?: readonly string[];
}

/** Event for a failing test or build. */
export interface BuildOrTestFailureEvent extends HistoryBase {
  readonly fingerprint: string;
  readonly affectedSubsystem: string;
  readonly attemptedSolution: string;
  readonly failures?: readonly string[];
}

export interface HistoryRecorderConfig {
  readonly repositoryId: string;
  readonly store: MemoryStore<MemoryRecord>;
  readonly ctx: MemoryContext;
}

export interface HistoryRecordResult {
  readonly tasks: readonly MemoryRecord[];
  readonly failures: readonly MemoryRecord[];
}

/**
 * Records execution history as typed memories. Deterministic: identical events
 * collapse to identical records (same content-derived IDs).
 */
export class HistoryRecorder {
  private readonly repositoryId: string;
  private readonly store: MemoryStore<MemoryRecord>;
  private readonly ctx: MemoryContext;

  constructor(config: HistoryRecorderConfig) {
    this.repositoryId = config.repositoryId;
    this.store = config.store;
    this.ctx = config.ctx;
  }

  private taskInput(event: HistoryBase, outcome: TaskInput["outcome"]): TaskInput {
    return {
      title: event.title,
      task: event.task,
      outcome,
      affectedFiles: event.affectedFiles,
      tests: event.tests,
      failures: [],
      repairs: [],
      confidence: event.confidence,
      importance: event.importance,
    };
  }

  async recordSuccessfulRepair(
    event: SuccessfulRepairEvent,
  ): Promise<HistoryRecordResult> {
    const task = buildTaskRecord(this.ctx, {
      ...this.taskInput(event, "success"),
      repairs: event.repairs ?? [],
    });
    return { tasks: [await this.store.put(task)], failures: [] };
  }

  async recordFailedRepair(
    event: FailedRepairEvent,
  ): Promise<HistoryRecordResult> {
    const task = buildTaskRecord(
      this.ctx,
      {
        ...this.taskInput(event, "failure"),
        failures: event.failures ?? [],
        repairs: event.repairs ?? [],
      },
    );
    const failure = buildFailureRecord(
      this.ctx,
      failureFromEvent(event),
    );
    return {
      tasks: [await this.store.put(task)],
      failures: [await this.store.put(failure)],
    };
  }

  async recordTestFailure(
    event: BuildOrTestFailureEvent,
    errorCategory = "test",
  ): Promise<HistoryRecordResult> {
    const task = buildTaskRecord(
      this.ctx,
      {
        ...this.taskInput({ ...event, tests: event.tests ?? [] }, "failure"),
        failures: event.failures ?? [],
      },
    );
    const failure = buildFailureRecord(
      this.ctx,
      {
        ...failureFromEvent(event),
        errorCategory,
      },
    );
    return {
      tasks: [await this.store.put(task)],
      failures: [await this.store.put(failure)],
    };
  }

  recordBuildFailure(
    event: BuildOrTestFailureEvent,
  ): Promise<HistoryRecordResult> {
    return this.recordTestFailure(event, "build");
  }

  async recordSuccessfulImplementation(
    event: HistoryBase,
  ): Promise<HistoryRecordResult> {
    const task = buildTaskRecord(this.ctx, {
      ...this.taskInput(event, "success"),
      tags: ["implementation"],
    });
    return { tasks: [await this.store.put(task)], failures: [] };
  }

  async recordRepositoryDiscovery(
    event: HistoryBase & { readonly discovery: string },
  ): Promise<HistoryRecordResult> {
    if (!event.discovery || event.discovery.trim().length === 0) {
      throw new InvalidRecordError("Repository discovery requires content.");
    }
    const task = buildTaskRecord(this.ctx, {
      ...this.taskInput(event, "success"),
      tags: ["repository-discovery", "discovery"],
      repairs: [event.discovery],
    });
    return { tasks: [await this.store.put(task)], failures: [] };
  }
}

function failureFromEvent(
  event: FailedRepairEvent | BuildOrTestFailureEvent,
): FailureInput {
  const fingerprint =
    "fingerprint" in event
      ? event.fingerprint
      : requireFingerprint(event);
  return {
    title: `Failure: ${event.title}`,
    fingerprint,
    errorCategory: "unknown",
    affectedSubsystem: event.affectedSubsystem ?? "*",
    attemptedSolution: event.attemptedSolution ?? "",
    result: "unresolved",
    confidence: event.confidence,
    importance: event.importance,
  };
}

function requireFingerprint(event: BuildOrTestFailureEvent): string {
  if (!event.fingerprint || event.fingerprint.length === 0) {
    throw new InvalidRecordError(
      "A fingerprint is required to record a failure.",
    );
  }
  return event.fingerprint;
}