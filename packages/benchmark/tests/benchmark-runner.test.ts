import { describe, expect, it } from "vitest";
import { BenchmarkRunner } from "../src/benchmark-runner.js";
import { TaskValidationError } from "../src/errors.js";
import { InMemoryFileSystemIO } from "../src/file-system.js";
import { InMemoryRepositoryFixtureFactory } from "../src/repository-fixture.js";
import { Cancellation } from "../src/execution.js";
import { FakeClock } from "../src/clock.js";
import { mulberry32 } from "../src/environment.js";
import { MemoryArtifactStore } from "../src/artifacts.js";
import type { AgentRunResult, AgentStepResult, AgentPlanResult, BenchmarkAgent, TaskRunContext } from "../src/types.js";
import {
  makeDataset,
  makeTask,
  passAgent,
  ScriptedCommandRunner,
} from "./helpers.js";

const taskA = makeTask("a", { kind: "tests", mustPass: ["a.test.js"] });
const taskB = makeTask("b", { kind: "tests", mustPass: ["missing.test.js"] });

function passingRunner(): ScriptedCommandRunner {
  return new ScriptedCommandRunner({
    "run-tests": { stdout: "PASS a.test.js\nPASS b.test.js\n" },
  });
}

function makeRunner(
  tasks: (typeof taskA)[],
  options: {
    runner?: ScriptedCommandRunner;
    adapter?: BenchmarkAgent;
    retries?: number;
    concurrency?: number;
    order?: "dataset" | "id";
    artifactStore?: MemoryArtifactStore;
    clock?: FakeClock;
  } = {},
) {
  const io = InMemoryFileSystemIO.create();
  const dataset = makeDataset("runner-ds", tasks);
  return new BenchmarkRunner({
    dataset,
    adapter: options.adapter ?? passAgent(),
    fixtureFactory: new InMemoryRepositoryFixtureFactory({
      io,
      commandRunner: options.runner ?? passingRunner(),
    }),
    clock: options.clock ?? new FakeClock(0),
    random: mulberry32(1),
    retries: options.retries,
    concurrency: options.concurrency,
    order: options.order,
    artifactStore: options.artifactStore,
  });
}

describe("BenchmarkRunner.runBenchmark", () => {
  it("runs the dataset and counts outcomes", async () => {
    const runner = makeRunner([taskA, taskB]);
    const result = await runner.runBenchmark();
    expect(result.counts.total).toBe(2);
    expect(result.counts.passed).toBe(1);
    expect(result.counts.verificationFailed).toBe(1);
    expect(result.datasetName).toBe("runner-ds");
  });

  it("produces deterministic identical results across runs", async () => {
    const first = await makeRunner([taskA, taskB]).runBenchmark();
    const second = await makeRunner([taskA, taskB]).runBenchmark();
    expect(first).toEqual(second);
    expect(first.resultId).toBe(second.resultId);
  });

  it("sorts result tasks by id", async () => {
    const runner = makeRunner([taskB, taskA]);
    const result = await runner.runBenchmark();
    expect(result.tasks.map((task) => task.taskId)).toEqual(["a", "b"]);
  });

  it("supports bounded-parallel execution", async () => {
    const runner = makeRunner([taskA, taskB], { concurrency: 2 });
    const result = await runner.runBenchmark();
    expect(result.counts.total).toBe(2);
  });
});

describe("BenchmarkRunner.runTask / runSuite", () => {
  it("runs a single task by id", async () => {
    const runner = makeRunner([taskA, taskB]);
    const result = await runner.runTask("a");
    expect(result.taskId).toBe("a");
    expect(result.status).toBe("passed");
  });

  it("throws for unknown task ids", async () => {
    const runner = makeRunner([taskA]);
    await expect(runner.runTask("nope")).rejects.toThrow(TaskValidationError);
  });

  it("runs an explicit suite", async () => {
    const runner = makeRunner([taskA, taskB]);
    const suite = await runner.runSuite(["b"]);
    expect(suite.suiteId).toBe("suite-b");
    expect(suite.result.counts.total).toBe(1);
    expect(suite.result.tasks[0]!.taskId).toBe("b");
  });

  it("rejects unknown suite task ids", async () => {
    const runner = makeRunner([taskA]);
    await expect(runner.runSuite(["zz"])).rejects.toThrow(TaskValidationError);
  });

  it("deduplicates suite task ids", async () => {
    const runner = makeRunner([taskA, taskB]);
    const suite = await runner.runSuite(["a", "a", "b"]);
    expect(suite.taskIds).toEqual(["a", "b"]);
  });
});

describe("BenchmarkRunner cancellation", () => {
  class LatchAgent implements BenchmarkAgent {
    readonly name = "latch";
    readonly version = "1.0.0";
    constructor(private readonly latch: Promise<void>) {}

    async plan(): Promise<AgentPlanResult> {
      return { summary: "s", steps: [], durationMs: 0 };
    }
    async execute(): Promise<AgentStepResult> {
      return { intent: "x", status: "success", message: "m", commandsRun: [], durationMs: 0 };
    }
    async run(input: { context: TaskRunContext }): Promise<AgentRunResult> {
      await this.latch;
      if (input.context.cancellation.cancelled) {
        throw new (await import("../src/errors.js")).CancelledError("cancelled in adapter");
      }
      return {
        status: "success",
        plan: { summary: "s", steps: [], durationMs: 0 },
        steps: [],
        filesWritten: {},
        telemetry: {},
      };
    }
  }

  it("cancels in-flight and pending tasks", async () => {
    let release!: () => void;
    const latch = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner = makeRunner([taskA, taskB], { adapter: new LatchAgent(latch) });
    const pending = runner.runBenchmark();
    runner.cancel();
    release();
    const result = await pending;
    expect(runner.isRunning).toBe(false);
    expect(result.counts.cancelled).toBe(2);
  });

  it("tracks running state", async () => {
    const runner = makeRunner([taskA]);
    expect(runner.isRunning).toBe(false);
    const pending = runner.runBenchmark();
    expect(runner.isRunning).toBe(true);
    await pending;
    expect(runner.isRunning).toBe(false);
  });
});

describe("BenchmarkRunner.resume", () => {
  it("re-runs only non-passed tasks", async () => {
    const results = { "run-tests": { stdout: "PASS a.test.js\nPASS b.test.js\n" } };
    const runner = makeRunner([taskA, taskB], { runner: new ScriptedCommandRunner(results) });
    const first = await runner.runBenchmark();
    expect(first.counts.passed).toBe(1);

    results["run-tests"] = {
      stdout: "PASS a.test.js\nPASS b.test.js\nPASS missing.test.js\n",
    };
    const resumed = await runner.resume();
    expect(resumed.counts.total).toBe(2);
    expect(resumed.counts.passed).toBe(2);
  });

  it("behaves like runBenchmark when nothing ran yet", async () => {
    const runner = makeRunner([taskA]);
    const result = await runner.resume();
    expect(result.counts.total).toBe(1);
  });
});

describe("BenchmarkRunner artifacts", () => {
  it("stores artifacts for each task under a run token", async () => {
    const artifactStore = new MemoryArtifactStore();
    const runner = makeRunner([taskA, taskB], { artifactStore });
    await runner.runBenchmark();
    expect((await artifactStore.list("run-1")).length).toBe(2);
  });

  it("stores artifacts per run token", async () => {
    const artifactStore = new MemoryArtifactStore();
    const runner = makeRunner([taskA], { artifactStore });
    await runner.runBenchmark();
    await runner.runSuite(["a"]);
    expect((await artifactStore.list("run-1")).length).toBe(1);
    expect((await artifactStore.list("run-2")).length).toBe(1);
  });
});