/**
 * @devforge/benchmark — Deterministic graders (DF-024).
 *
 * Graders translate raw verification outputs into structured verdicts.
 * Every grader is a pure function of its inputs: identical outputs always
 * produce identical verdicts, so a reported agent success is never trusted
 * on its own.
 */
import type {
  AgentRunResult,
  BenchmarkTask,
  Verification,
  VerificationOutputs,
} from "./types.js";
import type { RepositoryFixture } from "./repository-fixture.js";
import { applyPatch } from "./patch.js";

export interface GraderResult {
  readonly kind: string;
  readonly passed: boolean;
  readonly score: number;
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly durationMs: number;
}

export interface GradeContext {
  readonly task: BenchmarkTask;
  readonly fixture: RepositoryFixture;
  readonly agent: AgentRunResult;
  readonly outputs: VerificationOutputs;
  readonly now: number;
  /** Active verification node; defaults to the task's verification. */
  readonly active?: Verification;
}

/** The verification being graded: explicit branch or the task default. */
function verificationOf(context: GradeContext): Verification {
  return context.active ?? context.task.verification;
}

export interface Grader {
  readonly name: string;
  readonly kind: string;
  grade(context: GradeContext): GraderResult;
}

function outcome(
  kind: string,
  passed: boolean,
  score: number,
  reason: string,
  evidence: readonly string[],
): GraderResult {
  return { kind, passed, score, reason, evidence, durationMs: 0 };
}

function missing(kind: string): GraderResult {
  return outcome(kind, false, 0, `'${kind}' verification not configured`, []);
}

export function isVerificationKind(
  verification: Verification,
  kind: string,
): boolean {
  return verification.kind === kind;
}

/* ------------------------------------------------------------------ *
 * TestGrader                                                          *
 * ------------------------------------------------------------------ */

export class TestGrader implements Grader {
  readonly name = "test";
  readonly kind = "tests";

  grade(context: GradeContext): GraderResult {
    const verification = verificationOf(context);
    if (verification.kind !== "tests") return missing("tests");
    const summary = context.outputs.testSummary;
    if (!summary) {
      return outcome("tests", false, 0, "no test results were produced", []);
    }
    const expected = [...verification.mustPass];
    const expectedPassed = expected.filter(
      (name) => summary.byName[name] === true,
    );
    const expectedFailed = expected.filter(
      (name) => summary.byName[name] === false,
    );
    const missingTests = expected.filter(
      (name) => summary.byName[name] === undefined,
    );
    const unexpectedFailed = summary.failureNames.filter(
      (name) => !expected.includes(name),
    );
    const passed =
      expected.length > 0
        ? expectedFailed.length === 0 &&
          missingTests.length === 0 &&
          unexpectedFailed.length === 0
        : summary.failed === 0;
    const score =
      expected.length > 0
        ? expectedPassed.length / expected.length
        : summary.total > 0
          ? summary.passed / summary.total
          : 0;
    const evidence = [
      ...expectedFailed.map((name) => `expected test failed: ${name}`),
      ...missingTests.map((name) => `expected test missing: ${name}`),
      ...unexpectedFailed.map((name) => `unexpected test failed: ${name}`),
    ];
    const reason =
      passed
        ? `${expectedPassed.length}/${expected.length} expected tests pass`
        : `${expectedFailed.length} expected failed, ${missingTests.length} missing, ${unexpectedFailed.length} unexpected`;
    return outcome("tests", passed, score, reason, evidence);
  }
}

/* ------------------------------------------------------------------ *
 * BuildGrader                                                         *
 * ------------------------------------------------------------------ */

export class BuildGrader implements Grader {
  readonly name = "build";
  readonly kind = "build";

  grade(context: GradeContext): GraderResult {
    const verification = verificationOf(context);
    if (verification.kind !== "build") return missing("build");
    const status = context.outputs.buildStatus;
    if (status === null) {
      return outcome(
        "build",
        false,
        0,
        `build '${verification.command}' was not run`,
        [],
      );
    }
    return outcome(
      "build",
      status,
      status ? 1 : 0,
      status
        ? `build '${verification.command}' passed`
        : `build '${verification.command}' failed`,
      [],
    );
  }
}

/* ------------------------------------------------------------------ *
 * FileGrader                                                          *
 * ------------------------------------------------------------------ */

export class FileGrader implements Grader {
  readonly name = "file";
  readonly kind = "files";

  grade(context: GradeContext): GraderResult {
    const verification = verificationOf(context);
    if (verification.kind !== "files") return missing("files");
    const present = new Set(context.outputs.presentFiles);
    const expectedPresent = verification.expected.filter((filePath) =>
      present.has(filePath),
    );
    const missingFiles = verification.expected.filter(
      (filePath) => !present.has(filePath),
    );
    const forbiddenPresent = (verification.forbidden ?? []).filter(
      (filePath) => present.has(filePath),
    );
    const passed = missingFiles.length === 0 && forbiddenPresent.length === 0;
    const score =
      verification.expected.length > 0
        ? expectedPresent.length / verification.expected.length
        : forbiddenPresent.length === 0
          ? 1
          : 0;
    const evidence = [
      ...missingFiles.map((filePath) => `expected file missing: ${filePath}`),
      ...forbiddenPresent.map(
        (filePath) => `forbidden file present: ${filePath}`,
      ),
    ];
    return outcome(
      "files",
      passed,
      score,
      `${expectedPresent.length}/${verification.expected.length} expected files present`,
      evidence,
    );
  }
}

/* ------------------------------------------------------------------ *
 * DiffGrader                                                          *
 * ------------------------------------------------------------------ */

export class DiffGrader implements Grader {
  readonly name = "diff";
  readonly kind = "diff";

  grade(context: GradeContext): GraderResult {
    const verification = verificationOf(context);
    if (verification.kind !== "diff") return missing("diff");
    const patch = context.outputs.patch;
    if (!patch) {
      return outcome("diff", false, 0, "no patch was produced", []);
    }
    const applied = applyPatch({ ...context.outputs.contents }, patch);
    const expectedPaths = [...verification.expectedPaths];
    const covered = expectedPaths.filter((filePath) =>
      patch.changes.some((change) => change.path === filePath),
    );
    const missingPaths = expectedPaths.filter(
      (filePath) =>
        !patch.changes.some((change) => change.path === filePath),
    );
    const forbidden =
      (verification.forbiddenPaths ?? []).filter((filePath) =>
        patch.changes.some((change) => change.path === filePath),
      );
    const passed =
      applied.applied &&
      missingPaths.length === 0 &&
      forbidden.length === 0;
    const score =
      expectedPaths.length > 0
        ? (covered.length - forbidden.length) / expectedPaths.length
        : applied.applied
          ? 1
          : 0;
    const evidence = [
      ...applied.conflicts.map((filePath) => `patch conflict: ${filePath}`),
      ...missingPaths.map((filePath) => `expected path missing: ${filePath}`),
      ...forbidden.map((filePath) => `forbidden path touched: ${filePath}`),
    ];
    const reason = passed
      ? `patch applies cleanly covering ${covered.length}/${expectedPaths.length} expected paths`
      : applied.applied
        ? "patch applies but misses expected paths"
        : `patch conflicts on ${applied.conflicts.length} path(s)`;
    return outcome("diff", passed, score, reason, evidence);
  }
}

/* ------------------------------------------------------------------ *
 * CommandGrader                                                       *
 * ------------------------------------------------------------------ */

export class CommandGrader implements Grader {
  readonly name = "command";
  readonly kind = "command";

  grade(context: GradeContext): GraderResult {
    const verification = verificationOf(context);
    if (verification.kind !== "command") return missing("command");
    const result = context.outputs.commandResults[verification.command];
    if (!result) {
      return outcome(
        "command",
        false,
        0,
        `command '${verification.command}' was not run`,
        [],
      );
    }
    const passed = result.exitCode === verification.expectExitCode;
    return outcome(
      "command",
      passed,
      passed ? 1 : 0,
      passed
        ? `command '${verification.command}' exited ${result.exitCode}`
        : `command '${verification.command}' expected ${verification.expectExitCode}, exited ${result.exitCode}`,
      [],
    );
  }
}

/* ------------------------------------------------------------------ *
 * CompositeGrader                                                     *
 * ------------------------------------------------------------------ */

export class CompositeGrader implements Grader {
  readonly name = "composite";
  readonly kind = "composite";

  grade(context: GradeContext): GraderResult {
    const verification = verificationOf(context);
    if (verification.kind !== "composite") return missing("composite");
    const allResults = (verification.all ?? []).map((branch) =>
      gradeVerification(branch, { ...context, active: branch }),
    );
    const anyResults = (verification.any ?? []).map((branch) =>
      gradeVerification(branch, { ...context, active: branch }),
    );
    const results = [...allResults, ...anyResults];
    const allPassed = allResults.every((result) => result.passed);
    const anyPassed = anyResults.length === 0 || anyResults.some((result) => result.passed);
    const branchless = results.length === 0;
    const passed =
      !branchless &&
      (verification.all === undefined || allPassed) &&
      (verification.any === undefined || anyPassed);
    const score =
      results.length === 0
        ? 0
        : results.reduce((sum, result) => sum + result.score, 0) /
          results.length;
    const failedBranches = results
      .filter((result) => !result.passed)
      .map((result) => result.kind);
    const reason = branchless
      ? "composite has no branches"
      : passed
        ? `composite passed (${results.length} branch(es))`
        : `composite failed on: ${failedBranches.join(", ") || "no branches"}`;
    const evidence = results.flatMap((result) => result.evidence);
    return outcome("composite", passed, score, reason, evidence);
  }
}

/* ------------------------------------------------------------------ *
 * Dispatch                                                            *
 * ------------------------------------------------------------------ */

/** Grade any verification node structurally. Deterministic. */
export function gradeVerification(
  verification: Verification,
  context: GradeContext,
): GraderResult {
  switch (verification.kind) {
    case "tests":
      return new TestGrader().grade(context);
    case "build":
      return new BuildGrader().grade(context);
    case "files":
      return new FileGrader().grade(context);
    case "diff":
      return new DiffGrader().grade(context);
    case "command":
      return new CommandGrader().grade(context);
    case "composite":
      return new CompositeGrader().grade(context);
  }
}

/** Read-only access to the task's AgentRunResult in grade context. */
export function agentOf(context: GradeContext): AgentRunResult {
  return context.agent;
}