/**
 * @devforge/benchmark — Minimal CLI (DF-024).
 *
 * Runs a benchmark from a dataset JSON file with an offline baseline adapter,
 * writes a human report to stdout, and optionally persists the JSON result.
 * This is intentionally thin; the framework itself is the deliverable.
 */
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";

import { JsonDatasetLoader } from "./task-loader.js";
import { realFileSystemIO } from "./file-system.js";
import { runABExperiment } from "./benchmark.js";
import {
  createFailBaseline,
  createPassBaseline,
  DeterministicBaselineAgent,
} from "./baselines.js";
import { toHumanReport, toJsonReport } from "./reports.js";
import { evaluateRegression } from "./regression.js";
import { createResultStore, FileBackend } from "./result-store.js";
import { BenchmarkRunner } from "./benchmark-runner.js";
import {
  TmpRepositoryFixtureFactory,
  RealCommandRunner,
} from "./repository-fixture.js";
import type {
  BenchmarkAgent,
  BenchmarkDataset,
  BenchmarkResult,
} from "./types.js";

interface CliOptions {
  dataset: string;
  baseline: string;
  ab: boolean;
  compare: string | undefined;
  output: string | undefined;
  thresholdSuccess: number | undefined;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dataset: "dataset.json",
    baseline: "pass",
    ab: false,
    compare: undefined,
    output: undefined,
    thresholdSuccess: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--dataset" && value) options.dataset = value;
    else if (flag === "--baseline" && value) options.baseline = value;
    else if (flag === "--ab") options.ab = true;
    else if (flag === "--compare" && value) options.compare = value;
    else if (flag === "--output" && value) options.output = value;
    else if (flag === "--threshold-success" && value) {
      options.thresholdSuccess = Number(value);
    }
  }
  return options;
}

export function baselineFor(name: string): BenchmarkAgent {
  if (name === "fail") return createFailBaseline();
  if (name === "scripted-rewrite") {
    return new DeterministicBaselineAgent(
      {
        outcome: "pass",
        filesWritten: {
          "src/sum.ts":
            "export function sum(a: number, b: number): number {\n  return a + b;\n}\n",
        },
      },
      { name: "scripted-rewrite" },
    );
  }
  return createPassBaseline();
}

export async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  const loader = new JsonDatasetLoader(realFileSystemIO, process.cwd());
  const dataset = await loader.load(options.dataset);

  if (options.ab) {
    const experiment = await runABExperiment(
      dataset,
      {
        name: "pass",
        adapter: createPassBaseline({ name: "pass-a" }),
        runnerOptions: { devforgeVersion: "cli" },
      },
      {
        name: "fail",
        adapter: createFailBaseline({ name: "fail-b" }),
        runnerOptions: { devforgeVersion: "cli" },
      },
    );
    process.stdout.write(experiment.comparisonText);
    return 0;
  }

  const runner = new BenchmarkRunner({
    dataset,
    adapter: baselineFor(options.baseline),
    fixtureFactory: new TmpRepositoryFixtureFactory({
      commandRunner: new RealCommandRunner(),
    }),
    devforgeVersion: "cli",
  });
  const result = await runner.runBenchmark();
  process.stdout.write(toHumanReport(result));

  if (options.compare) {
    const store = createResultStore({
      backend: new FileBackend(
        realFileSystemIO,
        resolve(process.cwd(), "benchmarks/results"),
      ),
    });
    try {
      const stored = await store.load(options.compare);
      const regression = evaluateRegression(stored.result, result, {
        minSuccessRate: options.thresholdSuccess,
        maxRegressionRate: 0.2,
        maxTimeoutRate: 0.2,
      });
      process.stdout.write(
        regression.passed ? "REGRESSION: OK\n" : "REGRESSION: FAILED\n",
      );
    } catch {
      process.stdout.write(`REGRESSION: unknown baseline '${options.compare}'\n`);
    }
  }

  if (options.output) {
    await writeFile(options.output, toJsonReport(result), "utf8");
  }
  return 0;
}

export type { BenchmarkDataset, BenchmarkResult };