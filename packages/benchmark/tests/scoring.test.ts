import { describe, expect, it } from "vitest";
import {
  rankBenchmarks,
  scoreBenchmark,
  scoreTaskPass,
} from "../src/scoring.js";
import { computeMetrics } from "../src/metrics.js";
import { makeResult, makeTaskResult } from "./helpers.js";

function fullMetrics() {
  return computeMetrics([
    makeTaskResult("a", { status: "passed" as never, durationMs: 0 }),
    makeTaskResult("b", { status: "passed" as never, durationMs: 0 }),
  ]);
}

function halfMetrics() {
  return computeMetrics([
    makeTaskResult("a", { status: "passed" as never }),
    makeTaskResult("b", { status: "verification_failed" as never }),
  ]);
}

describe("scoreBenchmark", () => {
  it("scores a perfect run as 1", () => {
    const score = scoreBenchmark(fullMetrics());
    expect(score.total).toBe(1);
  });

  it("renormalizes over measured components only", () => {
    const metrics = computeMetrics([
      makeTaskResult("a", { status: "passed" as never }),
      makeTaskResult("b", { status: "verification_failed" as never }),
    ]);
    const score = scoreBenchmark(metrics);
    expect(score.total).toBeGreaterThan(0);
    expect(score.total).toBeLessThan(1);
  });

  it("weights latency at 0.5 by default", () => {
    const score = scoreBenchmark(fullMetrics());
    expect(score.weights.latencyRate).toBe(0.5);
  });

  it("applies custom weights", () => {
    const score = scoreBenchmark(fullMetrics(), { successRate: 0.7, testPassRate: 0.3 });
    expect(score.weights.successRate).toBe(0.7);
    expect(score.weights.testPassRate).toBe(0.3);
  });

  it("is clamped to [0, 1]", () => {
    const fast = computeMetrics([
      makeTaskResult("a", { status: "passed" as never, durationMs: 0 }),
    ]);
    const score = scoreBenchmark(fast);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(1);
  });

  it("scores zero when nothing measured", () => {
    const metrics = computeMetrics([]);
    expect(scoreBenchmark(metrics).total).toBe(0);
  });

  it("exposes per-component and applied weights deterministically", () => {
    const score = scoreBenchmark(halfMetrics());
    expect(score.components.successRate).toBe(0.5);
    expect(score.components.latencyRate).toBe(1);
    expect(Object.keys(score.weights).sort()).toEqual(
      Object.keys(score.weights).sort(),
    );
  });

  it("is deterministic for identical metrics", () => {
    expect(scoreBenchmark(fullMetrics())).toEqual(scoreBenchmark(fullMetrics()));
  });

  it("improves when a run gets faster", () => {
    const slow = scoreBenchmark(computeMetrics([
      makeTaskResult("a", { status: "passed" as never, durationMs: 500_000 }),
      makeTaskResult("b", { status: "passed" as never, durationMs: 500_000 }),
    ]));
    const fast = scoreBenchmark(fullMetrics());
    expect(fast.total).toBeGreaterThan(slow.total);
  });
});

describe("scoreTaskPass", () => {
  it("returns 1 for a pass", () => {
    expect(scoreTaskPass(true)).toBe(1);
  });

  it("returns 0 otherwise", () => {
    expect(scoreTaskPass(false)).toBe(0);
  });
});

describe("rankBenchmarks", () => {
  const high = makeResult([makeTaskResult("a")], { resultId: "high" });
  const low = makeResult([makeTaskResult("b", { status: "error" as never })], { resultId: "low" });

  it("sorts by descending score", () => {
    const ranked = rankBenchmarks([low, high], (run) => run.counts.passed);
    expect(ranked.map((run) => run.resultId)).toEqual(["high", "low"]);
  });

  it("tie-breaks by result id ascending", () => {
    const a = makeResult([makeTaskResult("x")], { resultId: "a" });
    const b = makeResult([makeTaskResult("x")], { resultId: "b" });
    expect(rankBenchmarks([b, a], () => 1).map((run) => run.resultId)).toEqual(["a", "b"]);
  });

  it("does not mutate the input", () => {
    const input = [low, high];
    rankBenchmarks(input, () => 0);
    expect(input.map((run) => run.resultId)).toEqual(["low", "high"]);
  });
});