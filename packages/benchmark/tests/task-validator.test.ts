import { describe, expect, it } from "vitest";
import {
  assertValidDataset,
  validateDataset,
  validateTask,
} from "../src/task-validator.js";
import { TaskValidationError } from "../src/errors.js";
import { createDataset } from "../src/dataset.js";
import type { Verification } from "../src/types.js";
import { makeDataset, makeTask } from "./helpers.js";

function issuesOf(taskResult: ReturnType<typeof validateTask>): string[] {
  return taskResult.issues.map((issue) => issue.code);
}

describe("validateTask — valid tasks", () => {
  it("accepts a well-formed task", () => {
    const result = validateTask(makeTask("t1"));
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("accepts every verification kind", () => {
    for (const verification of [
      { kind: "tests", mustPass: ["a"] },
      { kind: "build", command: "npm run build" },
      { kind: "files", expected: ["a"] },
      { kind: "diff", expectedPaths: ["a"] },
      { kind: "command", command: "x", expectExitCode: 0 },
      { kind: "composite", any: [{ kind: "files", expected: ["a"] }] },
    ] as Verification[]) {
      expect(validateTask(makeTask("t1", verification)).valid).toBe(true);
    }
  });
});

describe("validateTask — invalid fields", () => {
  it("flags an empty task id", () => {
    const result = validateTask({ ...makeTask("t1"), id: "" });
    expect(result.valid).toBe(false);
    expect(issuesOf(result)).toContain("task.id");
  });

  it("flags an empty title", () => {
    const result = validateTask({ ...makeTask("t1"), title: "  " });
    expect(issuesOf(result)).toContain("task.title");
  });

  it("flags a non-string description", () => {
    const result = validateTask({
      ...makeTask("t1"),
      description: 42 as unknown as string,
    });
    expect(issuesOf(result)).toContain("task.description");
  });

  it("flags an empty repository id", () => {
    const result = validateTask({
      ...makeTask("t1"),
      repository: { id: "" },
    });
    expect(issuesOf(result)).toContain("task.repository");
  });

  it("flags an empty baseRevision", () => {
    const result = validateTask({ ...makeTask("t1"), baseRevision: "" });
    expect(issuesOf(result)).toContain("task.baseRevision");
  });

  it("flags a non-array setup", () => {
    const result = validateTask({
      ...makeTask("t1"),
      setup: "run" as unknown as string[],
    });
    expect(issuesOf(result)).toContain("task.setup");
  });

  it("flags missing expectedBehavior.summary", () => {
    const result = validateTask({
      ...makeTask("t1"),
      expectedBehavior: { summary: "", criteria: [] },
    });
    expect(issuesOf(result)).toContain("task.expectedBehavior");
  });

  it("flags non-positive or non-finite timeoutMs", () => {
    for (const timeoutMs of [0, -1, Number.NaN, Infinity]) {
      const result = validateTask({ ...makeTask("t1"), timeoutMs });
      expect(issuesOf(result)).toContain("task.timeoutMs");
    }
  });

  it("flags non-array tags", () => {
    const result = validateTask({
      ...makeTask("t1"),
      tags: "x" as unknown as string[],
    });
    expect(issuesOf(result)).toContain("task.tags");
  });

  it("flags invalid difficulty", () => {
    const result = validateTask({
      ...makeTask("t1"),
      difficulty: "INSANE" as never,
    });
    expect(issuesOf(result)).toContain("task.difficulty");
  });

  it("flags invalid category", () => {
    const result = validateTask({
      ...makeTask("t1"),
      category: "NOPE" as never,
    });
    expect(issuesOf(result)).toContain("task.category");
  });

  it("flags an invalid task version", () => {
    const result = validateTask({ ...makeTask("t1"), version: 0 });
    expect(issuesOf(result)).toContain("task.version");
  });

  it("accepts a version of 1", () => {
    expect(validateTask({ ...makeTask("t1"), version: 1 }).valid).toBe(true);
  });
});

describe("validateTask — verification issues", () => {
  it("flags a missing verification", () => {
    const result = validateTask({
      ...makeTask("t1"),
      verification: undefined as unknown as Verification,
    });
    expect(issuesOf(result)).toContain("verification.required");
  });

  it("flags an unsupported verification kind", () => {
    const result = validateTask({
      ...makeTask("t1"),
      verification: { kind: "mystery" } as unknown as Verification,
    });
    expect(issuesOf(result)).toContain("verification.kind");
  });

  it("flags tests without mustPass array", () => {
    const result = validateTask({
      ...makeTask("t1"),
      verification: { kind: "tests", mustPass: "x" } as unknown as Verification,
    });
    expect(issuesOf(result)).toContain("verification.tests");
  });

  it("flags build without a command", () => {
    const result = validateTask({
      ...makeTask("t1"),
      verification: { kind: "build" } as unknown as Verification,
    });
    expect(issuesOf(result)).toContain("verification.build");
  });

  it("flags files without expected", () => {
    const result = validateTask({
      ...makeTask("t1"),
      verification: { kind: "files" } as unknown as Verification,
    });
    expect(issuesOf(result)).toContain("verification.files");
  });

  it("flags diff without expectedPaths", () => {
    const result = validateTask({
      ...makeTask("t1"),
      verification: { kind: "diff" } as unknown as Verification,
    });
    expect(issuesOf(result)).toContain("verification.diff");
  });

  it("flags command without expectExitCode", () => {
    const result = validateTask({
      ...makeTask("t1"),
      verification: { kind: "command", command: "x" } as unknown as Verification,
    });
    expect(issuesOf(result)).toContain("verification.command");
  });

  it("flags composite without all/any", () => {
    const result = validateTask({
      ...makeTask("t1"),
      verification: { kind: "composite" } as unknown as Verification,
    });
    expect(issuesOf(result)).toContain("verification.composite");
  });

  it("flags nested invalid composite branches", () => {
    const result = validateTask({
      ...makeTask("t1"),
      verification: {
        kind: "composite",
        all: [{ kind: "build" }],
      } as unknown as Verification,
    });
    expect(result.valid).toBe(false);
  });

  it("sorts issues deterministically by path then code", () => {
    const result = validateTask({
      ...makeTask("t1"),
      id: "",
      baseRevision: "",
      tags: "x" as unknown as string[],
    });
    const codes = issuesOf(result);
    expect(codes).toEqual([...codes].sort());
  });
});

describe("validateDataset", () => {
  it("accepts a valid dataset", () => {
    const dataset = makeDataset("d", [makeTask("a")]);
    expect(validateDataset(dataset).valid).toBe(true);
  });

  it("flags duplicate task ids", () => {
    const dataset = makeDataset("d", [makeTask("a"), makeTask("a")]);
    const issues = validateDataset(dataset).issues;
    expect(issues.some((issue) => issue.code === "task.duplicate")).toBe(true);
  });

  it("flags an empty tasks list", () => {
    const dataset = createDataset({ datasetName: "d", tasks: [] });
    expect(validateDataset(dataset).valid).toBe(false);
  });

  it("flags an empty datasetName", () => {
    const dataset = makeDataset(" ", [makeTask("a")]);
    expect(validateDataset(dataset).valid).toBe(false);
  });

  it("prefixes task issues with the task id", () => {
    const bad = makeTask("b", { kind: "build" } as unknown as Verification);
    const dataset = makeDataset("d", [bad]);
    const issues = validateDataset(dataset).issues;
    expect(issues.some((issue) => issue.path.startsWith("tasks.b."))).toBe(true);
  });

  it("flags missing repository ids", () => {
    const dataset = makeDataset(
      "d",
      [makeTask("a")],
      [{ id: "", description: "x", isGit: false, files: {} }],
    );
    const issues = validateDataset(dataset).issues;
    expect(issues.some((issue) => issue.code === "repository.id")).toBe(true);
  });
});

describe("assertValidDataset", () => {
  it("throws TaskValidationError for invalid datasets", () => {
    const dataset = makeDataset("d", [
      makeTask("a", { kind: "build" } as unknown as Verification),
    ]);
    expect(() => assertValidDataset(dataset)).toThrow(TaskValidationError);
  });

  it("throws listing every issue in the message", () => {
    const dataset = makeDataset("d", [
      makeTask("a", { kind: "build" } as unknown as Verification),
      { ...makeTask("b"), id: "" },
    ]);
    expect(() => assertValidDataset(dataset)).toThrow(/invalid/);
  });

  it("does not throw for valid datasets", () => {
    expect(() => assertValidDataset(makeDataset("d", [makeTask("a")]))).not.toThrow();
  });
});