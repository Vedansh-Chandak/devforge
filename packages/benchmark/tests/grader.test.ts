import { describe, expect, it } from "vitest";
import {
  BuildGrader,
  CommandGrader,
  CompositeGrader,
  DiffGrader,
  FileGrader,
  gradeVerification,
  TestGrader,
  type GradeContext,
} from "../src/grader.js";
import type {
  AgentRunResult,
  CommandResult,
  VerificationOutputs,
} from "../src/types.js";
import { makeTask } from "./helpers.js";

function agent(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    status: "success",
    plan: { summary: "s", steps: [], durationMs: 0 },
    steps: [],
    filesWritten: {},
    telemetry: {},
    ...overrides,
  };
}

function outputs(overrides: Partial<VerificationOutputs> = {}): VerificationOutputs {
  return {
    commandResults: {},
    testSummary: null,
    buildStatus: null,
    presentFiles: [],
    contents: {},
    patch: null,
    ...overrides,
  };
}

function context(overrides: Partial<GradeContext> = {}): GradeContext {
  return {
    task: makeTask("t1"),
    fixture: {} as never,
    agent: agent(),
    outputs: outputs(),
    now: 0,
    ...overrides,
  };
}

function summary(passed: string[], failed: string[] = []) {
  const byName: Record<string, boolean> = {};
  const order: string[] = [];
  for (const name of passed) {
    if (!(name in byName)) order.push(name);
    byName[name] = true;
  }
  for (const name of failed) {
    if (!(name in byName)) order.push(name);
    byName[name] = false;
  }
  return {
    total: order.length,
    passed: passed.length,
    failed: failed.length,
    byName,
    failureNames: failed,
  };
}

function runResult(command: string, exitCode: number): CommandResult {
  return { command, exitCode, stdout: "", stderr: "", durationMs: 0 };
}

describe("TestGrader", () => {
  const testsTask = makeTask("t1", { kind: "tests", mustPass: ["a.js", "b.js"] });

  it("passes when every expected test passes", () => {
    const result = new TestGrader().grade(
      context({
        task: testsTask,
        outputs: outputs({ testSummary: summary(["a.js", "b.js"]) }),
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails when an expected test fails", () => {
    const result = new TestGrader().grade(
      context({
        task: testsTask,
        outputs: outputs({ testSummary: summary(["a.js"], ["b.js"]) }),
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.5);
    expect(result.evidence.join(" ")).toContain("expected test failed: b.js");
  });

  it("flags missing expected tests", () => {
    const result = new TestGrader().grade(
      context({
        task: testsTask,
        outputs: outputs({ testSummary: summary(["a.js"]) }),
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.evidence.join(" ")).toContain("missing: b.js");
  });

  it("fails on unexpected test failures", () => {
    const result = new TestGrader().grade(
      context({
        task: testsTask,
        outputs: outputs({ testSummary: summary(["a.js", "b.js", "extra.js"], ["extra.js"]) }),
      }),
    );
    expect(result.passed).toBe(false);
  });

  it("reports no test results when the summary is absent", () => {
    const result = new TestGrader().grade(context({ task: testsTask }));
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("no test results");
  });

  it("with no mustPass, passes on any clean suite", () => {
    const task = makeTask("t", { kind: "tests", mustPass: [] });
    const result = new TestGrader().grade(
      context({ task, outputs: outputs({ testSummary: summary(["x.js"]) }) }),
    );
    expect(result.passed).toBe(true);
  });

  it("returns a missing verdict for non-test tasks", () => {
    const task = makeTask("t", { kind: "files", expected: ["a"] });
    const result = new TestGrader().grade(context({ task }));
    expect(result.passed).toBe(false);
    expect(result.kind).toBe("tests");
  });

  it("is deterministic for identical inputs", () => {
    const base = context({ task: testsTask, outputs: outputs({ testSummary: summary(["a.js", "b.js"]) }) });
    const grader = new TestGrader();
    expect(grader.grade(base)).toEqual(grader.grade(base));
  });
});

describe("BuildGrader", () => {
  const buildTask = makeTask("t", { kind: "build", command: "npm run build" });

  it("passes when the build succeeds", () => {
    const result = new BuildGrader().grade(
      context({ task: buildTask, outputs: outputs({ buildStatus: true }) }),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails when the build fails", () => {
    const result = new BuildGrader().grade(
      context({ task: buildTask, outputs: outputs({ buildStatus: false }) }),
    );
    expect(result.passed).toBe(false);
  });

  it("fails when the build was never run", () => {
    const result = new BuildGrader().grade(context({ task: buildTask }));
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("was not run");
  });

  it("returns a missing verdict for non-build tasks", () => {
    const result = new BuildGrader().grade(context({ task: makeTask("t") }));
    expect(result.passed).toBe(false);
  });
});

describe("FileGrader", () => {
  const filesTask = makeTask("t", {
    kind: "files",
    expected: ["docs/a.md", "docs/b.md"],
    forbidden: ["secrets.md"],
  });

  it("passes when expected files exist and forbidden are absent", () => {
    const result = new FileGrader().grade(
      context({ task: filesTask, outputs: outputs({ presentFiles: ["docs/a.md", "docs/b.md"] }) }),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails on missing expected files", () => {
    const result = new FileGrader().grade(
      context({ task: filesTask, outputs: outputs({ presentFiles: ["docs/a.md"] }) }),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.5);
  });

  it("fails when a forbidden file is present", () => {
    const result = new FileGrader().grade(
      context({
        task: filesTask,
        outputs: outputs({ presentFiles: ["docs/a.md", "docs/b.md", "secrets.md"] }),
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.evidence.join(" ")).toContain("forbidden file present");
  });
});

describe("DiffGrader", () => {
  const diffTask = makeTask("t", {
    kind: "diff",
    expectedPaths: ["src/a.ts"],
    forbiddenPaths: ["test/a.test.ts"],
  });

  it("passes when the patch applies cleanly covering expected paths", () => {
    const result = new DiffGrader().grade(
      context({
        task: diffTask,
        outputs: outputs({
          contents: { "src/a.ts": "1" },
          patch: { changes: [{ path: "src/a.ts", before: "1", after: "2" }] },
        }),
      }),
    );
    expect(result.passed).toBe(true);
  });

  it("fails when the patch conflicts", () => {
    const result = new DiffGrader().grade(
      context({
        task: diffTask,
        outputs: outputs({
          contents: { "src/a.ts": "zzz" },
          patch: { changes: [{ path: "src/a.ts", before: "1", after: "2" }] },
        }),
      }),
    );
    expect(result.passed).toBe(false);
  });

  it("fails when expected paths are missed", () => {
    const result = new DiffGrader().grade(
      context({
        task: diffTask,
        outputs: outputs({
          contents: {},
          patch: { changes: [{ path: "other.ts", after: "2" }] },
        }),
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.evidence.join(" ")).toContain("expected path missing");
  });

  it("fails when forbidden paths are touched", () => {
    const result = new DiffGrader().grade(
      context({
        task: diffTask,
        outputs: outputs({
          contents: {},
          patch: { changes: [{ path: "src/a.ts", after: "2" }, { path: "test/a.test.ts", after: "2" }] },
        }),
      }),
    );
    expect(result.passed).toBe(false);
  });

  it("fails when no patch was produced", () => {
    const result = new DiffGrader().grade(context({ task: diffTask }));
    expect(result.passed).toBe(false);
  });
});

describe("CommandGrader", () => {
  const cmdTask = makeTask("t", { kind: "command", command: "lint", expectExitCode: 0 });

  it("passes on exit code match", () => {
    const result = new CommandGrader().grade(
      context({
        task: cmdTask,
        outputs: outputs({ commandResults: { lint: runResult("lint", 0) } }),
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails on exit code mismatch", () => {
    const result = new CommandGrader().grade(
      context({
        task: cmdTask,
        outputs: outputs({ commandResults: { lint: runResult("lint", 2) } }),
      }),
    );
    expect(result.passed).toBe(false);
  });

  it("fails when the command was never run", () => {
    const result = new CommandGrader().grade(context({ task: cmdTask }));
    expect(result.passed).toBe(false);
  });
});

describe("CompositeGrader", () => {
  it("passes when every all-branch passes", () => {
    const composite = makeTask("t", {
      kind: "composite",
      all: [
        { kind: "files", expected: ["README.md"] },
        { kind: "files", expected: ["LICENSE"] },
      ],
    });
    const result = new CompositeGrader().grade(
      context({ task: composite, outputs: outputs({ presentFiles: ["README.md", "LICENSE"] }) }),
    );
    expect(result.passed).toBe(true);
  });

  it("fails when any all-branch fails", () => {
    const composite = makeTask("t", {
      kind: "composite",
      all: [{ kind: "files", expected: ["README.md", "MISSING"] }],
    });
    const result = new CompositeGrader().grade(
      context({ task: composite, outputs: outputs({ presentFiles: ["README.md"] }) }),
    );
    expect(result.passed).toBe(false);
  });

  it("passes when at least one any-branch passes", () => {
    const composite = makeTask("t", {
      kind: "composite",
      any: [
        { kind: "files", expected: ["A"] },
        { kind: "files", expected: ["B"] },
      ],
    });
    const result = new CompositeGrader().grade(
      context({ task: composite, outputs: outputs({ presentFiles: ["B"] }) }),
    );
    expect(result.passed).toBe(true);
  });

  it("fails when no any-branch passes", () => {
    const composite = makeTask("t", {
      kind: "composite",
      any: [{ kind: "files", expected: ["A"] }],
    });
    const result = new CompositeGrader().grade(context({ task: composite }));
    expect(result.passed).toBe(false);
  });

  it("fails when the composite has no branches", () => {
    const composite = makeTask("t", { kind: "composite" });
    const result = new CompositeGrader().grade(context({ task: composite }));
    expect(result.passed).toBe(false);
  });

  it("supports mixed all and any semantics", () => {
    const composite = makeTask("t", {
      kind: "composite",
      all: [{ kind: "files", expected: ["A"] }],
      any: [{ kind: "files", expected: ["MISSING-ANY"] }],
    });
    const result = new CompositeGrader().grade(
      context({ task: composite, outputs: outputs({ presentFiles: ["A"] }) }),
    );
    expect(result.passed).toBe(false);
  });
});

describe("gradeVerification dispatch", () => {
  it("dispatches to the matching grader by kind", () => {
    const task = makeTask("t", { kind: "files", expected: ["a"] });
    const result = gradeVerification(
      { kind: "files", expected: ["a"] },
      context({ task, outputs: outputs({ presentFiles: ["a"] }) }),
    );
    expect(result.kind).toBe("files");
    expect(result.passed).toBe(true);
  });
});