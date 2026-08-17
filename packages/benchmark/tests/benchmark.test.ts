import { describe, expect, it } from "vitest";
import { Benchmark, runABExperiment } from "../src/benchmark.js";
import { InMemoryFileSystemIO } from "../src/file-system.js";
import { InMemoryRepositoryFixtureFactory } from "../src/repository-fixture.js";
import { FakeClock } from "../src/clock.js";
import { MemoryBackend, createResultStore } from "../src/result-store.js";
import {
  createFailBaseline,
  createPassBaseline,
} from "../src/baselines.js";
import {
  makeDataset,
  makeTask,
  passAgent,
  ScriptedCommandRunner,
} from "./helpers.js";

const changeTask = makeTask("changelog", {
  kind: "files",
  expected: ["docs/CHANGELOG.md"],
});

function inMemoryRunnerOptions() {
  return {
    fixtureFactory: new InMemoryRepositoryFixtureFactory({
      io: InMemoryFileSystemIO.create(),
      commandRunner: new ScriptedCommandRunner(),
    }),
    clock: new FakeClock(0),
  };
}

describe("Benchmark.buildRunner", () => {
  it("wires the dataset and adapter into a runner", async () => {
    const dataset = makeDataset("d", [changeTask]);
    const runner = Benchmark.buildRunner({
      dataset,
      adapter: passAgent(),
      runnerOptions: inMemoryRunnerOptions(),
    });
    const result = await runner.runBenchmark();
    expect(result.datasetName).toBe("d");
  });
});

describe("Benchmark.run", () => {
  it("returns human and JSON reports", async () => {
    const dataset = makeDataset("d", [changeTask]);
    const report = await Benchmark.run({
      dataset,
      adapter: createPassBaseline({ name: "writer", files: { "docs/CHANGELOG.md": "# v1\n" } }),
      runnerOptions: inMemoryRunnerOptions(),
    });
    expect(report.result.counts.total).toBe(1);
    expect(report.humanText).toContain("Benchmark:");
    const json = JSON.parse(report.jsonText);
    expect(json.summary.counts.total).toBe(1);
  });

  it("evaluates regression when a baseline and thresholds are supplied", async () => {
    const dataset = makeDataset("d", [changeTask]);
    const passing = {
      dataset,
      adapter: createPassBaseline({ name: "w", files: { "docs/CHANGELOG.md": "# v1\n" } }),
      runnerOptions: inMemoryRunnerOptions(),
    };
    const baseline = (await Benchmark.run(passing)).result;
    const report = await Benchmark.run({
      ...passing,
      baseline,
      thresholds: { minSuccessRate: 0.5 },
    });
    expect(report.regression).toBeDefined();
    expect(report.regression!.passed).toBe(true);
  });

  it("skips regression without a baseline", async () => {
    const report = await Benchmark.run({
      dataset: makeDataset("d", [changeTask]),
      adapter: createFailBaseline(),
      runnerOptions: inMemoryRunnerOptions(),
    });
    expect(report.regression).toBeUndefined();
  });

  it("persists results to a configured store", async () => {
    const backend = new MemoryBackend();
    const store = createResultStore({ backend });
    const report = await Benchmark.run({
      dataset: makeDataset("d", [changeTask]),
      adapter: createFailBaseline(),
      runnerOptions: inMemoryRunnerOptions(),
      resultStore: store,
    });
    expect(backend.entries.has(report.result.resultId)).toBe(true);
  });
});

describe("runABExperiment", () => {
  it("runs both sides against the same dataset deterministically", async () => {
    const dataset = makeDataset("d", [changeTask]);
    const experiment = await runABExperiment(
      dataset,
      {
        name: "writer",
        adapter: createPassBaseline({ name: "writer-a", files: { "docs/CHANGELOG.md": "# v1\n" } }),
        runnerOptions: { ...inMemoryRunnerOptions() },
      },
      {
        name: "bare",
        adapter: createPassBaseline({ name: "bare-b" }),
        runnerOptions: { ...inMemoryRunnerOptions() },
      },
    );
    expect(experiment.a.counts.passed).toBe(1);
    expect(experiment.b.counts.passed).toBe(0);
    expect(experiment.comparison.regressed).toBe(1);
    expect(experiment.comparison.improved).toBe(0);
    expect(experiment.comparisonText).toContain("Comparison: writer vs bare");
  });

  it("reports symmetric task comparisons with A/B ids", async () => {
    const dataset = makeDataset("d", [changeTask]);
    const experiment = await runABExperiment(
      dataset,
      {
        name: "x",
        adapter: createFailBaseline(),
        runnerOptions: { ...inMemoryRunnerOptions() },
      },
      {
        name: "y",
        adapter: createFailBaseline(),
        runnerOptions: { ...inMemoryRunnerOptions() },
      },
    );
    expect(experiment.comparison.runAId).toBe(experiment.a.resultId);
    expect(experiment.comparison.regressed).toBe(0);
    expect(experiment.comparison.unchanged).toBe(1);
  });

  it("keeps results comparable across sides", async () => {
    const dataset = makeDataset("d", [changeTask]);
    const experiment = await runABExperiment(
      dataset,
      { name: "a", adapter: createFailBaseline(), runnerOptions: inMemoryRunnerOptions() },
      { name: "b", adapter: createFailBaseline(), runnerOptions: inMemoryRunnerOptions() },
    );
    expect(experiment.a.tasks.length).toBe(1);
    expect(experiment.b.tasks.length).toBe(1);
  });
});