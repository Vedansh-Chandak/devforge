import { describe, expect, it } from "vitest";
import {
  AdapterError,
  ArtifactAccessError,
  BenchmarkError,
  CancelledError,
  CorruptStoreError,
  DatasetError,
  FixtureError,
  GraderError,
  RegressionError,
  ResultStoreError,
  TaskExecutionError,
  TaskValidationError,
  TimeoutError,
} from "../src/errors.js";

describe("BenchmarkError", () => {
  it("carries a stable machine-readable code", () => {
    const error = new BenchmarkError("boom", "boom_code");
    expect(error.message).toBe("boom");
    expect(error.code).toBe("boom_code");
  });

  it("names itself with the concrete class name", () => {
    expect(new DatasetError("x").name).toBe("DatasetError");
    expect(new FixtureError("x").name).toBe("FixtureError");
  });
});

describe("error subtypes", () => {
  it("DatasetError has code dataset", () => {
    expect(new DatasetError("x").code).toBe("dataset");
  });

  it("TaskValidationError has code task_validation", () => {
    expect(new TaskValidationError("x").code).toBe("task_validation");
  });

  it("FixtureError has code fixture", () => {
    expect(new FixtureError("x").code).toBe("fixture");
  });

  it("TimeoutError has code timeout", () => {
    expect(new TimeoutError("x").code).toBe("timeout");
  });

  it("CancelledError has code cancelled", () => {
    expect(new CancelledError("x").code).toBe("cancelled");
  });

  it("AdapterError has code adapter", () => {
    expect(new AdapterError("x").code).toBe("adapter");
  });

  it("TaskExecutionError has code task_execution", () => {
    expect(new TaskExecutionError("x").code).toBe("task_execution");
  });

  it("GraderError has code grader", () => {
    expect(new GraderError("x").code).toBe("grader");
  });

  it("ResultStoreError has code result_store", () => {
    expect(new ResultStoreError("x").code).toBe("result_store");
  });

  it("ArtifactAccessError has code artifact", () => {
    expect(new ArtifactAccessError("x").code).toBe("artifact");
  });

  it("CorruptStoreError has code corrupt_store", () => {
    expect(new CorruptStoreError("x").code).toBe("corrupt_store");
  });

  it("RegressionError has code regression", () => {
    expect(new RegressionError("x").code).toBe("regression");
  });
});

describe("subtype relationships", () => {
  it("every subtype is an instance of BenchmarkError", () => {
    expect(new DatasetError("x")).toBeInstanceOf(BenchmarkError);
    expect(new TimeoutError("x")).toBeInstanceOf(BenchmarkError);
    expect(new CorruptStoreError("x")).toBeInstanceOf(BenchmarkError);
    expect(new TaskValidationError("x")).toBeInstanceOf(Error);
  });

  it("messages are preserved exactly", () => {
    const error = new ResultStoreError("cannot read stored run 'abc'");
    expect(error.message).toContain("abc");
  });
});
