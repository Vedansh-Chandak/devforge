import { describe, expect, it } from "vitest";
import {
  structuredReport,
  summarizeResult,
  summarizeSuite,
  toComparisonReport,
  toFailureReport,
  toHumanReport,
  toJsonReport,
  toSuiteSummary,
} from "../src/reports.js";
import { compareRuns } from "../src/comparison.js";
import type { SuiteResult } from "../src/types.js";
import { makeResult, makeTaskResult } from "./helpers.js";

function mixedResult() {
  return makeResult([
    makeTaskResult("a"),
    makeTaskResult("b", { status: "verification_failed" as never, score: 0 }),
    makeTaskResult("c", { status: "timeout" as never, score: 0 }),
  ]);
}

describe("summarizeResult", () => {
  it("reflects counts and rates", () => {
    const summary = summarizeResult(mixedResult());
    expect(summary.counts.total).toBe(3);
    expect(summary.counts.passed).toBe(1);
    expect(summary.successRate).toBeCloseTo(1 / 3, 5);
    expect(summary.verificationRate).toBeCloseTo(1 / 3, 5);
  });

  it("keeps run identity fields", () => {
    const summary = summarizeResult(mixedResult());
    expect(summary.name).toBe("test-run");
    expect(summary.datasetName).toBe("test-dataset");
    expect(summary.benchmarkVersion).toBe("1.0.0");
  });
});

describe("structuredReport", () => {
  it("bundles summary, metrics, score, and tasks", () => {
    const report = structuredReport(mixedResult());
    expect(report.summary.counts.total).toBe(3);
    expect(report.metrics.total).toBe(3);
    expect(typeof report.score.total).toBe("number");
    expect(report.tasks[0]!.taskId).toBe("a");
  });

  it("caps per-task errors in structured output", () => {
    const withErrors = makeResult([
      makeTaskResult("a", {
        status: "error" as never,
        score: 0,
        errors: Array.from({ length: 10 }, (_, index) => `error ${index}`),
      }),
    ]);
    const report = structuredReport(withErrors);
    expect(report.tasks[0]!.errors.length).toBe(5);
  });
});

describe("toJsonReport", () => {
  it("is parseable JSON", () => {
    const parsed = JSON.parse(toJsonReport(mixedResult()));
    expect(parsed.summary.counts.total).toBe(3);
  });

  it("is deterministic", () => {
    expect(toJsonReport(mixedResult())).toBe(toJsonReport(mixedResult()));
  });

  it("includes the score and metrics blocks", () => {
    const parsed = JSON.parse(toJsonReport(mixedResult()));
    expect(parsed.score).toBeDefined();
    expect(parsed.metrics).toBeDefined();
  });
});

describe("toHumanReport", () => {
  it("lists task statuses deterministically", () => {
    const text = toHumanReport(mixedResult());
    expect(text).toContain("Benchmark: test-run");
    expect(text).toContain("[PASSED] a");
    expect(text).toContain("[VERIFICATION_FAILED] b");
    expect(text).toContain("[TIMEOUT] c");
  });

  it("reports failure counts", () => {
    const text = toHumanReport(mixedResult());
    expect(text).toContain("Failed: 1");
    expect(text).toContain("Timeout: 1");
  });

  it("omits unknown telemetry lines", () => {
    const text = toHumanReport(mixedResult());
    expect(text).not.toContain("Token Usage:");
  });

  it("includes telemetry lines when measured", () => {
    const withTokens = makeResult([
      makeTaskResult("a", { telemetry: { tokenUsage: 7, modelCalls: 3, toolCalls: 2 } as never }),
    ]);
    const text = toHumanReport(withTokens);
    expect(text).toContain("Token Usage: 7");
    expect(text).toContain("Model Calls: 3");
    expect(text).toContain("Tool Calls: 2");
  });
});

describe("SuiteResult helpers", () => {
  const suite: SuiteResult = {
    suiteId: "suite-a-b",
    name: "suite-a-b",
    taskIds: ["a", "b"],
    result: mixedResult(),
  };

  it("summarizeSuite derives a summary entry", () => {
    expect(summarizeSuite(suite).suiteId).toBe("suite-a-b");
    expect(summarizeSuite(suite).tasks).toBe(3);
  });

  it("toSuiteSummary lists task ids", () => {
    const text = toSuiteSummary(suite);
    expect(text).toContain("Suite: suite-a-b");
    expect(text).toContain("- a");
    expect(text).toContain("- b");
  });
});

describe("toComparisonReport", () => {
  it("prints aggregate and per-task deltas", () => {
    const before = makeResult([makeTaskResult("a")]);
    const after = makeResult([makeTaskResult("a", { status: "error" as never, score: 0 })]);
    const text = toComparisonReport(compareRuns(before, after), "A", "B");
    expect(text).toContain("Comparison: A vs B");
    expect(text).toContain("Tasks Regressed: 1");
    expect(text).toContain("a: passed -> error");
  });
});

describe("toFailureReport", () => {
  it("only reports non-passed tasks", () => {
    const text = toFailureReport(mixedResult());
    expect(text).not.toContain("[PASSED]");
    expect(text).toContain("[VERIFICATION_FAILED] b");
    expect(text).toContain("[TIMEOUT] c");
  });

  it("includes grader reasons and errors", () => {
    const failing = makeResult([
      makeTaskResult("x", {
        status: "error" as never,
        score: 0,
        grader: { kind: "error", passed: false, score: 0, reason: "adapter crashed", evidence: ["boom"] },
        errors: ["stack trace"],
      }),
    ]);
    const text = toFailureReport(failing);
    expect(text).toContain("adapter crashed");
    expect(text).toContain("stack trace");
    expect(text).toContain("- boom");
  });

  it("labels the report with a zero when everything passes", () => {
    const text = toFailureReport(makeResult([makeTaskResult("a")]));
    expect(text).toContain("(0 non-passed)");
  });
});