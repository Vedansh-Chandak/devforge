/**
 * DF-025 Phase 11 — BASIC_DATASET regression gate smoke test.
 *
 * Binds the regression harness to the real ten-task fixture dataset so a
 * breaking change in the dataset, the result contract, or the regression
 * evaluator registers in CI. Deterministic: no network, no LLM, no sandbox.
 */
import { describe, expect, it } from "vitest";
import { BASIC_DATASET } from "../src/dataset-basic.js";
import { evaluateRegression } from "../src/regression.js";
import type { RegressionThresholds } from "../src/types.js";
import { assertValidDataset } from "../src/task-validator.js";
import { taskIds } from "../src/dataset.js";
import { makeResult, makeTaskResult } from "./helpers.js";

function baselineRun() {
  return makeResult(
    taskIds(BASIC_DATASET).map((id, index) =>
      makeTaskResult(id, {
        taskTitle: `Task ${id}`,
        durationMs: index * 10,
      }),
    ),
    { datasetName: BASIC_DATASET.datasetName, datasetVersion: BASIC_DATASET.datasetVersion },
  );
}

const gatingThresholds: RegressionThresholds = {
  minSuccessRate: 0.95,
  maxRegressionRate: 0.0,
  maxTimeoutRate: 0.05,
};

describe("DF-025 P11: BASIC_DATASET regression gate", () => {
  it("uses a structurally valid, ten-task dataset", () => {
    expect(() => assertValidDataset(BASIC_DATASET)).not.toThrow();
    expect(BASIC_DATASET.tasks).toHaveLength(10);
  });

  it("passes when the current run matches the baseline", () => {
    const run = baselineRun();
    const evaluation = evaluateRegression(run, run, gatingThresholds);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.violations).toEqual([]);
  });

  it("flags a single regression in the dataset", () => {
    const baseline = baselineRun();
    const current = makeResult(
      taskIds(BASIC_DATASET).map((id, index) => {
        const base = makeTaskResult(id, { taskTitle: `Task ${id}`, durationMs: index * 10 });
        if (id === "detect-regression") {
          return { ...base, status: "failed", outcome: "failure", score: 0 };
        }
        return base;
      }),
      { datasetName: BASIC_DATASET.datasetName, datasetVersion: BASIC_DATASET.datasetVersion },
    );
    const evaluation = evaluateRegression(baseline, current, gatingThresholds);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.violations.map((v) => v.name)).toContain("minSuccessRate");
  });

  it("flags when a task degrades to a timeout", () => {
    const baseline = baselineRun();
    const current = makeResult(
      taskIds(BASIC_DATASET).map((id, index) => {
        const base = makeTaskResult(id, { taskTitle: `Task ${id}`, durationMs: index * 10 });
        if (id === "repair-loop") {
          return { ...base, status: "timeout" as never, outcome: "timeout" as never };
        }
        return base;
      }),
      { datasetName: BASIC_DATASET.datasetName, datasetVersion: BASIC_DATASET.datasetVersion },
    );
    const evaluation = evaluateRegression(baseline, current, {
      ...gatingThresholds,
      maxTimeoutRate: 0.0,
    });
    expect(evaluation.passed).toBe(false);
    expect(evaluation.violations.map((v) => v.name)).toContain("maxTimeoutRate");
  });
});