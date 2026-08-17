import { describe, expect, it } from "vitest";
import {
  computeMetrics,
  mean,
  median,
  roundTo,
  stats,
} from "../src/metrics.js";
import type { TaskResult } from "../src/types.js";
import { makeTaskResult } from "./helpers.js";

describe("median", () => {
  it("returns null for empty input", () => {
    expect(median([])).toBeNull();
  });

  it("returns the middle element for odd lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle elements for even lengths", () => {
    expect(median([1, 3, 1, 3])).toBe(2);
  });

  it("is order-independent", () => {
    expect(median([5, 5, 1, 10])).toBe(median([10, 1, 5, 5]));
  });
});

describe("mean", () => {
  it("returns null for empty input", () => {
    expect(mean([])).toBeNull();
  });

  it("averages values", () => {
    expect(mean([2, 4, 6])).toBe(4);
  });
});

describe("stats", () => {
  it("returns null for empty input", () => {
    expect(stats([])).toBeNull();
  });

  it("computes count, mean, median, min, max", () => {
    expect(stats([1, 2, 3, 10])).toEqual({ count: 4, mean: 4, median: 2.5, min: 1, max: 10 });
  });
});

describe("roundTo", () => {
  it("rounds to the configured digits", () => {
    expect(roundTo(1 / 6)).toBe(0.166667);
    expect(roundTo(1 / 3, 2)).toBe(0.33);
  });

  it("rounds to whole numbers with zero digits", () => {
    expect(roundTo(12.4, 0)).toBe(12);
    expect(roundTo(12.6, 0)).toBe(13);
  });
});

describe("computeMetrics", () => {
  function base() {
    return makeTaskResult("t", {
      category: "FEATURE" as never,
      signals: { testsPass: null, buildPasses: null, regressionDetected: null } as never,
      telemetry: { attemptedRepairs: 0 },
    });
  }

  it("computes the task success rate", () => {
    const tasks = [
      makeTaskResult("a", { status: "passed" as never }),
      makeTaskResult("b", { status: "failed" as never }),
      makeTaskResult("c", { status: "verification_failed" as never }),
      makeTaskResult("d", { status: "timeout" as never }),
      makeTaskResult("e", { status: "cancelled" as never }),
      makeTaskResult("f", { status: "error" as never }),
    ];
    const metrics = computeMetrics(tasks);
    expect(metrics.total).toBe(6);
    expect(metrics.taskSuccessRate).toBe(roundTo(1 / 6));
    expect(metrics.timeoutRate).toBe(roundTo(1 / 6));
    expect(metrics.cancellationRate).toBe(roundTo(1 / 6));
  });

  it("computes test and build pass rates from reported signals", () => {
    const tasks = [
      makeTaskResult("ok", { signals: { testsPass: true, buildPasses: true } as never }),
      makeTaskResult("bad", { status: "verification_failed" as never, signals: { testsPass: false, buildPasses: false } as never }),
    ];
    const metrics = computeMetrics(tasks);
    expect(metrics.testPassRate).toBe(0.5);
    expect(metrics.buildSuccessRate).toBe(0.5);
    expect(metrics.verificationSuccessRate).toBe(0.5);
  });

  it("leaves rates null when no tasks recorded them", () => {
    const metrics = computeMetrics([base()]);
    expect(metrics.testPassRate).toBeNull();
    expect(metrics.buildSuccessRate).toBeNull();
    expect(metrics.repairSuccessRate).toBeNull();
    expect(metrics.regressionRate).toBeNull();
  });

  it("computes repair success rate over repaired tasks only", () => {
    const made = makeTaskResult("r", {
      repairAttempts: 2,
      status: "passed" as never,
    });
    const metrics = computeMetrics([
      made,
      makeTaskResult("u"),
      makeTaskResult("x", { repairAttempts: 1, status: "error" as never }),
    ]);
    expect(metrics.repairSuccessRate).toBe(0.5);
  });

  it("computes regression rate from regression signals", () => {
    const tasks = [
      makeTaskResult("a", {
        status: "passed" as never,
        signals: { regressionDetected: false } as never,
      }),
      makeTaskResult("b", {
        status: "verification_failed" as never,
        signals: { regressionDetected: true } as never,
      }),
    ];
    const metrics = computeMetrics(tasks);
    expect(metrics.regressionRate).toBe(0.5);
  });

  it("averages attempts and repair attempts", () => {
    const metrics = computeMetrics([
      makeTaskResult("a", { attempts: 2, repairAttempts: 1 }),
      makeTaskResult("b", { attempts: 4, repairAttempts: 3 }),
    ]);
    expect(metrics.averageAttempts).toBe(3);
    expect(metrics.averageRepairAttempts).toBe(2);
  });

  it("computes execution time statistics", () => {
    const metrics = computeMetrics([
      makeTaskResult("a", { durationMs: 100 }),
      makeTaskResult("b", { durationMs: 300 }),
    ]);
    expect(metrics.averageExecutionTimeMs).toBe(200);
    expect(metrics.medianExecutionTimeMs).toBe(200);
  });

  it("computes average patch size only when patches exist", () => {
    const metrics = computeMetrics([
      makeTaskResult("a", { patchStats: { filesChanged: 2, additions: 3, deletions: 1 } }),
      makeTaskResult("b", { patchStats: null }),
    ]);
    expect(metrics.averagePatchSize).toBe(4);
    expect(metrics.averageFilesChanged).toBe(2);
  });

  it("leaves patch metrics null without any patches", () => {
    const metrics = computeMetrics([makeTaskResult("a", { patchStats: null })]);
    expect(metrics.averagePatchSize).toBeNull();
    expect(metrics.averageFilesChanged).toBeNull();
  });

  it("sums telemetry only when every task reported it", () => {
    const metrics = computeMetrics([
      makeTaskResult("a", { telemetry: { tokenUsage: 10, modelCalls: 1 } as never }),
      makeTaskResult("b", { telemetry: { tokenUsage: 20, modelCalls: 2 } as never }),
    ]);
    expect(metrics.tokenUsage).toBe(30);
    expect(metrics.modelCalls).toBe(3);
    expect(metrics.toolCalls).toBeNull();
  });

  it("returns null for telemetry when any task is missing it", () => {
    const metrics = computeMetrics([
      makeTaskResult("a", { telemetry: { tokenUsage: 10 } as never }),
      makeTaskResult("b", {}),
    ]);
    expect(metrics.tokenUsage).toBeNull();
  });

  it("averages reported memory hit rates", () => {
    const metrics = computeMetrics([
      makeTaskResult("a", { telemetry: { memoryHitRate: 0.5 } as never }),
      makeTaskResult("b", { telemetry: { memoryHitRate: 0.7 } as never }),
      makeTaskResult("c", {}),
    ]);
    expect(metrics.memoryHitRate).toBe(0.6);
  });

  it("sums memory retrieval count when all report it", () => {
    const metrics = computeMetrics([
      makeTaskResult("a", { telemetry: { memoryRetrievalCount: 4 } as never }),
      makeTaskResult("b", { telemetry: { memoryRetrievalCount: 6 } as never }),
    ]);
    expect(metrics.memoryRetrievalCount).toBe(10);
  });

  it("gates multi-agent success rate on the option", () => {
    const tasks = [makeTaskResult("a"), makeTaskResult("b", { status: "error" as never })];
    expect(computeMetrics(tasks).multiAgentTaskSuccessRate).toBeNull();
    expect(computeMetrics(tasks, { multiAgent: true }).multiAgentTaskSuccessRate).toBe(0.5);
  });

  it("breaks down per-category counts alphabetically", () => {
    const tasks = [
      makeTaskResult("a", { category: "FEATURE" as never }),
      makeTaskResult("b", { status: "error" as never, category: "FEATURE" as never }),
      makeTaskResult("c", { status: "error" as never, category: "BUG_FIX" as never }),
      makeTaskResult("d", { status: "passed" as never, category: "BUG_FIX" as never }),
    ];
    const metrics = computeMetrics(tasks);
    expect(metrics.perCategory).toEqual({
      BUG_FIX: { total: 2, passed: 1 },
      FEATURE: { total: 2, passed: 1 },
    });
  });

  it("returns zeros for an empty run", () => {
    const metrics = computeMetrics([]);
    expect(metrics.total).toBe(0);
    expect(metrics.taskSuccessRate).toBeNull();
    expect(metrics.averageAttempts).toBe(0);
  });
});