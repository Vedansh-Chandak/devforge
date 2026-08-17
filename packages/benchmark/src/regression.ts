/**
 * @devforge/benchmark — Regression detection (DF-024).
 *
 * Compares a run against a baseline with configurable thresholds. Violations
 * are reported deterministically and the evaluation is a pure boolean.
 */
import type {
  BenchmarkResult,
  RegressionEvaluation,
  RegressionThresholds,
  RegressionViolation,
} from "./types.js";
import { compareRuns } from "./comparison.js";
import { computeMetrics } from "./metrics.js";

function violation(
  name: string,
  threshold: number,
  actual: number,
  message: string,
): RegressionViolation {
  return { name, threshold, actual, message };
}

/** Evaluate a current run against a baseline with the given thresholds. */
export function evaluateRegression(
  baseline: BenchmarkResult,
  current: BenchmarkResult,
  thresholds: RegressionThresholds,
): RegressionEvaluation {
  const violations: RegressionViolation[] = [];
  const metrics = computeMetrics(current.tasks);
  const comparison = compareRuns(baseline, current);

  if (thresholds.minSuccessRate !== undefined) {
    const actual = metrics.taskSuccessRate;
    if (actual !== null && actual < thresholds.minSuccessRate) {
      violations.push(
        violation(
          "minSuccessRate",
          thresholds.minSuccessRate,
          actual,
          `success rate ${actual} is below ${thresholds.minSuccessRate}`,
        ),
      );
    }
  }

  if (thresholds.minVerificationRate !== undefined) {
    const actual = metrics.verificationSuccessRate;
    if (actual !== null && actual < thresholds.minVerificationRate) {
      violations.push(
        violation(
          "minVerificationRate",
          thresholds.minVerificationRate,
          actual,
          `verification rate ${actual} is below ${thresholds.minVerificationRate}`,
        ),
      );
    }
  }

  if (thresholds.maxRegressionRate !== undefined) {
    const total = comparison.tasks.length;
    const actual = total === 0 ? 0 : comparison.regressed / total;
    if (actual > thresholds.maxRegressionRate) {
      violations.push(
        violation(
          "maxRegressionRate",
          thresholds.maxRegressionRate,
          actual,
          `regression rate ${actual} exceeds ${thresholds.maxRegressionRate}`,
        ),
      );
    }
  }

  if (thresholds.maxTimeoutRate !== undefined) {
    const actual = metrics.timeoutRate;
    if (actual !== null && actual > thresholds.maxTimeoutRate) {
      violations.push(
        violation(
          "maxTimeoutRate",
          thresholds.maxTimeoutRate,
          actual,
          `timeout rate ${actual} exceeds ${thresholds.maxTimeoutRate}`,
        ),
      );
    }
  }

  if (thresholds.maxLatencyIncreaseMs !== undefined) {
    const delta = comparison.latencyDeltaMs;
    if (delta > thresholds.maxLatencyIncreaseMs) {
      violations.push(
        violation(
          "maxLatencyIncreaseMs",
          thresholds.maxLatencyIncreaseMs,
          delta,
          `median latency increased by ${delta}ms (> ${thresholds.maxLatencyIncreaseMs}ms)`,
        ),
      );
    }
  }

  violations.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { passed: violations.length === 0, violations };
}