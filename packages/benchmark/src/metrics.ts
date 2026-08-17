/**
 * @devforge/benchmark — Metrics (DF-024).
 *
 * Deterministic summarization of a benchmark run into rates, averages, and
 * medians. Metrics the adapter cannot measure are `null` — the framework
 * never guesses or fabricates token, latency, memory, or model statistics.
 */
import type { TaskResult } from "./types.js";

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface StatsValue {
  readonly count: number;
  readonly mean: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
}

export function stats(values: readonly number[]): StatsValue | null {
  if (values.length === 0) return null;
  const average = mean(values)!;
  const med = median(values)!;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { count: values.length, mean: average, median: med, min, max };
}

/** Deterministic rounding of rates to a fixed precision. */
export function roundTo(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface BenchmarkMetrics {
  readonly total: number;
  readonly taskSuccessRate: number | null;
  readonly testPassRate: number | null;
  readonly buildSuccessRate: number | null;
  readonly verificationSuccessRate: number | null;
  readonly repairSuccessRate: number | null;
  readonly regressionRate: number | null;
  readonly timeoutRate: number | null;
  readonly cancellationRate: number | null;
  readonly averageAttempts: number | null;
  readonly averageRepairAttempts: number | null;
  readonly averageExecutionTimeMs: number | null;
  readonly medianExecutionTimeMs: number | null;
  readonly averagePatchSize: number | null;
  readonly averageFilesChanged: number | null;
  readonly tokenUsage: number | null;
  readonly modelCalls: number | null;
  readonly toolCalls: number | null;
  readonly memoryRetrievalCount: number | null;
  readonly memoryHitRate: number | null;
  readonly multiAgentTaskSuccessRate: number | null;
  readonly perCategory: Readonly<Record<string, { total: number; passed: number }>>;
}

function rate(part: number, whole: number): number | null {
  return whole > 0 ? roundTo(part / whole) : null;
}

/** Sum across tasks only when every task reported the value. */
function sumIfAll(tasks: readonly TaskResult[], pick: (t: TaskResult) => number | undefined): number | null {
  if (tasks.length === 0) return null;
  let sum = 0;
  for (const task of tasks) {
    const value = pick(task);
    if (value === undefined || value < 0) return null;
    sum += value;
  }
  return sum;
}

/** Mean across tasks that reported the value; null when none did. */
function meanIfReported(tasks: readonly TaskResult[], pick: (t: TaskResult) => number | undefined): number | null {
  const values: number[] = [];
  for (const task of tasks) {
    const value = pick(task);
    if (value !== undefined && value >= 0) values.push(value);
  }
  const average = mean(values);
  return average === null ? null : roundTo(average);
}

/**
 * Compute every metric deterministically from task results.
 * `multiAgent` enables the multi-agent task success rate when the run
 * configuration reports a multi-agent adapter.
 */
export function computeMetrics(
  tasks: readonly TaskResult[],
  options: { multiAgent?: boolean } = {},
): BenchmarkMetrics {
  const total = tasks.length;
  const passed = tasks.filter((task) => task.status === "passed").length;
  const timeout = tasks.filter((task) => task.status === "timeout").length;
  const cancelled = tasks.filter((task) => task.status === "cancelled").length;
  const withRepairs = tasks.filter((task) => task.repairAttempts > 0);
  const repairedSuccess = withRepairs.filter((task) => task.status === "passed").length;
  const regressionTasks = tasks.filter(
    (task) => task.signals.regressionDetected === true,
  );
  const regressionMeasured = tasks.filter(
    (task) => task.signals.regressionDetected !== null,
  );

  const testRecorded = tasks.filter((task) => task.signals.testsPass !== null);
  const testPassed = testRecorded.filter((task) => task.signals.testsPass === true);
  const buildRecorded = tasks.filter((task) => task.signals.buildPasses !== null);
  const buildPassed = buildRecorded.filter((task) => task.signals.buildPasses === true);

  const withPatch = tasks.filter((task) => task.patchStats !== null);
  const patchSizes = withPatch.map(
    (task) => task.patchStats!.additions + task.patchStats!.deletions,
  );
  const filesChanged = withPatch.map((task) => task.patchStats!.filesChanged);

  const durations = tasks.map((task) => task.durationMs);

  const perCategory: Record<string, { total: number; passed: number }> = {};
  for (const task of tasks) {
    const current = perCategory[task.category] ?? { total: 0, passed: 0 };
    current.total += 1;
    if (task.status === "passed") current.passed += 1;
    perCategory[task.category] = current;
  }
  const sortedCategory: Record<string, { total: number; passed: number }> = {};
  for (const category of Object.keys(perCategory).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    sortedCategory[category] = perCategory[category]!;
  }

  const durationStats = stats(durations);
  const averagePatchSize = withPatch.length === 0 ? null : roundTo(mean(patchSizes) ?? 0);
  const averageFilesChanged = withPatch.length === 0 ? null : roundTo(mean(filesChanged) ?? 0);

  return {
    total,
    taskSuccessRate: rate(passed, total),
    testPassRate: rate(testPassed.length, testRecorded.length),
    buildSuccessRate: rate(buildPassed.length, buildRecorded.length),
    verificationSuccessRate: rate(passed, total),
    repairSuccessRate: rate(repairedSuccess, withRepairs.length),
    regressionRate: rate(regressionTasks.length, regressionMeasured.length),
    timeoutRate: rate(timeout, total),
    cancellationRate: rate(cancelled, total),
    averageAttempts: roundTo(mean(tasks.map((task) => task.attempts)) ?? 0),
    averageRepairAttempts: roundTo(mean(tasks.map((task) => task.repairAttempts)) ?? 0),
    averageExecutionTimeMs: durationStats?.mean ?? null,
    medianExecutionTimeMs: durationStats?.median ?? null,
    averagePatchSize,
    averageFilesChanged,
    tokenUsage: sumIfAll(tasks, (task) => task.telemetry.tokenUsage),
    modelCalls: sumIfAll(tasks, (task) => task.telemetry.modelCalls),
    toolCalls: sumIfAll(tasks, (task) => task.telemetry.toolCalls),
    memoryRetrievalCount: sumIfAll(tasks, (task) => task.telemetry.memoryRetrievalCount),
    memoryHitRate: meanIfReported(tasks, (task) => task.telemetry.memoryHitRate),
    multiAgentTaskSuccessRate:
      options.multiAgent === true ? rate(passed, total) : null,
    perCategory: sortedCategory,
  };
}