/**
 * @devforge/benchmark — Benchmark runner (DF-024).
 *
 * Orchestrates tasks: sequential or bounded-parallel execution, cancellation,
 * retries, deterministic ordering, and restart/resume. Results are always in
 * the deterministic task order of the dataset.
 */
import type { Clock } from "./clock.js";
import { SystemClock } from "./clock.js";
import type { RandomSource } from "./environment.js";
import { mulberry32 } from "./environment.js";
import { Cancellation } from "./execution.js";
import { BenchmarkError } from "./errors.js";
import { orderTasks, repositoryFor } from "./dataset.js";
import { runTask } from "./task-runner.js";
import { computeMetrics } from "./metrics.js";
import { resultIdFor } from "./result-store.js";
import type {
  BenchmarkAgent,
  BenchmarkDataset,
  BenchmarkResult,
  RunConfiguration,
  SuiteResult,
  TaskResult,
} from "./types.js";
import {
  BENCHMARK_VERSION,
  type BenchmarkTask,
} from "./types.js";
import type { RepositoryFixtureFactory } from "./repository-fixture.js";
import { TaskValidationError } from "./errors.js";
import {
  type ArtifactStore,
  buildTaskArtifacts,
  environmentRedactor,
  type ArtifactOptions,
} from "./artifacts.js";
import type { Environment } from "./environment.js";
import { TmpRepositoryFixtureFactory } from "./repository-fixture.js";

export interface BenchmarkRunnerOptions {
  readonly dataset: BenchmarkDataset;
  readonly adapter: BenchmarkAgent;
  readonly fixtureFactory?: RepositoryFixtureFactory;
  readonly clock?: Clock;
  readonly random?: RandomSource;
  readonly retries?: number;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  readonly order?: "dataset" | "id";
  readonly benchmarkVersion?: string;
  readonly devforgeVersion?: string;
  readonly name?: string;
  readonly modelConfiguration?: Readonly<Record<string, string>>;
  readonly memoryConfiguration?: Readonly<Record<string, string>>;
  readonly agentConfiguration?: Readonly<Record<string, string>>;
  readonly artifactStore?: ArtifactStore;
  readonly artifactOptions?: ArtifactOptions;
  readonly environment?: Environment;
}

const DEVFORGE_VERSION = "0.1.0";

/** Orchestrate a full benchmark run over a validated dataset. */
export class BenchmarkRunner {
  readonly dataset: BenchmarkDataset;
  readonly adapter: BenchmarkAgent;
  private readonly fixtureFactory: RepositoryFixtureFactory;
  private readonly clock: Clock;
  private readonly random: RandomSource;
  private readonly retries: number;
  private readonly concurrency: number;
  private readonly timeoutMs: number | undefined;
  private readonly order: "dataset" | "id";
  private readonly benchmarkVersion: string;
  private readonly devforgeVersion: string;
  private readonly name: string | undefined;
  private readonly modelConfiguration: Readonly<Record<string, string>>;
  private readonly memoryConfiguration: Readonly<Record<string, string>>;
  private readonly agentConfiguration: Readonly<Record<string, string>>;
  private readonly artifactStore: ArtifactStore | undefined;
  private readonly artifactOptions: ArtifactOptions;
  private readonly environment: Environment | undefined;
  private readonly cancellation = new Cancellation();
  private lastResult: BenchmarkResult | null = null;
  private running = false;
  private runCounter = 0;

  constructor(options: BenchmarkRunnerOptions) {
    this.dataset = options.dataset;
    this.adapter = options.adapter;
    this.fixtureFactory =
      options.fixtureFactory ?? new TmpRepositoryFixtureFactory();
    this.clock = options.clock ?? new SystemClock();
    this.random = options.random ?? mulberry32(1);
    this.retries = Math.max(0, options.retries ?? 0);
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.timeoutMs = options.timeoutMs;
    this.order = options.order ?? "dataset";
    this.benchmarkVersion = options.benchmarkVersion ?? BENCHMARK_VERSION;
    this.devforgeVersion = options.devforgeVersion ?? DEVFORGE_VERSION;
    this.name = options.name;
    this.modelConfiguration = options.modelConfiguration ?? {};
    this.memoryConfiguration = options.memoryConfiguration ?? {};
    this.agentConfiguration = options.agentConfiguration ?? {};
    this.artifactStore = options.artifactStore;
    this.artifactOptions = options.artifactOptions ?? {};
    this.environment = options.environment;
  }

  /** Abort any in-flight benchmark; current and pending tasks are cancelled. */
  cancel(): void {
    this.cancellation.cancel();
  }

  /** Whether the runner is mid-run. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Run a single task by id (ignores concurrency). */
  async runTask(taskId: string): Promise<TaskResult> {
    const task = this.dataset.tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new TaskValidationError(`unknown task '${taskId}'`);
    }
    return this.executeTask(task);
  }

  /** Run the full dataset with deterministic ordering. */
  async runBenchmark(): Promise<BenchmarkResult> {
    const tasks = orderTasks(this.dataset, this.order);
    const run = await this.runWithToken(tasks, undefined);
    return run.result;
  }

  /** Run an explicit subset of tasks as a suite. */
  async runSuite(taskIds: readonly string[]): Promise<SuiteResult> {
    const byId = new Map(
      this.dataset.tasks.map((task) => [task.id, task] as const),
    );
    const missing = taskIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new TaskValidationError(`unknown suite task(s): ${missing.join(", ")}`);
    }
    const tasks = Array.from(new Set(taskIds))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((id) => byId.get(id)!);
    const suiteResult = await this.runWithToken(
      tasks,
      `suite-${tasks.map((task) => task.id).join("-")}`,
    );
    return {
      suiteId: suiteResult.suiteId ?? `suite-${tasks.map((task) => task.id).join("-")}`,
      name: suiteResult.suiteId ?? `suite-${tasks.map((task) => task.id).join("-")}`,
      taskIds: tasks.map((task) => task.id),
      result: suiteResult.result,
    };
  }

  /** Run a task set under a fresh artifact run token. */
  private async runWithToken(
    tasks: readonly BenchmarkTask[],
    suiteId: string | undefined,
  ): Promise<{ suiteId: string | null; result: BenchmarkResult }> {
    this.runCounter += 1;
    const token = `run-${this.runCounter}`;
    this.running = true;
    try {
      const results = await this.runBatch(tasks);
      const result = this.buildResult(results, suiteId);
      await this.storeArtifacts(token, results);
      this.lastResult = result;
      return { suiteId: suiteId ?? null, result };
    } finally {
      this.running = false;
    }
  }

  /** Re-run every non-passed task from the last run and merge results. */
  async resume(): Promise<BenchmarkResult> {
    if (this.lastResult === null) return this.runBenchmark();
    const previous = this.lastResult;
    const previousById = new Map(
      previous.tasks.map((task) => [task.taskId, task] as const),
    );
    const tasks = orderTasks(this.dataset, this.order);
    const rerun = tasks.filter(
      (task) => (previousById.get(task.id)?.status ?? "error") !== "passed",
    );
    this.runCounter += 1;
    const token = `run-${this.runCounter}`;
    this.running = true;
    try {
      const fresh = await this.runBatch(rerun);
      const combined: TaskResult[] = [];
      for (const task of tasks) {
        const existing = previousById.get(task.id);
        const replacement = fresh.find((result) => result.taskId === task.id);
        if (replacement !== undefined) combined.push(replacement);
        else if (existing !== undefined) combined.push(existing);
      }
      const result = this.buildResult(combined);
      await this.storeArtifacts(token, fresh);
      this.lastResult = result;
      return result;
    } finally {
      this.running = false;
    }
  }

  private async storeArtifacts(
    token: string,
    results: readonly TaskResult[],
  ): Promise<void> {
    if (this.artifactStore === undefined) return;
    const redactor =
      this.artifactOptions.redactor ??
      environmentRedactor(this.environment);
    for (const result of results) {
      const artifacts = buildTaskArtifacts(null, result);
      for (const artifact of artifacts) {
        await this.artifactStore.save(token, result.taskId, {
          ...artifact,
          content: redactor(artifact.content),
        });
      }
    }
  }

  private async runBatch(tasks: readonly BenchmarkTask[]): Promise<TaskResult[]> {
    const results = new Array<TaskResult>(tasks.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = next;
        if (index >= tasks.length) return;
        next += 1;
        const task = tasks[index]!;
        if (this.cancellation.cancelled) {
          results[index] = cancelledResult(task, this.clock.now());
          continue;
        }
        results[index] = await this.executeTask(task);
      }
    };
    const workers = Array.from({ length: this.concurrency }, () => worker());
    await Promise.all(workers);
    for (let index = next; index < tasks.length; index += 1) {
      if (this.cancellation.cancelled && results[index] === undefined) {
        results[index] = cancelledResult(
          tasks[index]!,
          this.clock.now(),
        );
      }
    }
    return results;
  }

  private async executeTask(task: BenchmarkTask): Promise<TaskResult> {
    const repository = repositoryFor(this.dataset, task);
    if (!repository) {
      throw new BenchmarkError(
        `task '${task.id}' references unknown repository '${task.repository.id}'`,
        "missing_repository",
      );
    }
    return runTask({
      task,
      repository,
      adapter: this.adapter,
      fixtureFactory: this.fixtureFactory,
      clock: this.clock,
      cancellation: this.cancellation,
      random: this.random,
      retries: this.retries,
      timeoutMs: this.timeoutMs,
    });
  }

  private buildResult(results: TaskResult[], name?: string): BenchmarkResult {
    const configuration: RunConfiguration = {
      order: this.order,
      concurrency: this.concurrency,
      retries: this.retries,
      randomSeed: 1,
      adapterName: this.adapter.name,
      adapterVersion: this.adapter.version,
      model: this.modelConfiguration,
      memory: this.memoryConfiguration,
      agent: this.agentConfiguration,
    };
    const sorted = Array.from(results).sort((a, b) =>
      a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0,
    );
    const statusOf = (values: readonly TaskResult[], status: TaskResult["status"]) =>
      values.filter((result) => result.status === status).length;
    const result: Omit<BenchmarkResult, "resultId"> = {
      name: name ?? this.name ?? this.dataset.datasetName,
      datasetName: this.dataset.datasetName,
      datasetVersion: this.dataset.datasetVersion,
      datasetSchemaVersion: this.dataset.schemaVersion,
      benchmarkVersion: this.benchmarkVersion,
      devforgeVersion: this.devforgeVersion,
      createdAtMs: this.clock.now(),
      configuration,
      tasks: sorted,
      counts: {
        total: sorted.length,
        passed: statusOf(sorted, "passed"),
        failed: statusOf(sorted, "failed"),
        verificationFailed: statusOf(sorted, "verification_failed"),
        timeout: statusOf(sorted, "timeout"),
        cancelled: statusOf(sorted, "cancelled"),
        error: statusOf(sorted, "error"),
      },
    };
    return { ...result, resultId: resultIdFor(result as BenchmarkResult) };
  }
}

/** Deterministic cancelled-placeholder for tasks never started. */
export function cancelledResult(
  task: BenchmarkTask,
  nowMs: number,
): TaskResult {
  return {
    taskId: task.id,
    taskTitle: task.title,
    category: task.category,
    difficulty: task.difficulty,
    taskVersion: task.version ?? 1,
    repositoryId: task.repository.id,
    baseRevision: task.baseRevision,
    status: "cancelled",
    outcome: "cancelled",
    score: 0,
    attempts: 0,
    repairAttempts: 0,
    startedAtMs: nowMs,
    endedAtMs: nowMs,
    durationMs: 0,
    grader: {
      kind: "cancelled",
      passed: false,
      score: 0,
      reason: "run was cancelled before the task started",
      evidence: [],
    },
    signals: {
      buildPasses: null,
      testsPass: null,
      expectedTestsPass: null,
      unexpectedTestsFail: null,
      filesChanged: false,
      expectedFilesChanged: null,
      forbiddenFilesChanged: false,
      patchApplies: null,
      verificationSucceeds: false,
      timedOut: false,
      cancelled: true,
      regressionDetected: null,
      agentReportedSuccess: false,
    },
    evidence: [],
    errors: [],
    patchStats: null,
    telemetry: { attemptedRepairs: 0 },
  };
}

export { computeMetrics };