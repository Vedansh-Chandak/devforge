/**
 * @devforge/benchmark — High-level orchestration (DF-024).
 *
 * A thin facade over the runner, reports, regression checks, and comparison so
 * callers (CLI, future CI) can run a benchmark, persist it, and compare sides
 * of an A/B experiment without wiring the pieces together.
 */
import type {
  BenchmarkResult,
  BenchmarkAgent,
  BenchmarkDataset,
  RegressionThresholds,
  RunComparison,
} from "./types.js";
import { evaluateRegression } from "./regression.js";
import { compareRuns } from "./comparison.js";
import { toComparisonReport, toHumanReport, toJsonReport } from "./reports.js";
import {
  BenchmarkRunner,
  type BenchmarkRunnerOptions,
} from "./benchmark-runner.js";
import type { ResultStore } from "./result-store.js";

export interface BenchmarkRunRequest {
  readonly dataset: BenchmarkDataset;
  readonly adapter: BenchmarkAgent;
  readonly runnerOptions?: Omit<BenchmarkRunnerOptions, "dataset" | "adapter">;
  /** Optional baseline run for automatic regression evaluation. */
  readonly baseline?: BenchmarkResult;
  readonly thresholds?: RegressionThresholds;
  readonly resultStore?: ResultStore;
}

export interface BenchmarkReport {
  readonly result: BenchmarkResult;
  readonly regression:
    | ReturnType<typeof evaluateRegression>
    | undefined;
  readonly humanText: string;
  readonly jsonText: string;
}

export class Benchmark {
  static buildRunner(request: BenchmarkRunRequest): BenchmarkRunner {
    return new BenchmarkRunner({
      dataset: request.dataset,
      adapter: request.adapter,
      ...request.runnerOptions,
    });
  }

  /** Run a full benchmark and return its report. */
  static async run(request: BenchmarkRunRequest): Promise<BenchmarkReport> {
    const runner = Benchmark.buildRunner(request);
    const result = await runner.runBenchmark();
    let regression: ReturnType<typeof evaluateRegression> | undefined;
    if (request.baseline !== undefined && request.thresholds !== undefined) {
      regression = evaluateRegression(
        request.baseline,
        result,
        request.thresholds,
      );
    }
    await request.resultStore?.save(result);
    return {
      result,
      regression,
      humanText: toHumanReport(result),
      jsonText: toJsonReport(result),
    };
  }
}

export interface ABExperimentSide {
  readonly name: string;
  readonly adapter: BenchmarkAgent;
  readonly runnerOptions?: Omit<BenchmarkRunnerOptions, "dataset" | "adapter">;
}

export interface ABExperimentResult {
  readonly a: BenchmarkResult;
  readonly b: BenchmarkResult;
  readonly comparison: RunComparison;
  readonly comparisonText: string;
}

/**
 * Deterministic A/B experiment: both sides run the exact same dataset (and
 * therefore the same fixture repositories and starting revisions).
 */
export async function runABExperiment(
  dataset: BenchmarkDataset,
  sideA: ABExperimentSide,
  sideB: ABExperimentSide,
): Promise<ABExperimentResult> {
  const optionsA = sideA.runnerOptions ?? {};
  const optionsB = sideB.runnerOptions ?? {};
  const runnerA = new BenchmarkRunner({
    dataset,
    adapter: sideA.adapter,
    ...optionsA,
  });
  const runnerB = new BenchmarkRunner({
    dataset,
    adapter: sideB.adapter,
    ...optionsB,
  });
  const [a, b] = await Promise.all([
    runnerA.runBenchmark(),
    runnerB.runBenchmark(),
  ]);
  const comparison = compareRuns(a, b);
  return {
    a,
    b,
    comparison,
    comparisonText: toComparisonReport(
      comparison,
      sideA.name,
      sideB.name,
    ),
  };
}