import { describe, expect, it } from "vitest";
import { evaluateRegression } from "../src/regression.js";
import type { RegressionThresholds } from "../src/types.js";
import { makeResult, makeTaskResult } from "./helpers.js";

function allPassRun() {
  return makeResult([
    makeTaskResult("a", { durationMs: 100 }),
    makeTaskResult("b", { durationMs: 100 }),
    makeTaskResult("c", { durationMs: 100 }),
  ]);
}

function mixedRun() {
  return makeResult([
    makeTaskResult("a", { status: "error" as never, durationMs: 300 }),
    makeTaskResult("b", { status: "verification_failed" as never, durationMs: 300 }),
    makeTaskResult("c", { durationMs: 100 }),
  ]);
}

const noThresholds: RegressionThresholds = {};

describe("evaluateRegression", () => {
  it("passes when no thresholds are configured", () => {
    const result = evaluateRegression(allPassRun(), allPassRun(), noThresholds);
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("passes when thresholds are met", () => {
    const result = evaluateRegression(
      allPassRun(),
      allPassRun(),
      { minSuccessRate: 0.5, maxTimeoutRate: 0.2 },
    );
    expect(result.passed).toBe(true);
  });

  it("flags success rate below the minimum", () => {
    const result = evaluateRegression(
      allPassRun(),
      mixedRun(),
      { minSuccessRate: 0.9 },
    );
    expect(result.passed).toBe(false);
    expect(result.violations.map((v) => v.name)).toContain("minSuccessRate");
  });

  it("flags verification rate below the minimum", () => {
    const result = evaluateRegression(
      allPassRun(),
      mixedRun(),
      { minVerificationRate: 0.8 },
    );
    expect(result.passed).toBe(false);
    expect(result.violations.map((v) => v.name)).toContain("minVerificationRate");
  });

  it("flags an excessive regression rate", () => {
    const result = evaluateRegression(
      allPassRun(),
      mixedRun(),
      { maxRegressionRate: 0.2 },
    );
    expect(result.passed).toBe(false);
    const violation = result.violations.find((v) => v.name === "maxRegressionRate");
    expect(violation).toBeDefined();
    expect(violation!.actual).toBeGreaterThan(0.2);
  });

  it("flags an excessive timeout rate", () => {
    const timedOut = makeResult([
      makeTaskResult("a", { status: "timeout" as never }),
    ]);
    const result = evaluateRegression(allPassRun(), timedOut, { maxTimeoutRate: 0.0 });
    expect(result.passed).toBe(false);
    expect(result.violations.map((v) => v.name)).toContain("maxTimeoutRate");
  });

  it("flags a latency increase beyond the budget", () => {
    const result = evaluateRegression(
      allPassRun(),
      mixedRun(),
      { maxLatencyIncreaseMs: 50 },
    );
    expect(result.passed).toBe(false);
    expect(result.violations.map((v) => v.name)).toContain("maxLatencyIncreaseMs");
  });

  it("collects multiple violations sorted by name", () => {
    const result = evaluateRegression(
      allPassRun(),
      mixedRun(),
      { minSuccessRate: 0.99, maxRegressionRate: 0.0, maxLatencyIncreaseMs: 1 },
    );
    const names = result.violations.map((v) => v.name);
    expect(names).toEqual([...names].sort());
    expect(names.length).toBeGreaterThanOrEqual(3);
  });

  it("includes threshold and actual values in violations", () => {
    const result = evaluateRegression(
      allPassRun(),
      mixedRun(),
      { minSuccessRate: 0.9 },
    );
    const violation = result.violations[0]!;
    expect(violation.threshold).toBe(0.9);
    expect(violation.actual).toBeCloseTo(1 / 3);
    expect(violation.message).toContain("0.9");
  });

  it("is deterministic across identical inputs", () => {
    expect(evaluateRegression(allPassRun(), mixedRun(), { minSuccessRate: 0.9 })).toEqual(
      evaluateRegression(allPassRun(), mixedRun(), { minSuccessRate: 0.9 }),
    );
  });

  it("ignores null metrics when computing rate thresholds", () => {
    const empty = makeResult([]);
    const result = evaluateRegression(allPassRun(), empty, { minSuccessRate: 0.1 });
    // null success rate cannot violate the threshold.
    expect(result.violations.some((v) => v.name === "minSuccessRate")).toBe(false);
  });

  it("treats an empty comparison as zero regression", () => {
    const result = evaluateRegression(makeResult([]), makeResult([]), {
      maxRegressionRate: 0,
    });
    expect(result.violations.some((v) => v.name === "maxRegressionRate")).toBe(false);
  });
});