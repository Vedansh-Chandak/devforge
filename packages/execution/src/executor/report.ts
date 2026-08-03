/**
 * @devforge/execution — Execution report builder (DF-016A).
 *
 * Pure, deterministic construction of an {@link ExecutionReport} from the
 * executor's internal tracking state. Timestamps are formatted to ISO and
 * durations are computed from the injected clock so reports are reproducible.
 */

import type {
  ExecutionReport,
  ExecutionStatus,
  ReportError,
  RollbackCapable,
  RollbackRecord,
  StepExecutionRecord,
  DiagnosticsSummary,
  TransactionSummary,
} from './types.js';

/** Raw state captured by the executor and handed to the report builder. */
export interface ReportInput {
  readonly planId: string;
  readonly goal: string;
  readonly summary: string;
  readonly status: ExecutionStatus;
  /** Epoch ms at which the run started. */
  readonly startedAtMs: number;
  /** Epoch ms at which the run finished, or null while running. */
  readonly finishedAtMs: number | null;
  readonly steps: readonly StepExecutionRecord[];
  readonly rollback: readonly RollbackRecord[];
  readonly error?: ReportError;
  readonly eventCount: number;
  /** Time source used to resolve a still-running report. */
  readonly now: () => number;
  // DF-016B autonomous coding extensions (optional for backward compatibility)
  readonly patchesGenerated?: number;
  readonly repairAttempts?: number;
  readonly diagnostics?: readonly DiagnosticsSummary[];
  readonly transactions?: readonly TransactionSummary[];
  readonly modelCalls?: number;
  readonly verificationRuns?: number;
  readonly rollbackCount?: number;
}

/** Build an {@link ExecutionReport} from raw tracking state. */
export function buildExecutionReport(input: ReportInput): ExecutionReport {
  const finishedAtMs = input.finishedAtMs ?? input.now();
  return {
    planId: input.planId,
    goal: input.goal,
    summary: input.summary,
    status: input.status,
    startedAt: toIso(input.startedAtMs),
    finishedAt: input.finishedAtMs === null ? null : toIso(input.finishedAtMs),
    durationMs: Math.max(0, finishedAtMs - input.startedAtMs),
    steps: input.steps,
    rollback: input.rollback,
    error: input.error,
    eventCount: input.eventCount,
    // DF-016B extensions (included when present)
    patchesGenerated: input.patchesGenerated,
    repairAttempts: input.repairAttempts,
    diagnostics: input.diagnostics,
    transactions: input.transactions,
    modelCalls: input.modelCalls,
    verificationRuns: input.verificationRuns,
    rollbackCount: input.rollbackCount,
  };
}

function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * Produce a deterministic rollback token for a step, unique within a run.
 * `index` is the zero-based occurrence among the step's rollback operations.
 */
export function makeRollbackToken(stepId: string, index: number): string {
  return `rollback:${stepId}:${index}`;
}

/** Attach a deterministic token to each rollback-capable operation. */
export function tokenizeRollback(
  stepId: string,
  operations: readonly RollbackCapable[],
): readonly RollbackCapable[] {
  return operations.map((operation, index) => ({
    ...operation,
    token: makeRollbackToken(stepId, index),
  }));
}

/** Collate per-step rollback capabilities into a report-level record list. */
export function collateRollbackRecords(
  steps: readonly StepExecutionRecord[],
): readonly RollbackRecord[] {
  const records: RollbackRecord[] = [];
  for (const step of steps) {
    if (step.rollback && step.rollback.length > 0) {
      records.push({
        stepId: step.stepId,
        token: makeRollbackToken(step.stepId, 0),
        operations: step.rollback,
      });
    }
  }
  return records;
}

/** Create a structured step error for the report. */
export function toStepError(code: string, message: string): ReportError {
  return { code, message };
}
