/**
 * @devforge/benchmark — Objective evaluation (DF-024).
 *
 * Success is decided by the benchmark's configured verification, never by the
 * agent's status. This module derives the full signal set and maps them onto a
 * deterministic outcome.
 */
import type {
  AgentRunResult,
  BenchmarkTask,
  EvaluationResult,
  EvaluationSignals,
  GraderResultSummary,
  TaskStatus,
  VerificationOutputs,
} from "./types.js";
import type { RepositoryFixture } from "./repository-fixture.js";
import { applyPatch } from "./patch.js";

export interface EvaluationInput {
  readonly task: BenchmarkTask;
  readonly fixture: RepositoryFixture;
  readonly agent: AgentRunResult;
  readonly outputs: VerificationOutputs;
  readonly grader: GraderResultSummary;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
}

/** Pure derivation of the objective signal set. */
export function deriveSignals(input: EvaluationInput): EvaluationSignals {
  const { task, agent, outputs, grader } = input;
  const summary = outputs.testSummary;
  const verification = task.verification;
  const testsVerification = verification.kind === "tests" ? verification : undefined;
  const expectedTestsPass =
    testsVerification !== undefined && summary !== null
      ? testsVerification.mustPass.length > 0 &&
        testsVerification.mustPass.every((name) => summary.byName[name] === true)
      : testsVerification !== undefined
        ? false
        : null;
  const unexpectedTestsFail =
    summary !== null
      ? summary.failureNames.some(
          (name) => !(testsVerification?.mustPass ?? []).includes(name),
        )
      : null;

  const changed = new Set<string>();
  for (const change of outputs.patch?.changes ?? []) changed.add(change.path);
  for (const filePath of Object.keys(agent.filesWritten)) changed.add(filePath);
  const filesChanged = outputs.patch !== null || Object.keys(agent.filesWritten).length > 0;

  const expectedPaths =
    verification.kind === "diff"
      ? verification.expectedPaths
      : verification.kind === "files"
        ? verification.expected
        : [];
  const forbiddenPaths =
    verification.kind === "diff"
      ? verification.forbiddenPaths ?? []
      : verification.kind === "files"
        ? verification.forbidden ?? []
        : [];

  const expectedFilesChanged = expectedPaths.some((filePath) => changed.has(filePath))
    ? true
    : expectedPaths.length > 0
      ? false
      : null;
  const forbiddenFilesChanged = forbiddenPaths.some((filePath) => changed.has(filePath));
  const patchApplies =
    outputs.patch === null
      ? null
      : applyPatch({ ...outputs.contents }, outputs.patch).applied;

  return {
    buildPasses: outputs.buildStatus,
    testsPass: summary === null ? null : summary.failed === 0,
    expectedTestsPass,
    unexpectedTestsFail,
    filesChanged,
    expectedFilesChanged,
    forbiddenFilesChanged,
    patchApplies,
    verificationSucceeds: grader.passed,
    timedOut: input.timedOut,
    cancelled: input.cancelled,
    regressionDetected: null,
    agentReportedSuccess: agent.status === "success",
  };
}

/** Map signals to a deterministic status/outcome pair. */
export function statusFrom(signals: EvaluationSignals): {
  status: TaskStatus;
  outcome: EvaluationResult["outcome"];
} {
  if (signals.timedOut) return { status: "timeout", outcome: "timeout" };
  if (signals.cancelled) return { status: "cancelled", outcome: "cancelled" };
  if (signals.verificationSucceeds) return { status: "passed", outcome: "success" };
  return { status: "verification_failed", outcome: "verification_failed" };
}

/** Full evaluation combining signal derivation and status mapping. */
export function evaluateExecution(input: EvaluationInput): EvaluationResult {
  const signals = deriveSignals(input);
  const mapped = statusFrom(signals);
  const reasons: string[] = [];
  if (mapped.status === "passed") {
    reasons.push("configured verification passed");
  } else if (mapped.status === "timeout") {
    reasons.push("task exceeded its time budget");
  } else if (mapped.status === "cancelled") {
    reasons.push("run was cancelled");
  } else {
    reasons.push("configured verification did not pass");
    if (input.agent.status === "success") {
      reasons.push("agent reported success but verification failed");
    }
  }
  return { status: mapped.status, outcome: mapped.outcome, signals, reasons };
}

export type {
  GraderResultSummary,
  RepositoryFixture,
  BenchmarkTask,
  AgentRunResult,
  VerificationOutputs,
};