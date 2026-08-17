import { describe, expect, it } from "vitest";
import { compareRuns, compareTask } from "../src/comparison.js";
import type { TaskResult } from "../src/types.js";
import { makeResult, makeTaskResult } from "./helpers.js";

function pass(taskId: string, extra: Partial<TaskResult> = {}): TaskResult {
  return makeTaskResult(taskId, { status: "passed" as never, ...extra });
}

function fail(taskId: string, extra: Partial<TaskResult> = {}): TaskResult {
  return makeTaskResult(taskId, { status: "verification_failed" as never, score: 0, ...extra });
}

describe("compareTask", () => {
  it("returns null when either side is missing", () => {
    expect(compareTask(undefined, pass("a"))).toBeNull();
    expect(compareTask(pass("a"), undefined)).toBeNull();
  });

  it("marks an improvement when a task starts passing", () => {
    const delta = compareTask(fail("a"), pass("a"))!;
    expect(delta.scoreDelta).toBe(1);
    expect(delta.beforeStatus).toBe("verification_failed");
    expect(delta.afterStatus).toBe("passed");
  });

  it("marks a regression when a task stops passing", () => {
    const delta = compareTask(pass("a"), fail("a"))!;
    expect(delta.scoreDelta).toBe(-1);
  });

  it("marks a score improvement between two passing runs", () => {
    const delta = compareTask(pass("a", { score: 0.5 }), pass("a", { score: 1 }))!;
    expect(delta.scoreDelta).toBe(0.5);
  });

  it("marks a score regression between two failing runs", () => {
    const delta = compareTask(fail("a", { score: 0.3 }), fail("a", { score: 0.1 }))!;
    expect(delta.scoreDelta).toBe(-0.2);
  });

  it("leaves the delta zero for unchanged runs", () => {
    const delta = compareTask(pass("a"), pass("a"))!;
    expect(delta.scoreDelta).toBe(0);
    expect(delta.latencyDeltaMs).toBe(0);
    expect(delta.attemptsDelta).toBe(0);
    expect(delta.repairDelta).toBe(0);
  });

  it("records latency and attempt deltas for changed runs", () => {
    const delta = compareTask(
      fail("a", { durationMs: 100, attempts: 1 }),
      pass("a", { durationMs: 300, attempts: 2 }),
    )!;
    expect(delta.latencyDeltaMs).toBe(200);
    expect(delta.attemptsDelta).toBe(1);
  });
});

describe("compareRuns", () => {
  function runA() {
    return makeResult([
      pass("a"),
      fail("b"),
      pass("c"),
    ]);
  }

  function runB() {
    return makeResult([
      fail("a"),
      pass("b"),
      pass("c"),
    ]);
  }

  it("counts improved, regressed, and unchanged tasks", () => {
    const comparison = compareRuns(runA(), runB());
    expect(comparison.improved).toBe(1); // b
    expect(comparison.regressed).toBe(1); // a
    expect(comparison.unchanged).toBe(1); // c
  });

  it("orders tasks by id", () => {
    const comparison = compareRuns(runA(), runB());
    expect(comparison.tasks.map((task) => task.taskId)).toEqual(["a", "b", "c"]);
  });

  it("records runs by id", () => {
    const comparison = compareRuns(runA(), runB());
    expect(comparison.runAId).toBe(runA().resultId);
    expect(comparison.runBId).toBe(runB().resultId);
  });

  it("computes success rate and verification deltas (b minus a)", () => {
    const comparison = compareRuns(runA(), runB());
    expect(comparison.successRateDelta).toBeCloseTo(0);
    expect(comparison.verificationDelta).toBeCloseTo(0);
  });

  it("computes aggregate latency delta", () => {
    const before = makeResult([pass("a", { durationMs: 100 })]);
    const after = makeResult([pass("a", { durationMs: 200 })]);
    const comparison = compareRuns(before, after);
    expect(comparison.latencyDeltaMs).toBe(100);
  });

  it("computes attempt and repair deltas", () => {
    const before = makeResult([fail("a", { attempts: 1, repairAttempts: 0 })]);
    const after = makeResult([pass("a", { attempts: 2, repairAttempts: 1 })]);
    const comparison = compareRuns(before, after);
    expect(comparison.attemptDelta).toBe(1);
    expect(comparison.repairDelta).toBe(1);
  });

  it("reports memory impact deltas", () => {
    const before = makeResult([
      pass("a", { telemetry: { memoryRetrievalCount: 2 } as never }),
      pass("b", { telemetry: { memoryRetrievalCount: 4 } as never }),
    ]);
    const after = makeResult([
      pass("a", { telemetry: { memoryRetrievalCount: 5 } as never }),
      pass("b", { telemetry: { memoryRetrievalCount: 9 } as never }),
    ]);
    const comparison = compareRuns(before, after);
    expect(comparison.memoryImpact.retrievalDelta).toBe(8);
  });

  it("leaves memory impact null when unmeasured", () => {
    const comparison = compareRuns(runA(), runB());
    expect(comparison.memoryImpact.retrievalDelta).toBeNull();
    expect(comparison.memoryImpact.hitRateDelta).toBeNull();
  });

  it("is deterministic across identical inputs", () => {
    expect(compareRuns(runA(), runB())).toEqual(compareRuns(runA(), runB()));
  });

  it("handles runs with disjoint task sets", () => {
    const left = makeResult([pass("x")]);
    const right = makeResult([pass("y")]);
    const comparison = compareRuns(left, right);
    expect(comparison.tasks).toEqual([]);
    expect(comparison.improved).toBe(0);
    expect(comparison.regressed).toBe(0);
    expect(comparison.unchanged).toBe(0);
  });
});