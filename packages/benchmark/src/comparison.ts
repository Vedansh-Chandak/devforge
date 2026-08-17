/**
 * @devforge/benchmark — Comparison between runs (DF-024).
 *
 * Deterministic, task-level comparison of two benchmark runs. Task ids order
 * the comparison; every delta is a pure function of the two inputs.
 */
import type {
  BenchmarkResult,
  RunComparison,
  TaskDelta,
  TaskResult,
} from "./types.js";
import { computeMetrics, type BenchmarkMetrics } from "./metrics.js";

/** Deterministic float rounding to avoid binary-representation drift. */
function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Relative delta, null-preserving. */
function relativeDelta(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return round(b - a);
}

/** Compare one task across two runs; stable and deterministic. */
export function compareTask(
  before: TaskResult | undefined,
  after: TaskResult | undefined,
): TaskDelta | null {
  if (before === undefined || after === undefined) return null;
  const beforePassed = before.status === "passed";
  const afterPassed = after.status === "passed";
  const improved =
    (!beforePassed && afterPassed) ||
    (beforePassed && afterPassed && after.score > before.score) ||
    (!beforePassed && !afterPassed && after.score > before.score);
  const regressed =
    (beforePassed && !afterPassed) ||
    (beforePassed && afterPassed && before.score > after.score) ||
    (!beforePassed && !afterPassed && before.score > after.score);
  return {
    taskId: before.taskId,
    beforeStatus: before.status,
    afterStatus: after.status,
    beforeScore: before.score,
    afterScore: after.score,
    scoreDelta: improved || regressed ? round(after.score - before.score) : 0,
    ...(improved || regressed
      ? { latencyDeltaMs: after.durationMs - before.durationMs }
      : { latencyDeltaMs: 0 }),
    ...(improved || regressed
      ? { attemptsDelta: after.attempts - before.attempts }
      : { attemptsDelta: 0 }),
    ...(improved || regressed
      ? { repairDelta: after.repairAttempts - before.repairAttempts }
      : { repairDelta: 0 }),
  };
}

function isImproved(delta: TaskDelta): boolean {
  const beforePassed = delta.beforeStatus === "passed";
  const afterPassed = delta.afterStatus === "passed";
  if (!beforePassed && afterPassed) return true;
  if (beforePassed && afterPassed) return delta.scoreDelta > 0;
  if (!beforePassed && !afterPassed) return delta.scoreDelta > 0;
  return false;
}

function isRegressed(delta: TaskDelta): boolean {
  const beforePassed = delta.beforeStatus === "passed";
  const afterPassed = delta.afterStatus === "passed";
  if (beforePassed && !afterPassed) return true;
  if (beforePassed && afterPassed) return delta.scoreDelta < 0;
  if (!beforePassed && !afterPassed) return delta.scoreDelta < 0;
  return false;
}

/** Compare two complete runs deterministically. */
export function compareRuns(a: BenchmarkResult, b: BenchmarkResult): RunComparison {
  const byId = new Map<string, TaskResult>();
  for (const task of b.tasks) byId.set(task.taskId, task);
  const taskIds = Array.from(
    new Set([...a.tasks, ...b.tasks].map((task) => task.taskId)),
  ).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

  const deltas: TaskDelta[] = [];
  const across = new Map<string, TaskResult>();
  for (const task of a.tasks) across.set(task.taskId, task);
  for (const taskId of taskIds) {
    const before = across.get(taskId);
    const after = byId.get(taskId);
    const delta = compareTask(before, after);
    if (delta !== null) deltas.push(delta);
  }

  let improved = 0;
  let regressed = 0;
  let unchanged = 0;
  for (const delta of deltas) {
    if (isImproved(delta)) improved += 1;
    else if (isRegressed(delta)) regressed += 1;
    else unchanged += 1;
  }

  const metricsA = computeMetrics(a.tasks);
  const metricsB = computeMetrics(b.tasks);
  const successRateDelta = relativeDelta(metricsA.taskSuccessRate, metricsB.taskSuccessRate);
  const verificationDelta = relativeDelta(metricsA.verificationSuccessRate, metricsB.verificationSuccessRate);
  const latencyDeltaMs = relativeDelta(metricsA.averageExecutionTimeMs, metricsB.averageExecutionTimeMs);
  const attemptDelta = relativeDelta(metricsA.averageAttempts, metricsB.averageAttempts);
  const repairDelta = relativeDelta(metricsA.averageRepairAttempts, metricsB.averageRepairAttempts);

  const retrievalDelta = relativeDelta(
    metricsA.memoryRetrievalCount,
    metricsB.memoryRetrievalCount,
  );
  const hitRateDelta = relativeDelta(
    metricsA.memoryHitRate,
    metricsB.memoryHitRate,
  );

  return {
    runAId: a.resultId,
    runBId: b.resultId,
    tasks: deltas,
    improved,
    regressed,
    unchanged,
    successRateDelta: successRateDelta ?? 0,
    verificationDelta: verificationDelta ?? 0,
    latencyDeltaMs: latencyDeltaMs ?? 0,
    attemptDelta: attemptDelta ?? 0,
    repairDelta: repairDelta ?? 0,
    memoryImpact: {
      retrievalDelta: retrievalDelta,
      hitRateDelta: hitRateDelta,
    },
  };
}

export type { BenchmarkMetrics };