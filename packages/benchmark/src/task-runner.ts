/**
 * @devforge/benchmark — Task runner (DF-024).
 *
 * Executes one benchmark task end-to-end inside an isolated fixture with
 * retries, deadline protection, and cancellation, then grades it against the
 * task's configured verification. Success is decided by grading, not by the
 * adapter's reported status.
 */
import type { Clock } from "./clock.js";
import type { RandomSource } from "./environment.js";
import {
  Cancellation,
  Deadline,
  messageOf,
  type TaskRunContext,
} from "./execution.js";
import {
  CancelledError,
  TaskExecutionError,
  TimeoutError,
} from "./errors.js";
import { collectVerificationOutputs } from "./verification.js";
import { gradeVerification, type GraderResult } from "./grader.js";
import { evaluateExecution } from "./evaluation.js";
import { patchStats } from "./patch.js";
import type {
  AgentRunResult,
  BenchmarkAgent,
  BenchmarkTask,
  DatasetRepository,
  PatchStats,
  TaskResult,
  VerificationOutputs,
} from "./types.js";
import {
  type RepositoryFixture,
  type RepositoryFixtureFactory,
} from "./repository-fixture.js";

export interface RunTaskOptions {
  readonly task: BenchmarkTask;
  readonly repository: DatasetRepository;
  readonly adapter: BenchmarkAgent;
  readonly fixtureFactory: RepositoryFixtureFactory;
  readonly clock: Clock;
  readonly cancellation: Cancellation;
  readonly random: RandomSource;
  readonly retries?: number;
  readonly timeoutMs?: number;
}

/** Run a single task to completion inside its own fixture. */
export async function runTask(options: RunTaskOptions): Promise<TaskResult> {
  const task = options.task;
  const retries = Math.max(0, options.retries ?? 0);
  const timeoutMs = options.timeoutMs ?? task.timeoutMs;
  const events: string[] = [];

  const startedAtMs = options.clock.now();
  let fixture: RepositoryFixture;
  try {
    fixture = await options.fixtureFactory.create(task, options.repository);
  } catch (error) {
    return taskResultFor(task, {
      status: "error",
      outcome: "error",
      startedAtMs,
      endedAtMs: options.clock.now(),
      score: 0,
      attempts: 0,
      repairAttempts: 0,
      grader: {
        kind: "error",
        passed: false,
        score: 0,
        reason: "fixture creation failed",
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
        cancelled: false,
        regressionDetected: null,
        agentReportedSuccess: false,
      },
      evidence: [],
      errors: [messageOf(error)],
      patchStats: null,
      telemetry: { attemptedRepairs: 0 },
    });
  }

  try {
    await fixture.initialize();
  } catch (error) {
    await safeCleanup(fixture);
    return taskResultFor(task, {
      status: "error",
      outcome: "error",
      startedAtMs,
      endedAtMs: options.clock.now(),
      score: 0,
      attempts: 0,
      repairAttempts: 0,
      grader: {
        kind: "error",
        passed: false,
        score: 0,
        reason: "fixture initialization failed",
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
        cancelled: false,
        regressionDetected: null,
        agentReportedSuccess: false,
      },
      evidence: [],
      errors: [messageOf(error)],
      patchStats: null,
      telemetry: { attemptedRepairs: 0 },
    });
  }

  const errors: string[] = [];
  let agent: AgentRunResult | null = null;
  let grader: GraderResult | null = null;
  let status: TaskResult["status"] = "error";
  let outcome: TaskResult["outcome"] = "error";
  let score = 0;
  let repairAttempts = 0;
  let attempts = 0;
  let patchMeta: PatchStats | null = null;
  let timedOut = false;
  let cancelled = false;
  let outputs: VerificationOutputs | null = null;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    attempts = attempt;
    try {
      if (options.cancellation.cancelled) {
        cancelled = true;
        break;
      }
      await restoreBase(fixture, options.repository);
      const deadline = new Deadline(options.clock.now(), timeoutMs, options.clock);
      const context: TaskRunContext = {
        task,
        fixture,
        clock: options.clock,
        cancellation: options.cancellation,
        deadline,
        attempt,
        events,
      };
      agent = await options.adapter.run({ task, fixture, context });
      await applyAgentChanges(fixture, agent);

      outputs = await collectVerificationOutputs(
        task,
        fixture,
        agent.patch ?? null,
        { deadline },
      );
      grader = gradeVerification(task.verification, {
        task,
        fixture,
        agent,
        outputs,
        now: options.clock.now(),
      });
      repairAttempts = agent.telemetry.attemptedRepairs;
      patchMeta =
        agent.patch === undefined
          ? { filesChanged: 0, additions: 0, deletions: 0 }
          : patchStats(agent.patch);
      score = grader.score;

      if (grader.passed) {
        status = "passed";
        outcome = "success";
        break;
      }
      status = "verification_failed";
      outcome = "verification_failed";
      if (attempt <= retries) continue;
      break;
    } catch (error) {
      if (error instanceof TimeoutError) {
        timedOut = true;
        break;
      }
      if (error instanceof CancelledError) {
        cancelled = true;
        break;
      }
      errors.push(messageOf(error));
      if (attempt <= retries) continue;
      status = "error";
      outcome = "error";
      break;
    }
  }

  const endedAtMs = options.clock.now();
  const finalAgent = agent ?? {
    status: "error" as const,
    plan: { summary: "", steps: [], durationMs: 0 },
    steps: [],
    filesWritten: {},
    telemetry: { attemptedRepairs: repairAttempts },
  };

  const signals =
    grader !== null && outputs !== null
      ? evaluateExecution({
          task,
          fixture,
          agent: finalAgent,
          outputs,
          grader: {
            kind: grader.kind,
            passed: grader.passed,
            score: grader.score,
            reason: grader.reason,
            evidence: grader.evidence,
          },
          timedOut,
          cancelled,
        }).signals
      : {
          buildPasses: null,
          testsPass: null,
          expectedTestsPass: null,
          unexpectedTestsFail: null,
          filesChanged: false,
          expectedFilesChanged: null,
          forbiddenFilesChanged: false,
          patchApplies: null,
          verificationSucceeds: false,
          timedOut,
          cancelled,
          regressionDetected: null,
          agentReportedSuccess: finalAgent.status === "success",
        };

  await safeCleanup(fixture);

  return taskResultFor(task, {
    status: cancelled ? "cancelled" : timedOut ? "timeout" : status,
    outcome: cancelled ? "cancelled" : timedOut ? "timeout" : outcome,
    startedAtMs,
    endedAtMs,
    score,
    attempts,
    repairAttempts,
    grader: grader
      ? {
          kind: grader.kind,
          passed: grader.passed,
          score: grader.score,
          reason: grader.reason,
          evidence: grader.evidence,
        }
      : {
          kind: "error",
          passed: false,
          score: 0,
          reason: timedOut
            ? "deadline exceeded"
            : cancelled
              ? "cancelled"
              : "no grader ran",
          evidence: [],
        },
    signals,
    evidence: [...events, ...errors],
    errors,
    patchStats: patchMeta,
    telemetry: finalAgent.telemetry,
  });
}

interface TaskResultParts {
  readonly status: TaskResult["status"];
  readonly outcome: TaskResult["outcome"];
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly score: number;
  readonly attempts: number;
  readonly repairAttempts: number;
  readonly grader: TaskResult["grader"];
  readonly signals: TaskResult["signals"];
  readonly evidence: readonly string[];
  readonly errors: readonly string[];
  readonly patchStats: PatchStats | null;
  readonly telemetry: TaskResult["telemetry"];
}

function taskResultFor(task: BenchmarkTask, parts: TaskResultParts): TaskResult {
  return {
    taskId: task.id,
    taskTitle: task.title,
    category: task.category,
    difficulty: task.difficulty,
    taskVersion: task.version ?? 1,
    repositoryId: task.repository.id,
    baseRevision: task.baseRevision,
    status: parts.status,
    outcome: parts.outcome,
    score: parts.score,
    attempts: parts.attempts,
    repairAttempts: parts.repairAttempts,
    startedAtMs: parts.startedAtMs,
    endedAtMs: parts.endedAtMs,
    durationMs: Math.max(0, parts.endedAtMs - parts.startedAtMs),
    grader: parts.grader,
    signals: parts.signals,
    evidence: parts.evidence,
    errors: parts.errors,
    patchStats: parts.patchStats,
    telemetry: parts.telemetry,
  };
}

/** Optimistic restore to the dataset's base state before each attempt. */
async function restoreBase(
  fixture: RepositoryFixture,
  repository: DatasetRepository,
): Promise<void> {
  const basePaths = Object.keys(repository.files);
  for (const relativePath of basePaths) {
    const content = repository.files[relativePath];
    if (content === undefined) continue;
    await fixture.writeFile(relativePath, content);
  }
  const current = await fixture.listFiles();
  const extra = current.filter(
    (filePath) => !basePaths.includes(filePath) && !basePaths.some((base) => base.startsWith(`${filePath}/`)),
  );
  for (const filePath of extra) {
    await fixture.deleteFile(filePath);
  }
}

/** Apply the adapter's intended file changes to the fixture. */
async function applyAgentChanges(
  fixture: RepositoryFixture,
  agent: AgentRunResult,
): Promise<void> {
  const paths = Object.keys(agent.filesWritten).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const relativePath of paths) {
    const content = agent.filesWritten[relativePath];
    if (content === undefined) continue;
    await fixture.writeFile(relativePath, content);
  }
  if (agent.patch !== undefined) {
    const files: Record<string, string> = {};
    for (const filePath of await fixture.listFiles()) {
      const content = await fixture.readFile(filePath);
      if (content !== null) files[filePath] = content;
    }
    for (const change of agent.patch.changes) {
      const current = files[change.path];
      if (change.before !== undefined && current !== change.before) {
        throw new TaskExecutionError(
          `patch for '${change.path}' does not apply (before mismatch)`,
        );
      }
      if (change.after === undefined) {
        delete files[change.path];
      } else {
        files[change.path] = change.after;
      }
    }
    for (const filePath of Object.keys(files)) {
      await fixture.writeFile(filePath, files[filePath] as string);
    }
    const after = Object.keys(files);
    for (const filePath of await fixture.listFiles()) {
      if (!after.includes(filePath)) await fixture.deleteFile(filePath);
    }
  }
}

async function safeCleanup(fixture: RepositoryFixture): Promise<void> {
  try {
    await fixture.cleanup();
  } catch {
    /* best-effort teardown; never masks the original result */
  }
}