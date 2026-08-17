/**
 * @devforge/benchmark — Reports (DF-024).
 *
 * Deterministic text/JSON rendering of results, suite summaries, comparisons,
 * and failure reports. Identical inputs always yield byte-identical output.
 */
import { stableStringify } from "@devforge/memory";
import type { BenchmarkResult, RunComparison, SuiteResult } from "./types.js";
import { computeMetrics, type BenchmarkMetrics } from "./metrics.js";
import { scoreBenchmark, type BenchmarkScore } from "./scoring.js";

export interface ReportSummary {
  readonly name: string;
  readonly datasetName: string;
  readonly datasetVersion: string;
  readonly benchmarkVersion: string;
  readonly devforgeVersion: string;
  readonly createdAtMs: number;
  readonly counts: BenchmarkResult["counts"];
  readonly successRate: number;
  readonly verificationRate: number;
}

export function summarizeResult(result: BenchmarkResult): ReportSummary {
  const metrics = computeMetrics(result.tasks);
  return {
    name: result.name,
    datasetName: result.datasetName,
    datasetVersion: result.datasetVersion,
    benchmarkVersion: result.benchmarkVersion,
    devforgeVersion: result.devforgeVersion,
    createdAtMs: result.createdAtMs,
    counts: result.counts,
    successRate: metrics.taskSuccessRate ?? 0,
    verificationRate: metrics.verificationSuccessRate ?? 0,
  };
}

export interface StructuredReport {
  readonly summary: ReportSummary;
  readonly metrics: BenchmarkMetrics;
  readonly score: BenchmarkScore;
  readonly tasks: readonly {
    readonly taskId: string;
    readonly status: string;
    readonly score: number;
    readonly attempts: number;
    readonly errors: readonly string[];
  }[];
}

export function structuredReport(result: BenchmarkResult): StructuredReport {
  const metrics = computeMetrics(result.tasks);
  const score = scoreBenchmark(metrics);
  return {
    summary: summarizeResult(result),
    metrics,
    score,
    tasks: result.tasks.map((task) => ({
      taskId: task.taskId,
      status: task.status,
      score: task.score,
      attempts: task.attempts,
      errors: task.errors.slice(0, 5),
    })),
  };
}

/** Canonical JSON report for a benchmark result. */
export function toJsonReport(result: BenchmarkResult): string {
  return `${stableStringify(structuredReport(result))}\n`;
}

/** Human-readable report (deterministic line ordering). */
export function toHumanReport(result: BenchmarkResult): string {
  const summary = summarizeResult(result);
  const metrics = computeMetrics(result.tasks);
  const lines: string[] = [];
  lines.push(`Benchmark: ${summary.name}`);
  lines.push(`Dataset: ${summary.datasetName} v${summary.datasetVersion}`);
  lines.push(
    `Versions: devforge ${summary.devforgeVersion} / benchmark ${summary.benchmarkVersion}`,
  );
  lines.push(`Adapter: ${result.configuration.adapterName} ${result.configuration.adapterVersion}`);
  lines.push(`Tasks: ${summary.counts.total}`);
  lines.push(`Success: ${summary.counts.passed}`);
  lines.push(`Failed: ${summary.counts.failed + summary.counts.verificationFailed}`);
  lines.push(`Timeout: ${summary.counts.timeout}`);
  lines.push(`Cancelled: ${summary.counts.cancelled}`);
  lines.push(`Success Rate: ${percent(summary.successRate)}`);
  lines.push(`Verification Rate: ${percent(summary.verificationRate)}`);
  lines.push(`Median Execution Time: ${formatMs(metrics.medianExecutionTimeMs)}`);
  lines.push(`Average Attempts: ${format(metrics.averageAttempts)}`);
  lines.push(`Average Repair Attempts: ${format(metrics.averageRepairAttempts)}`);
  if (metrics.tokenUsage !== null) lines.push(`Token Usage: ${metrics.tokenUsage}`);
  if (metrics.modelCalls !== null) lines.push(`Model Calls: ${metrics.modelCalls}`);
  if (metrics.toolCalls !== null) lines.push(`Tool Calls: ${metrics.toolCalls}`);
  if (metrics.memoryRetrievalCount !== null) {
    lines.push(`Memory Retrieval Count: ${metrics.memoryRetrievalCount}`);
  }
  if (metrics.memoryHitRate !== null) {
    lines.push(`Memory Hit Rate: ${percent(metrics.memoryHitRate)}`);
  }
  for (const task of result.tasks) {
    lines.push(
      `  [${task.status.toUpperCase()}] ${task.taskId} (${task.category}, score ${format(task.score)}, attempts ${task.attempts})`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export interface SuiteSummaryEntry {
  readonly suiteId: string;
  readonly name: string;
  readonly tasks: number;
  readonly passed: number;
  readonly successRate: number;
}

export function summarizeSuite(suite: SuiteResult): SuiteSummaryEntry {
  const summary = summarizeResult(suite.result);
  return {
    suiteId: suite.suiteId,
    name: suite.name,
    tasks: summary.counts.total,
    passed: summary.counts.passed,
    successRate: summary.successRate,
  };
}

/** Human-readable suite summary. */
export function toSuiteSummary(suite: SuiteResult): string {
  const entry = summarizeSuite(suite);
  const lines = [
    `Suite: ${entry.suiteId} (${entry.name})`,
    `Tasks: ${entry.tasks}`,
    `Passed: ${entry.passed}`,
    `Success Rate: ${percent(entry.successRate)}`,
    ...suite.taskIds.map((taskId) => `  - ${taskId}`),
  ];
  return `${lines.join("\n")}\n`;
}

function format(value: number | null): string {
  return value === null ? "unavailable" : `${value}`;
}

function formatMs(value: number | null): string {
  return value === null ? "unavailable" : `${value}ms`;
}

function percent(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${(safe * 100).toFixed(1)}%`;
}

/** Human-readable comparison report. */
export function toComparisonReport(
  comparison: RunComparison,
  aName: string,
  bName: string,
): string {
  const lines: string[] = [];
  lines.push(`Comparison: ${aName} vs ${bName}`);
  lines.push(`Tasks Improved: ${comparison.improved}`);
  lines.push(`Tasks Regressed: ${comparison.regressed}`);
  lines.push(`Tasks Unchanged: ${comparison.unchanged}`);
  lines.push(`Success Rate Delta: ${signed(comparison.successRateDelta)}`);
  lines.push(`Verification Delta: ${signed(comparison.verificationDelta)}`);
  lines.push(`Latency Delta: ${signed(comparison.latencyDeltaMs)}ms`);
  lines.push(`Attempt Delta: ${signed(comparison.attemptDelta)}`);
  lines.push(`Repair Delta: ${signed(comparison.repairDelta)}`);
  if (
    comparison.memoryImpact.retrievalDelta !== null ||
    comparison.memoryImpact.hitRateDelta !== null
  ) {
    lines.push(
      `Memory Impact: retrieval ${signed(
        comparison.memoryImpact.retrievalDelta ?? 0,
      )}, hit-rate ${signed(comparison.memoryImpact.hitRateDelta ?? 0)}`,
    );
  }
  for (const task of comparison.tasks) {
    lines.push(
      `  ${task.taskId}: ${task.beforeStatus} -> ${task.afterStatus} (score deltas ${signed(task.scoreDelta)})`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Human-readable failure report (only non-passed tasks). */
export function toFailureReport(result: BenchmarkResult): string {
  const failed = result.tasks.filter((task) => task.status !== "passed");
  const lines: string[] = [];
  lines.push(`Failure Report: ${result.name} (${failed.length} non-passed)`);
  for (const task of failed) {
    lines.push(
      `  [${task.status.toUpperCase()}] ${task.taskId}: ${task.taskTitle}`,
    );
    lines.push(`    reason: ${task.grader.reason}`);
    for (const evidence of task.grader.evidence.slice(0, 5)) {
      lines.push(`    - ${evidence}`);
    }
    for (const error of task.errors.slice(0, 5)) {
      lines.push(`    ! ${error}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}