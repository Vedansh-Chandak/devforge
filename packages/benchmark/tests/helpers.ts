/**
 * Test helpers for @devforge/benchmark (DF-024).
 *
 * Shared factories for tasks, datasets, results, fixtures, and adapters so the
 * suite stays deterministic and never touches the real filesystem or network.
 */
import type {
  BenchmarkAgent,
  BenchmarkDataset,
  BenchmarkResult,
  BenchmarkTask,
  CommandResult,
  DatasetRepository,
  TaskResult,
  Verification,
} from "../src/types.js";
import { createDataset } from "../src/dataset.js";
import { resultIdFor } from "../src/result-store.js";
import { mulberry32 } from "../src/environment.js";
import { FakeClock } from "../src/clock.js";
import { Cancellation } from "../src/execution.js";
import { InMemoryFileSystemIO } from "../src/file-system.js";
import type { CommandRunner } from "../src/repository-fixture.js";
import { InMemoryRepositoryFixtureFactory } from "../src/repository-fixture.js";
import { createPassBaseline } from "../src/baselines.js";
import { runTask } from "../src/task-runner.js";

export const TEST_REPOSITORY: DatasetRepository = {
  id: "sample-ts",
  description: "test repository",
  isGit: false,
  files: {
    "src/sum.ts": "export function sum(a: number, b: number): number {\n  return a - b;\n}\n",
    "src/index.ts": 'export { sum } from "./sum.js";\n',
    "README.md": "# sample-ts\n",
  },
};

export function makeRepository(
  id: string,
  files: Readonly<Record<string, string>> = TEST_REPOSITORY.files,
): DatasetRepository {
  return { id, description: `${id} repository`, isGit: false, files: { ...files } };
}

export function makeTask(
  id: string,
  verification: Verification = { kind: "tests", mustPass: ["sum.test.js"] },
  extra: Partial<BenchmarkTask> = {},
): BenchmarkTask {
  return {
    id,
    title: `Task ${id}`,
    description: `Description for ${id}`,
    repository: { id: TEST_REPOSITORY.id },
    baseRevision: "main",
    setup: [],
    expectedBehavior: { summary: `Expected behavior for ${id}` },
    verification,
    timeoutMs: 60_000,
    tags: ["test"],
    difficulty: "MEDIUM",
    category: "FEATURE",
    version: 1,
    ...extra,
  };
}

export function makeDataset(
  name: string,
  tasks: readonly BenchmarkTask[],
  repositories: readonly DatasetRepository[] = [TEST_REPOSITORY],
): BenchmarkDataset {
  return createDataset({ datasetName: name, tasks, repositories });
}

export function makeTaskResult(
  taskId: string,
  overrides: Partial<TaskResult> = {},
): TaskResult {
  return {
    taskId,
    taskTitle: `Task ${taskId}`,
    category: "FEATURE",
    difficulty: "MEDIUM",
    taskVersion: 1,
    repositoryId: TEST_REPOSITORY.id,
    baseRevision: "main",
    status: "passed",
    outcome: "success",
    score: 1,
    attempts: 1,
    repairAttempts: 0,
    startedAtMs: 0,
    endedAtMs: 1000,
    durationMs: 1000,
    grader: {
      kind: "tests",
      passed: true,
      score: 1,
      reason: "ok",
      evidence: [],
    },
    signals: {
      buildPasses: null,
      testsPass: true,
      expectedTestsPass: true,
      unexpectedTestsFail: false,
      filesChanged: true,
      expectedFilesChanged: true,
      forbiddenFilesChanged: false,
      patchApplies: null,
      verificationSucceeds: true,
      timedOut: false,
      cancelled: false,
      regressionDetected: null,
      agentReportedSuccess: true,
    },
    evidence: [],
    errors: [],
    patchStats: { filesChanged: 1, additions: 1, deletions: 1 },
    telemetry: { attemptedRepairs: 0 },
    ...overrides,
  };
}

export function makeResult(
  tasks: readonly TaskResult[],
  overrides: Partial<BenchmarkResult> = {},
): BenchmarkResult {
  const counts = {
    total: tasks.length,
    passed: tasks.filter((task) => task.status === "passed").length,
    failed: tasks.filter((task) => task.status === "failed").length,
    verificationFailed: tasks.filter(
      (task) => task.status === "verification_failed",
    ).length,
    timeout: tasks.filter((task) => task.status === "timeout").length,
    cancelled: tasks.filter((task) => task.status === "cancelled").length,
    error: tasks.filter((task) => task.status === "error").length,
  };
  const result: Omit<BenchmarkResult, "resultId"> = {
    name: "test-run",
    datasetName: "test-dataset",
    datasetVersion: "1.0.0",
    datasetSchemaVersion: 1,
    benchmarkVersion: "1.0.0",
    devforgeVersion: "0.1.0",
    createdAtMs: 1000,
    configuration: {
      order: "dataset",
      concurrency: 1,
      retries: 0,
      randomSeed: 1,
      adapterName: "pass-baseline",
      adapterVersion: "1.0.0",
      model: {},
      memory: {},
      agent: {},
    },
    tasks: Array.from(tasks),
    counts,
    ...overrides,
  };
  const resultId = overrides.resultId ?? resultIdFor(result as BenchmarkResult);
  return { ...result, resultId };
}

/** Command runner that returns scripted outputs per command. */
export class ScriptedCommandRunner implements CommandRunner {
  readonly name = "scripted";

  constructor(
    private readonly results: Readonly<Record<string, Partial<CommandResult>>> = {},
  ) {}

  async run(
    dir: string,
    command: string,
    _options?: { timeoutMs?: number },
  ): Promise<CommandResult> {
    const scripted = this.results[command] ?? {};
    return {
      command,
      exitCode: scripted.exitCode ?? 0,
      stdout: scripted.stdout ?? "",
      stderr: scripted.stderr ?? "",
      durationMs: scripted.durationMs ?? 0,
    };
  }
}

export function passAgent(name = "pass-baseline"): BenchmarkAgent {
  return createPassBaseline({ name });
}

export function makeFixture(
  io: InMemoryFileSystemIO,
  runner: CommandRunner,
  task: BenchmarkTask,
  repository: DatasetRepository,
) {
  const factory = new InMemoryRepositoryFixtureFactory({ io, commandRunner: runner });
  return factory.create(task, repository);
}

export interface RunTaskWithOptions {
  readonly adapter?: BenchmarkAgent;
  readonly io?: InMemoryFileSystemIO;
  readonly runner?: CommandRunner;
  readonly clock?: FakeClock;
  readonly cancellation?: Cancellation;
  readonly retries?: number;
  readonly timeoutMs?: number;
}

export async function runTaskWith(
  task: BenchmarkTask,
  repository: DatasetRepository,
  options: RunTaskWithOptions = {},
): Promise<TaskResult> {
  const io = options.io ?? InMemoryFileSystemIO.create();
  const runner = options.runner ?? new ScriptedCommandRunner();
  return runTask({
    task,
    repository,
    adapter: options.adapter ?? passAgent(),
    fixtureFactory: new InMemoryRepositoryFixtureFactory({ io, commandRunner: runner }),
    clock: options.clock ?? new FakeClock(0),
    cancellation: options.cancellation ?? new Cancellation(),
    random: mulberry32(1),
    retries: options.retries,
    timeoutMs: options.timeoutMs,
  });
}
