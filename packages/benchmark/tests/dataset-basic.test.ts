import { describe, expect, it } from "vitest";
import { BASIC_DATASET, SAMPLE_REPOSITORY_ID } from "../src/dataset-basic.js";
import { assertValidDataset } from "../src/task-validator.js";
import { taskIds, tasksByCategory } from "../src/dataset.js";
import { TASK_CATEGORIES } from "../src/types.js";

describe("BASIC_DATASET", () => {
  it("contains exactly ten tasks", () => {
    expect(BASIC_DATASET.tasks).toHaveLength(10);
  });

  it("passes structural validation", () => {
    expect(() => assertValidDataset(BASIC_DATASET)).not.toThrow();
  });

  it("covers all nine task categories", () => {
    const counts = tasksByCategory(BASIC_DATASET);
    for (const category of TASK_CATEGORIES) {
      expect(counts[category]).toBeGreaterThan(0);
    }
    expect(Object.keys(counts)).toHaveLength(9);
  });

  it("pinpoints the sample repository", () => {
    expect(BASIC_DATASET.repositories).toHaveLength(1);
    expect(BASIC_DATASET.repositories[0]!.id).toBe(SAMPLE_REPOSITORY_ID);
  });

  it("runs every task against sample-ts at main", () => {
    for (const task of BASIC_DATASET.tasks) {
      expect(task.repository.id).toBe(SAMPLE_REPOSITORY_ID);
      expect(task.baseRevision).toBe("main");
    }
  });

  it("fixes task versions at 1", () => {
    for (const task of BASIC_DATASET.tasks) {
      expect(task.version).toBe(1);
    }
  });

  it("uses a shared 30s timeout", () => {
    for (const task of BASIC_DATASET.tasks) {
      expect(task.timeoutMs).toBe(30_000);
    }
  });

  it("covers tests, build, command, and files verification kinds", () => {
    const kinds = new Set(BASIC_DATASET.tasks.map((task) => task.verification.kind));
    expect(kinds).toContain("tests");
    expect(kinds).toContain("build");
    expect(kinds).toContain("command");
    expect(kinds).toContain("files");
  });

  it("includes named fixture tasks across the categories", () => {
    const ids = taskIds(BASIC_DATASET);
    for (const id of [
      "bug-fix-sum",
      "add-triple",
      "refactor-helper",
      "fix-build-import",
      "write-changelog",
      "explore-repository",
      "repair-loop",
      "detect-regression",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("marks detect-regression with regression metadata", () => {
    const task = BASIC_DATASET.tasks.find((candidate) => candidate.id === "detect-regression")!;
    expect(task.metadata?.kind).toBe("regression");
  });

  it("uses deterministic task ids", () => {
    expect(taskIds(BASIC_DATASET)).toEqual(taskIds(BASIC_DATASET));
  });
});